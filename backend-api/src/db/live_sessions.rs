//! Live sessions: `live_sessions`, `live_session_members`, `live_session_queue`.
//!
//! Each write is one transaction: lock the session row, work out the caller
//! (host or a member and their role), check `services::live_sessions::allowed`,
//! write, bump `version`. The caller publishes the new version after commit.
//!
//! The queue: `queued` entries in `position` order are what will play. The
//! current one is `current_entry_id` and stays `queued` until it ends, when it
//! becomes `played` with a `played_at`, which is what back walks. `suggested` entries wait for the host, who approves them
//! onto the end of the queue or rejects them.
//!
//! A non member reads `NotFound`, so a session id does not leak. The host
//! leaving hands the session to someone else, or ends it.
//!
//! A session stays open until the host ends it, or it runs its course
//! (`services::live_sessions::timed_out`): paused 10 minutes, playing with the
//! host's app closed for a minute, or a host alone in it quiet for 30.
//! [`end_timed_out`] writes those ends; the server runs it every 30 s.

use std::sync::LazyLock;

use chrono::{DateTime, FixedOffset, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseTransaction, EntityTrait, FromQueryResult, QueryFilter,
    prelude::Uuid, sea_query::Expr,
};

use crate::db::collab::{check_name, moved_order, write_order};
use crate::db::entity::sea_orm_active_enums::{JoinRequestStatus, ListenMode};
use crate::db::{Db, stmt};
use crate::db::{
    audience::{PrivacyField, can_see_field},
    entity::{live_sessions as sessions, now_playing as now_playing_row},
    invites::{InviteTargetRef, revoke_invites_for},
    notification::NotificationType,
    now_playing::{is_catalog_id, is_live, projected_position_ms, read_up_next},
};
use crate::err::CadenzaError;
use crate::services::live_sessions::{
    AWAY_TIMEOUT, Actor, Anchor, HOST_TIMEOUT, Liveness, PAUSED_TIMEOUT, Projected, REPORT_JUMP_MS,
    RESTART_THRESHOLD_MS, RepeatMode, SessionAction, SessionEntryStatus, SessionRole, add_lands_as,
    allowed, project, timed_out,
};
use crate::services::notification::{NewNotification, push_notification};

/// The most songs one add carries, and the most upcoming entries a queue holds.
pub const MAX_SONGS_PER_ADD: usize = 100;
pub const MAX_QUEUE: i64 = 500;

#[derive(Clone, Debug, FromQueryResult)]
pub struct SessionRow {
    pub session_id: Uuid,
    pub host_id: Uuid,
    pub host_username: String,
    pub name: String,
    pub default_role: SessionRole,
    pub allow_join_without_code: bool,
    pub current_entry_id: Option<i64>,
    pub is_playing: bool,
    pub position_ms: i64,
    pub position_at: DateTime<FixedOffset>,
    pub version: i64,
    /// Bumped by every playback change the host's phone did not make. See
    /// `AnchorBy`.
    pub command_seq: i64,
    pub host_seen_at: DateTime<FixedOffset>,
    pub created_at: DateTime<FixedOffset>,
    pub ended_at: Option<DateTime<FixedOffset>>,
    /// Opened by listen along, so joins check the host's `listen_along`
    /// audience instead of `session_join`.
    pub listen_along: bool,
    /// Someone joining without a code asks first, and the host lets them in.
    pub approve_joins: bool,
    pub shuffle: bool,
    pub repeat_mode: RepeatMode,
    /// Someone besides the host is in it, so a quiet host does not end it.
    pub has_guests: bool,
    /// When the host's app lost its realtime connection, if it has.
    pub host_away_since: Option<DateTime<FixedOffset>>,
    /// The phone closed that connection rather than letting it go quiet.
    pub host_closed_app: bool,
}

impl SessionRow {
    fn anchor(&self) -> Anchor {
        Anchor {
            is_playing: self.is_playing,
            position_ms: self.position_ms,
            position_at: self.position_at.with_timezone(&Utc),
        }
    }

    fn is_open(&self, now: DateTime<Utc>) -> bool {
        self.ended_at.is_none() && !timed_out(self.liveness(), now)
    }

    fn liveness(&self) -> Liveness {
        Liveness {
            is_playing: self.is_playing,
            position_at: self.position_at.with_timezone(&Utc),
            host_seen_at: self.host_seen_at.with_timezone(&Utc),
            host_away_since: self.host_away_since.map(|at| at.with_timezone(&Utc)),
            host_closed_app: self.host_closed_app,
            has_guests: self.has_guests,
        }
    }
}

/// SQL for whether session `s` has someone besides the host in it.
pub const HAS_GUESTS_SQL: &str = "EXISTS (
     SELECT 1 FROM live_session_members g
     WHERE g.session_id = s.session_id AND g.user_id <> s.host_id
       AND g.left_at IS NULL AND NOT g.banned
 )";

static SESSION_COLUMNS: LazyLock<String> = LazyLock::new(|| {
    format!(
        "s.session_id, s.host_id, COALESCE(h.username, 'unknown') AS host_username,
     s.name, s.default_role::text AS default_role, s.allow_join_without_code,
     s.current_entry_id, s.is_playing, s.position_ms, s.position_at, s.version, s.command_seq,
     s.host_seen_at, s.created_at, s.ended_at, s.listen_along, s.approve_joins,
     s.shuffle, s.repeat_mode::text AS repeat_mode, {HAS_GUESTS_SQL} AS has_guests,
     s.host_away_since, s.host_closed_app"
    )
});

/// SQL for whether session `s` is still open, the same rule as
/// [`SessionRow::is_open`] and `timed_out`, built from the same timeouts: not
/// ended, not paused too long, not past the host closing the app (or going
/// quiet while playing), and not a host alone and quiet too long.
pub static OPEN_SESSION_SQL: LazyLock<String> = LazyLock::new(|| {
    format!(
        "s.ended_at IS NULL
     AND (s.is_playing OR s.position_at > now() - interval '{paused} seconds')
     AND NOT ((s.is_playing OR s.host_closed_app)
              AND COALESCE(s.host_away_since < now() - interval '{away} seconds', false))
     AND (s.host_seen_at > now() - interval '{host} seconds' OR {HAS_GUESTS_SQL})",
        paused = PAUSED_TIMEOUT.num_seconds(),
        away = AWAY_TIMEOUT.num_seconds(),
        host = HOST_TIMEOUT.num_seconds(),
    )
});

/// What happened to a host's realtime connection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostLink {
    /// Connected again.
    Back,
    /// The phone closed it, as when the app is swiped away.
    Closed,
    /// It went quiet, as when a paused app is frozen in the background or the
    /// phone is offline.
    Quiet,
}

/// Notes what happened to `user_id`'s realtime connection on every open
/// session they host.
pub async fn set_host_link(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    link: HostLink,
) -> Result<(), CadenzaError> {
    let away = link != HostLink::Back;
    let closed = link == HostLink::Closed;
    let away_since = if away {
        Expr::current_timestamp()
    } else {
        Expr::value(Option::<DateTime<FixedOffset>>::None)
    };
    sessions::Entity::update_many()
        .col_expr(sessions::Column::HostAwaySince, away_since)
        .col_expr(sessions::Column::HostClosedApp, Expr::value(closed))
        .filter(sessions::Column::HostId.eq(user_id))
        .filter(sessions::Column::EndedAt.is_null())
        .exec(db)
        .await?;
    Ok(())
}

/// Marks every open session's host away, for startup: no socket outlives a
/// restart, and a host who comes back clears it on connect.
pub async fn mark_all_hosts_away(db: &impl ConnectionTrait) -> Result<(), CadenzaError> {
    sessions::Entity::update_many()
        .col_expr(sessions::Column::HostAwaySince, Expr::current_timestamp())
        .filter(sessions::Column::EndedAt.is_null())
        .filter(sessions::Column::HostAwaySince.is_null())
        .exec(db)
        .await?;
    Ok(())
}

/// A session [`end_timed_out`] ended, and who was in it.
#[derive(Clone, Debug)]
pub struct TimedOut {
    pub session_id: Uuid,
    pub version: i64,
    pub member_ids: Vec<Uuid>,
    pub reason: EndReason,
}

/// Why a session ran its course.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    /// The host's app closed or went quiet.
    HostGone,
    Paused,
}

/// Ends every open session that ran its course, and revokes its codes. A
/// host whose app is gone also loses their now playing row: a closed app
/// never says it stopped, and the row would keep them on friends' Listening
/// now, joinable, until the song would have ended.
/// Returns them so the caller can tell their members.
pub async fn end_timed_out(db: &impl Db) -> Result<Vec<TimedOut>, CadenzaError> {
    let txn = db.begin().await?;
    let rows = txn
        .query_all_raw(stmt(
            &format!(
                "UPDATE live_sessions s
                 SET ended_at = now(), is_playing = false, version = version + 1
                 WHERE s.ended_at IS NULL AND NOT ({open})
                 RETURNING s.session_id, s.host_id, s.version,
                     s.host_away_since IS NOT NULL OR s.host_seen_at < now() - interval '{host} seconds' AS host_gone",
                open = *OPEN_SESSION_SQL,
                host = HOST_TIMEOUT.num_seconds(),
            ),
            vec![],
        ))
        .await?;
    let mut ended = Vec::with_capacity(rows.len());
    for row in rows {
        let session_id: Uuid = row.try_get("", "session_id")?;
        let reason = if row.try_get("", "host_gone")? {
            EndReason::HostGone
        } else {
            EndReason::Paused
        };
        revoke_invites_for(&txn, &InviteTargetRef::LiveSession(session_id)).await?;
        if reason == EndReason::HostGone {
            let host_id: Uuid = row.try_get("", "host_id")?;
            txn.execute_raw(stmt(
                "DELETE FROM now_playing WHERE user_id = $1",
                vec![host_id.into()],
            ))
            .await?;
        }
        let member_ids = txn
            .query_all_raw(stmt(
                "SELECT user_id FROM live_session_members
                 WHERE session_id = $1 AND left_at IS NULL AND NOT banned",
                vec![session_id.into()],
            ))
            .await?
            .iter()
            .map(|row| row.try_get("", "user_id"))
            .collect::<Result<Vec<Uuid>, _>>()?;
        ended.push(TimedOut {
            session_id,
            version: row.try_get("", "version")?,
            member_ids,
            reason,
        });
    }
    txn.commit().await?;
    Ok(ended)
}

#[derive(Clone, Debug, FromQueryResult)]
pub struct SessionMember {
    pub user_id: Uuid,
    pub username: String,
    pub role: SessionRole,
    pub listen_mode: ListenMode,
    pub joined_at: DateTime<FixedOffset>,
}

#[derive(Clone, Debug, FromQueryResult)]
pub struct QueueEntry {
    pub entry_id: i64,
    pub song_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_ms: Option<i64>,
    pub position: i32,
    pub status: SessionEntryStatus,
    pub added_by: Option<Uuid>,
    pub added_by_username: Option<String>,
    pub added_at: DateTime<FixedOffset>,
}

/// One song to add, as the client knows it. Titles are stored so every member
/// sees the same text without asking Apple, and durations so playback can be
/// projected while the host is in the background.
#[derive(Clone, Debug)]
pub struct NewQueueSong {
    pub song_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_ms: Option<i64>,
}

/// Where playback is now, by the projection.
#[derive(Clone, Debug)]
pub struct ProjectedPlayback {
    pub entry_id: Option<i64>,
    pub position_ms: i64,
    pub is_playing: bool,
    pub as_of: DateTime<Utc>,
}

/// Where playback is right after a write, with the session row it was
/// projected from.
#[derive(Clone, Debug)]
pub struct PlaybackNow {
    pub session: SessionRow,
    pub projected: ProjectedPlayback,
}

/// What a playback write did.
#[derive(Clone, Debug)]
pub struct Change {
    pub version: i64,
    /// Set when the write moved only playback, not the queue or members, so
    /// the new playback can go out with the event and nobody has to refetch.
    pub playback: Option<PlaybackNow>,
}

/// Everything a member's screen shows.
#[derive(Clone, Debug)]
pub struct SessionSnapshot {
    pub session: SessionRow,
    pub me: Actor,
    pub my_listen_mode: ListenMode,
    pub members: Vec<SessionMember>,
    pub current: Option<QueueEntry>,
    pub up_next: Vec<QueueEntry>,
    pub suggestions: Vec<QueueEntry>,
    /// People waiting to be let in. Empty for everyone but the host.
    pub join_requests: Vec<JoinRequest>,
    pub playback: ProjectedPlayback,
}

/// Someone who asked to join, waiting on the host.
#[derive(Clone, Debug, FromQueryResult)]
pub struct JoinRequest {
    pub user_id: Uuid,
    pub username: String,
    pub requested_at: DateTime<FixedOffset>,
}

/// A session to start.
#[derive(Clone, Copy, Debug)]
pub struct NewSession<'a> {
    pub name: &'a str,
    pub default_role: SessionRole,
    pub allow_join_without_code: bool,
    /// Opened by listen along. See [`SessionRow::listen_along`].
    pub listen_along: bool,
    /// See [`SessionRow::approve_joins`].
    pub approve_joins: bool,
}

/// Settings a host can change.
#[derive(Clone, Debug, Default)]
pub struct SessionPatch {
    pub name: Option<String>,
    pub default_role: Option<SessionRole>,
    pub allow_join_without_code: Option<bool>,
    /// False turns a listen along session into a regular one.
    pub listen_along: Option<bool>,
    pub approve_joins: Option<bool>,
}

/// Where added songs land.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddAt {
    /// After every upcoming song.
    End,
    /// Among the upcoming songs, 0 is next.
    Position(i32),
    /// Next, and playing right away. Needs control.
    PlayNow,
}

/// Where playback starts when songs are added to a session with nothing
/// current: the host's phone was already mid song when it opened the session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StartAt {
    pub position_ms: i64,
    pub is_playing: bool,
}

/// What the host's phone reports. See [`host_report`].
#[derive(Clone, Copy, Debug)]
pub struct HostReport {
    pub entry_id: Option<i64>,
    pub position_ms: i64,
    pub is_playing: bool,
    /// The last `command_seq` the phone followed. `None` from an older app.
    pub command_seq: Option<i64>,
}

/// A transport command from a controller or the host.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlaybackCommand {
    Play,
    Pause,
    Seek {
        position_ms: i64,
    },
    Next,
    /// Back: restarts the song, or near its start goes to the last one played.
    Previous,
    Jump {
        entry_id: i64,
    },
    Shuffle {
        on: bool,
    },
    Repeat {
        mode: RepeatMode,
    },
}

async fn load_session<C: ConnectionTrait>(
    db: &C,
    session_id: Uuid,
    for_update: bool,
) -> Result<Option<SessionRow>, CadenzaError> {
    // FOR UPDATE cannot sit on the nullable side of an outer join, so the lock
    // names its table
    let lock = if for_update { "FOR UPDATE OF s" } else { "" };
    Ok(SessionRow::find_by_statement(stmt(
        &format!(
            "SELECT {columns} FROM live_sessions s
             LEFT JOIN profile h ON h.uid = s.host_id
             WHERE s.session_id = $1 {lock}",
            columns = *SESSION_COLUMNS,
        ),
        vec![session_id.into()],
    ))
    .one(db)
    .await?)
}

/// The caller as the session sees them, or `None` when they are not in it.
async fn actor_for<C: ConnectionTrait>(
    db: &C,
    session: &SessionRow,
    user_id: Uuid,
) -> Result<Option<Actor>, CadenzaError> {
    if session.host_id == user_id {
        return Ok(Some(Actor::Host));
    }
    let row = db
        .query_one_raw(stmt(
            "SELECT role::text AS role FROM live_session_members
             WHERE session_id = $1 AND user_id = $2 AND left_at IS NULL AND NOT banned",
            vec![session.session_id.into(), user_id.into()],
        ))
        .await?;
    Ok(match row {
        Some(row) => Some(Actor::Member(row.try_get("", "role")?)),
        None => None,
    })
}

/// Whether `user_id` is in the open session, for the realtime subscribe check.
pub async fn is_participant(
    db: &impl Db,
    session_id: Uuid,
    user_id: Uuid,
) -> Result<bool, CadenzaError> {
    let Some(session) = load_session(db, session_id, false).await? else {
        return Ok(false);
    };
    if session.ended_at.is_some() {
        return Ok(false);
    }
    Ok(actor_for(db, &session, user_id).await?.is_some())
}

/// Locks the session and checks the caller may do `action`.
async fn lock_for(
    txn: &DatabaseTransaction,
    session_id: Uuid,
    user_id: Uuid,
    action: SessionAction,
) -> Result<(SessionRow, Actor), CadenzaError> {
    let session = load_session(txn, session_id, true)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    let actor = actor_for(txn, &session, user_id)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    if !session.is_open(Utc::now()) {
        return Err(CadenzaError::SessionEnded);
    }
    if !allowed(actor, action) {
        return Err(CadenzaError::Forbidden(
            "your role in this session does not allow that".into(),
        ));
    }
    Ok((session, actor))
}

/// Sets one column of the session.
async fn set_column(
    txn: &DatabaseTransaction,
    session_id: Uuid,
    column: sessions::Column,
    value: impl Into<Expr>,
) -> Result<(), CadenzaError> {
    sessions::Entity::update_many()
        // casts an enum value to its postgres type
        .col_expr(column, column.save_as(value.into()))
        .filter(sessions::Column::SessionId.eq(session_id))
        .exec(txn)
        .await?;
    Ok(())
}

async fn bump(txn: &DatabaseTransaction, session_id: Uuid) -> Result<i64, CadenzaError> {
    let row = txn
        .query_one_raw(stmt(
            "UPDATE live_sessions SET version = version + 1
             WHERE session_id = $1 RETURNING version",
            vec![session_id.into()],
        ))
        .await?
        .ok_or(CadenzaError::NotFound)?;
    Ok(row.try_get("", "version")?)
}

/// Who moved playback. Only a command bumps `command_seq`, which is how the
/// host's phone tells a change it must follow from its own report coming back.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AnchorBy {
    /// The host's phone, saying what it already does.
    HostPhone,
    /// Anyone else, or the host from the session screen.
    Command,
}

/// Sets the anchor: `current` playing or not, at `position_ms` as of now.
async fn set_anchor(
    txn: &DatabaseTransaction,
    session_id: Uuid,
    current: Option<i64>,
    is_playing: bool,
    position_ms: i64,
    by: AnchorBy,
) -> Result<(), CadenzaError> {
    let steps: i64 = if by == AnchorBy::Command { 1 } else { 0 };
    txn.execute_raw(stmt(
        "UPDATE live_sessions
         SET current_entry_id = $2, is_playing = $3, position_ms = $4, position_at = now(),
             command_seq = command_seq + $5
         WHERE session_id = $1",
        vec![
            session_id.into(),
            current.into(),
            is_playing.into(),
            position_ms.max(0).into(),
            steps.into(),
        ],
    ))
    .await?;
    Ok(())
}

/// Queued entries in play order, the current one included.
async fn queued_entries<C: ConnectionTrait>(
    db: &C,
    session_id: Uuid,
) -> Result<Vec<QueueEntry>, CadenzaError> {
    entries_with_status(db, session_id, SessionEntryStatus::Queued).await
}

async fn entries_with_status<C: ConnectionTrait>(
    db: &C,
    session_id: Uuid,
    status: SessionEntryStatus,
) -> Result<Vec<QueueEntry>, CadenzaError> {
    Ok(QueueEntry::find_by_statement(stmt(
        "SELECT q.entry_id, q.song_id, q.title, q.artist, q.artwork_url, q.duration_ms,
                q.position, q.status::text AS status, q.added_by,
                p.username AS added_by_username, q.added_at
         FROM live_session_queue q
         LEFT JOIN profile p ON p.uid = q.added_by
         WHERE q.session_id = $1 AND q.status = $2::session_entry_status
         ORDER BY q.position, q.entry_id",
        vec![session_id.into(), status.into()],
    ))
    .all(db)
    .await?)
}

/// The queued entries after the current one, in order.
fn upcoming(queued: &[QueueEntry], current: Option<i64>) -> Vec<QueueEntry> {
    queued
        .iter()
        .filter(|entry| Some(entry.entry_id) != current)
        .cloned()
        .collect()
}

/// Playback as of this transaction, after its writes.
async fn playback_now(
    txn: &DatabaseTransaction,
    session_id: Uuid,
) -> Result<PlaybackNow, CadenzaError> {
    let session = load_session(txn, session_id, false)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    let queued = queued_entries(txn, session_id).await?;
    let projected = projected_playback(&session, &queued, Utc::now());
    Ok(PlaybackNow { session, projected })
}

/// Renumbers queued positions 0..n in their current order.
async fn renumber(txn: &DatabaseTransaction, session_id: Uuid) -> Result<(), CadenzaError> {
    txn.execute_raw(stmt(
        "UPDATE live_session_queue q SET position = r.rn - 1
         FROM (
             SELECT entry_id, row_number() OVER (ORDER BY position, entry_id) AS rn
             FROM live_session_queue WHERE session_id = $1 AND status = 'queued'
         ) r
         WHERE q.entry_id = r.entry_id AND q.position <> r.rn - 1",
        vec![session_id.into()],
    ))
    .await?;
    Ok(())
}

/// Marks `entry_ids` played, in that order.
async fn mark_played(
    txn: &DatabaseTransaction,
    session_id: Uuid,
    entry_ids: &[i64],
) -> Result<(), CadenzaError> {
    if entry_ids.is_empty() {
        return Ok(());
    }
    txn.execute_raw(stmt(
        "UPDATE live_session_queue SET status = 'played', played_at = now()
         WHERE session_id = $1 AND entry_id = ANY($2)",
        vec![session_id.into(), entry_ids.to_vec().into()],
    ))
    .await?;
    Ok(())
}

/// On repeat all, once the current song is the last one queued, the played
/// songs go back on after it: in the order they played, or shuffled. Does
/// nothing otherwise. Returns whether it put any back.
async fn refill_for_repeat(
    txn: &DatabaseTransaction,
    session_id: Uuid,
) -> Result<bool, CadenzaError> {
    let refilled = txn
        .execute_raw(stmt(
            "UPDATE live_session_queue q
             SET status = 'queued', played_at = NULL, position = 1000000 + r.rn
             FROM (
                 SELECT p.entry_id,
                        row_number() OVER (
                            ORDER BY CASE WHEN s.shuffle THEN random() END,
                                     p.played_at, p.position, p.entry_id
                        ) AS rn
                 FROM live_session_queue p
                 JOIN live_sessions s ON s.session_id = p.session_id
                 WHERE p.session_id = $1 AND p.status = 'played'
                   AND s.repeat_mode = 'all' AND s.current_entry_id IS NOT NULL
                   AND NOT EXISTS (
                       SELECT 1 FROM live_session_queue u
                       WHERE u.session_id = $1 AND u.status = 'queued'
                         AND u.entry_id <> s.current_entry_id
                   )
             ) r
             WHERE q.entry_id = r.entry_id",
            vec![session_id.into()],
        ))
        .await?;
    let refilled = refilled.rows_affected() > 0;
    if refilled {
        renumber(txn, session_id).await?;
    }
    Ok(refilled)
}

/// Puts the songs after the current one in a random order.
async fn shuffle_upcoming(
    txn: &DatabaseTransaction,
    session_id: Uuid,
    current: Option<i64>,
) -> Result<(), CadenzaError> {
    txn.execute_raw(stmt(
        "UPDATE live_session_queue q SET position = 1000000 + r.rn
         FROM (
             SELECT entry_id, row_number() OVER (ORDER BY random()) AS rn
             FROM live_session_queue
             WHERE session_id = $1 AND status = 'queued' AND entry_id IS DISTINCT FROM $2
         ) r
         WHERE q.entry_id = r.entry_id",
        vec![session_id.into(), current.into()],
    ))
    .await?;
    renumber(txn, session_id).await
}

/// Starts a session hosted by `host_id`, or returns the open one they already
/// have, so a double tap does not fail. Returns its id.
pub async fn start_session(
    db: &impl Db,
    host_id: Uuid,
    new: NewSession<'_>,
) -> Result<Uuid, CadenzaError> {
    let name = check_name(new.name, "session")?;
    let txn = db.begin().await?;
    // a session whose host went quiet has ended, even if nothing wrote that yet
    end_stale_sessions_of(&txn, host_id).await?;
    if let Some(row) = txn
        .query_one_raw(stmt(
            "SELECT session_id FROM live_sessions WHERE host_id = $1 AND ended_at IS NULL",
            vec![host_id.into()],
        ))
        .await?
    {
        txn.commit().await?;
        return Ok(row.try_get("", "session_id")?);
    }
    let row = txn
        .query_one_raw(stmt(
            "INSERT INTO live_sessions
                 (host_id, name, default_role, allow_join_without_code, listen_along, approve_joins)
             VALUES ($1, $2, $3::session_role, $4, $5, $6) RETURNING session_id",
            vec![
                host_id.into(),
                name.into(),
                new.default_role.into(),
                new.allow_join_without_code.into(),
                new.listen_along.into(),
                new.approve_joins.into(),
            ],
        ))
        .await?
        .ok_or_else(|| CadenzaError::DatabaseError("insert returned nothing".into()))?;
    let session_id: Uuid = row.try_get("", "session_id")?;
    txn.execute_raw(stmt(
        "INSERT INTO live_session_members (session_id, user_id, role, listen_mode)
         VALUES ($1, $2, 'controller', 'synced')",
        vec![session_id.into(), host_id.into()],
    ))
    .await?;
    txn.commit().await?;
    Ok(session_id)
}

async fn end_stale_sessions_of<C: ConnectionTrait>(
    db: &C,
    host_id: Uuid,
) -> Result<(), CadenzaError> {
    db.execute_raw(stmt(
        &format!(
            "UPDATE live_sessions s
             SET ended_at = now(), is_playing = false, version = version + 1
             WHERE s.host_id = $1 AND s.ended_at IS NULL AND NOT ({open})",
            open = *OPEN_SESSION_SQL,
        ),
        vec![host_id.into()],
    ))
    .await?;
    Ok(())
}

/// Everyone still in the session, host included. Still holds them right after
/// an end, since ending does not mark anyone left.
pub async fn present_member_ids(db: &impl Db, session_id: Uuid) -> Result<Vec<Uuid>, CadenzaError> {
    let rows = db
        .query_all_raw(stmt(
            "SELECT user_id FROM live_session_members
             WHERE session_id = $1 AND left_at IS NULL AND NOT banned",
            vec![session_id.into()],
        ))
        .await?;
    rows.iter()
        .map(|row| Ok(row.try_get("", "user_id")?))
        .collect()
}

/// The open session `user_id` hosts or is in, if any. Newest first, since
/// someone could be in more than one.
pub async fn current_session_id(db: &impl Db, user_id: Uuid) -> Result<Option<Uuid>, CadenzaError> {
    let row = db
        .query_one_raw(stmt(
            &format!(
                "SELECT s.session_id FROM live_session_members m
                 JOIN live_sessions s ON s.session_id = m.session_id
                 WHERE m.user_id = $1 AND m.left_at IS NULL AND NOT m.banned
                   AND {open}
                 ORDER BY (s.host_id = $1) DESC, m.joined_at DESC
                 LIMIT 1",
                open = *OPEN_SESSION_SQL,
            ),
            vec![user_id.into()],
        ))
        .await?;
    match row {
        Some(row) => Ok(Some(row.try_get("", "session_id")?)),
        None => Ok(None),
    }
}

/// The session as a member sees it. `SessionEnded` once it is over, with the
/// end written if the host simply went quiet.
pub async fn get_snapshot(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
) -> Result<SessionSnapshot, CadenzaError> {
    let session = load_session(db, session_id, false)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    let me = actor_for(db, &session, user_id)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    let now = Utc::now();
    if !session.is_open(now) {
        if session.ended_at.is_none() {
            end_stale_sessions_of(db, session.host_id).await?;
        }
        return Err(CadenzaError::SessionEnded);
    }

    let members = SessionMember::find_by_statement(stmt(
        "SELECT m.user_id, COALESCE(p.username, 'unknown') AS username,
                m.role::text AS role, m.listen_mode::text AS listen_mode, m.joined_at
         FROM live_session_members m
         LEFT JOIN profile p ON p.uid = m.user_id
         WHERE m.session_id = $1 AND m.left_at IS NULL AND NOT m.banned
         ORDER BY (m.user_id = $2) DESC, m.joined_at",
        vec![session_id.into(), session.host_id.into()],
    ))
    .all(db)
    .await?;
    let my_listen_mode = members
        .iter()
        .find(|member| member.user_id == user_id)
        .map_or(ListenMode::Remote, |member| member.listen_mode);

    let queued = queued_entries(db, session_id).await?;
    let current = session
        .current_entry_id
        .and_then(|id| queued.iter().find(|entry| entry.entry_id == id).cloned());
    let up_next = upcoming(&queued, session.current_entry_id);
    let suggestions = entries_with_status(db, session_id, SessionEntryStatus::Suggested).await?;
    let join_requests = if session.host_id == user_id {
        JoinRequest::find_by_statement(stmt(
            "SELECT r.user_id, COALESCE(p.username, 'unknown') AS username, r.requested_at
             FROM live_session_join_requests r
             LEFT JOIN profile p ON p.uid = r.user_id
             WHERE r.session_id = $1 AND r.status = 'pending'
             ORDER BY r.requested_at",
            vec![session_id.into()],
        ))
        .all(db)
        .await?
    } else {
        Vec::new()
    };
    let playback = projected_playback(&session, &queued, now);

    Ok(SessionSnapshot {
        session,
        me,
        my_listen_mode,
        members,
        current,
        up_next,
        suggestions,
        join_requests,
        playback,
    })
}

/// The anchor walked forward through `queued`, the session's queued entries in
/// play order, to `now`.
pub fn projected_playback(
    session: &SessionRow,
    queued: &[QueueEntry],
    now: DateTime<Utc>,
) -> ProjectedPlayback {
    let current = session
        .current_entry_id
        .and_then(|id| queued.iter().find(|entry| entry.entry_id == id));
    let up_next = upcoming(queued, session.current_entry_id);
    let Some(current) = current else {
        return ProjectedPlayback {
            entry_id: None,
            position_ms: 0,
            is_playing: false,
            as_of: now,
        };
    };
    // repeat one loops the current song; repeat all loops what is queued,
    // which by the last song holds the played ones again
    let repeat = session.repeat_mode;
    let ahead = if repeat == RepeatMode::One {
        &[][..]
    } else {
        &up_next[..]
    };
    let durations: Vec<Option<i64>> = std::iter::once(current.duration_ms)
        .chain(ahead.iter().map(|entry| entry.duration_ms))
        .collect();
    let Projected {
        entries_ahead,
        position_ms,
        finished,
    } = project(session.anchor(), &durations, repeat != RepeatMode::Off, now);
    let entry_id = if entries_ahead == 0 {
        current.entry_id
    } else {
        up_next[entries_ahead - 1].entry_id
    };
    ProjectedPlayback {
        entry_id: Some(entry_id),
        position_ms,
        is_playing: session.is_playing && !finished,
        as_of: now,
    }
}

/// What joining did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Joined {
    /// In the session, at this version.
    Member(i64),
    /// Asked the host to be let in, at this version.
    Asked(i64),
}

impl Joined {
    pub fn version(self) -> i64 {
        match self {
            Self::Member(version) | Self::Asked(version) => version,
        }
    }
}

/// Joins as the session's default role, or rejoins with the role held before.
/// Without a code the session must be open to joins and the host's
/// `session_join` audience (`listen_along` for a listen along session) must
/// allow the caller. Then with `approve_joins` on, a first join asks the host
/// instead (see [`answer_join_request`]); asking again while waiting changes
/// nothing. A code joins at once. A banned member cannot rejoin either way.
pub async fn join_session(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    via_code: bool,
) -> Result<Joined, CadenzaError> {
    let txn = db.begin().await?;
    let session = load_session(&txn, session_id, true)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    if !session.is_open(Utc::now()) {
        return Err(CadenzaError::SessionEnded);
    }
    if session.host_id == user_id {
        txn.commit().await?;
        return Ok(Joined::Member(session.version));
    }
    let previous = txn
        .query_one_raw(stmt(
            "SELECT banned FROM live_session_members WHERE session_id = $1 AND user_id = $2",
            vec![session_id.into(), user_id.into()],
        ))
        .await?;
    if let Some(row) = &previous
        && row.try_get::<bool>("", "banned")?
    {
        return Err(CadenzaError::Forbidden(
            "the host removed you from this session".into(),
        ));
    }
    if !via_code {
        let field = if session.listen_along {
            PrivacyField::ListenAlong
        } else {
            PrivacyField::SessionJoin
        };
        let open_to_audience = session.allow_join_without_code
            && can_see_field(&txn, user_id, session.host_id, field).await?;
        if !open_to_audience {
            return Err(CadenzaError::Forbidden(
                "this session needs an invite code".into(),
            ));
        }
        // someone let in before comes back without asking again
        if session.approve_joins && previous.is_none() {
            let version = ask_to_join(&txn, &session, user_id).await?;
            txn.commit().await?;
            return Ok(Joined::Asked(version));
        }
    }
    add_member(&txn, &session, user_id).await?;
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(Joined::Member(version))
}

/// What joining someone from Listening now did.
#[derive(Clone, Copy, Debug)]
pub struct JoinedListening {
    pub session_id: Uuid,
    pub joined: Joined,
    /// The session was made for this join, so the owner's phone has to hear
    /// about it.
    pub created: bool,
}

/// Joins `owner` from Listening now: the open session they are in, or with
/// none, a listen along session made for them right then, seeded with what
/// they are playing. The owner hosts it, and it stays open until they end it
/// once anyone is in. Making one needs their `listen_along` audience to
/// include the viewer, and a song playing. Joining then goes through
/// [`join_session`], so the owner is asked first while `approve_joins` is on.
pub async fn join_listening(
    db: &impl Db,
    viewer: Uuid,
    owner: Uuid,
) -> Result<JoinedListening, CadenzaError> {
    if viewer == owner {
        return Err(CadenzaError::InvalidRequestBody(
            "that is your own listening".into(),
        ));
    }
    if let Some(session_id) = current_session_id(db, owner).await? {
        let joined = join_session(db, viewer, session_id, false).await?;
        return Ok(JoinedListening {
            session_id,
            joined,
            created: false,
        });
    }
    if !can_see_field(db, viewer, owner, PrivacyField::ListenAlong).await? {
        return Err(CadenzaError::Forbidden(
            "they have not turned on listen along".into(),
        ));
    }
    let now = Utc::now();
    let playing = now_playing_row::Entity::find_by_id(owner)
        .one(db)
        .await?
        .filter(|row| is_live(row, now))
        .ok_or(CadenzaError::NotFound)?;

    let username = db
        .query_one_raw(stmt(
            "SELECT username FROM profile WHERE uid = $1",
            vec![owner.into()],
        ))
        .await?
        .map(|row| row.try_get::<String>("", "username"))
        .transpose()?;
    let name = match username {
        Some(username) => format!("Listening with {username}"),
        None => "Listening along".to_owned(),
    };
    let session_id = start_session(
        db,
        owner,
        NewSession {
            name: &name,
            default_role: SessionRole::Listener,
            allow_join_without_code: true,
            listen_along: true,
            approve_joins: true,
        },
    )
    .await?;

    // a second join racing this one finds it already seeded
    let seeded = load_session(db, session_id, false)
        .await?
        .is_some_and(|session| session.current_entry_id.is_some());
    if !seeded {
        let songs: Vec<NewQueueSong> = std::iter::once(NewQueueSong {
            song_id: playing.song_id.clone(),
            title: playing.title.clone(),
            artist: playing.artist.clone(),
            artwork_url: playing.artwork_url.clone(),
            duration_ms: playing.duration_ms,
        })
        .chain(
            read_up_next(&playing.up_next)
                .into_iter()
                .filter_map(|song| {
                    let song_id = song.song_id.filter(|id| is_catalog_id(id))?;
                    Some(NewQueueSong {
                        song_id,
                        title: song.title,
                        artist: song.artist,
                        artwork_url: song.artwork_url,
                        duration_ms: None,
                    })
                }),
        )
        .collect();
        add_songs(
            db,
            owner,
            session_id,
            &songs,
            AddAt::End,
            Some(StartAt {
                position_ms: projected_position_ms(&playing, now),
                is_playing: playing.is_playing,
            }),
        )
        .await?;
    }

    let joined = join_session(db, viewer, session_id, false).await?;
    Ok(JoinedListening {
        session_id,
        joined,
        created: true,
    })
}

async fn add_member(
    txn: &DatabaseTransaction,
    session: &SessionRow,
    user_id: Uuid,
) -> Result<(), CadenzaError> {
    txn.execute_raw(stmt(
        "INSERT INTO live_session_members (session_id, user_id, role)
         VALUES ($1, $2, $3::session_role)
         ON CONFLICT (session_id, user_id)
         DO UPDATE SET left_at = NULL, joined_at = now()",
        vec![
            session.session_id.into(),
            user_id.into(),
            session.default_role.clone().into(),
        ],
    ))
    .await?;
    Ok(())
}

async fn username_of(txn: &DatabaseTransaction, user_id: Uuid) -> Result<String, CadenzaError> {
    let row = txn
        .query_one_raw(stmt(
            "SELECT username FROM profile WHERE uid = $1",
            vec![user_id.into()],
        ))
        .await?;
    Ok(match row {
        Some(row) => row.try_get("", "username")?,
        None => "Someone".to_owned(),
    })
}

/// Files the caller's request and tells the host, once per wait. Returns the
/// session's version, bumped when the request is new.
async fn ask_to_join(
    txn: &DatabaseTransaction,
    session: &SessionRow,
    user_id: Uuid,
) -> Result<i64, CadenzaError> {
    let waiting = txn
        .query_one_raw(stmt(
            "SELECT 1 AS one FROM live_session_join_requests
             WHERE session_id = $1 AND user_id = $2 AND status = 'pending'",
            vec![session.session_id.into(), user_id.into()],
        ))
        .await?
        .is_some();
    if waiting {
        return Ok(session.version);
    }
    txn.execute_raw(stmt(
        "INSERT INTO live_session_join_requests (session_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (session_id, user_id)
         DO UPDATE SET status = 'pending', requested_at = now()",
        vec![session.session_id.into(), user_id.into()],
    ))
    .await?;
    let username = username_of(txn, user_id).await?;
    let what = if session.listen_along {
        "wants to listen along with you".to_owned()
    } else {
        format!("wants to join {}", session.name)
    };
    push_notification(
        txn,
        NewNotification {
            user_id: session.host_id,
            title: username,
            content: what,
            notif_type: NotificationType::SessionJoinRequest,
            metadata: serde_json::json!({
                "sender_id": user_id,
                "session_id": session.session_id,
                "resolution": null,
            }),
        },
    )
    .await?;
    bump(txn, session.session_id).await
}

/// Lets someone who asked in, as the default role, or turns them away. Host
/// only. Their notification on the host's side gets the answer, and someone
/// let in is told. 404 when they are not waiting. Returns the new version.
pub async fn answer_join_request(
    db: &impl Db,
    host_id: Uuid,
    session_id: Uuid,
    user_id: Uuid,
    accept: bool,
) -> Result<Answered, CadenzaError> {
    let txn = db.begin().await?;
    let (session, _) = lock_for(&txn, session_id, host_id, SessionAction::Manage).await?;
    let status = if accept {
        JoinRequestStatus::Accepted
    } else {
        JoinRequestStatus::Ignored
    };
    let updated = txn
        .execute_raw(stmt(
            "UPDATE live_session_join_requests SET status = $3::join_request_status
             WHERE session_id = $1 AND user_id = $2 AND status = 'pending'",
            vec![session_id.into(), user_id.into(), status.into()],
        ))
        .await?;
    if updated.rows_affected() == 0 {
        return Err(CadenzaError::NotFound);
    }
    txn.execute_raw(stmt(
        "UPDATE notifications
         SET metadata = jsonb_set(metadata, '{resolution}', to_jsonb($4::text), true)
         WHERE user_id = $1 AND type = 'session_join_request'
           AND metadata->>'session_id' = $2::text AND metadata->>'sender_id' = $3::text
           AND metadata->>'resolution' IS NULL",
        vec![
            host_id.into(),
            session_id.to_string().into(),
            user_id.to_string().into(),
            status.into(),
        ],
    ))
    .await?;
    if accept {
        add_member(&txn, &session, user_id).await?;
        push_notification(
            &txn,
            NewNotification {
                user_id,
                title: session.host_username.clone(),
                content: format!("let you into {}", session.name),
                notif_type: NotificationType::SessionJoinAccepted,
                metadata: serde_json::json!({ "session_id": session_id }),
            },
        )
        .await?;
    } else if let Some(version) = end_if_unused(&txn, &session).await? {
        txn.commit().await?;
        return Ok(Answered {
            version,
            ended: true,
        });
    }
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(Answered {
        version,
        ended: false,
    })
}

/// What answering a join request did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Answered {
    pub version: i64,
    /// Turning away the last one waiting on a listen along session nobody
    /// is in ended it.
    pub ended: bool,
}

/// A listen along session is there for the people who joined it. Once nobody
/// besides the host is in it or waiting to be, it ends and the host just
/// listens again. Returns the final version when it ended.
async fn end_if_unused(
    txn: &DatabaseTransaction,
    session: &SessionRow,
) -> Result<Option<i64>, CadenzaError> {
    if !session.listen_along {
        return Ok(None);
    }
    let row = txn
        .query_one_raw(stmt(
            &format!(
                "SELECT {HAS_GUESTS_SQL} OR EXISTS (
                     SELECT 1 FROM live_session_join_requests r
                     WHERE r.session_id = s.session_id AND r.status = 'pending'
                 ) AS used
                 FROM live_sessions s WHERE s.session_id = $1"
            ),
            vec![session.session_id.into()],
        ))
        .await?
        .ok_or_else(|| CadenzaError::DatabaseError("exists returned nothing".into()))?;
    if row.try_get::<bool>("", "used")? {
        return Ok(None);
    }
    Ok(Some(end_locked(txn, session).await?))
}

/// What leaving did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Left {
    /// Still going, at this version.
    Left(i64),
    /// The host left and `new_host` hosts it now, at this version.
    HandedOver { version: i64, new_host: Uuid },
    /// The host left with nobody to hand it to, or the last guest left a
    /// listen along session, so it ended, at this version.
    Ended(i64),
}

/// Leaves. The host leaving hands the session to whoever is best placed to
/// play it (see [`hand_over`]), or ends it when nobody else is in it.
pub async fn leave_session(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
) -> Result<Left, CadenzaError> {
    let txn = db.begin().await?;
    let (session, actor) = lock_for(&txn, session_id, user_id, SessionAction::View).await?;
    if actor == Actor::Host {
        let left = match hand_over(&txn, &session).await? {
            Some((version, new_host)) => Left::HandedOver { version, new_host },
            None => Left::Ended(end_locked(&txn, &session).await?),
        };
        txn.commit().await?;
        return Ok(left);
    }
    txn.execute_raw(stmt(
        "UPDATE live_session_members SET left_at = now()
         WHERE session_id = $1 AND user_id = $2",
        vec![session_id.into(), user_id.into()],
    ))
    .await?;
    if let Some(version) = end_if_unused(&txn, &session).await? {
        txn.commit().await?;
        return Ok(Left::Ended(version));
    }
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(Left::Left(version))
}

/// Makes another member the host, for a host who is leaving. Someone already
/// playing along comes first, since their phone is ready to be the speaker,
/// then the highest role, then whoever joined first. Someone hosting their
/// own open session is passed over. Playback is re-anchored where it is now,
/// so the new host's phone picks up from there. Returns the new version and
/// host, or `None` when nobody else is in it.
async fn hand_over(
    txn: &DatabaseTransaction,
    session: &SessionRow,
) -> Result<Option<(i64, Uuid)>, CadenzaError> {
    let Some(row) = txn
        .query_one_raw(stmt(
            "SELECT m.user_id FROM live_session_members m
             WHERE m.session_id = $1 AND m.user_id <> $2
               AND m.left_at IS NULL AND NOT m.banned
               AND NOT EXISTS (
                   SELECT 1 FROM live_sessions o
                   WHERE o.host_id = m.user_id AND o.ended_at IS NULL
               )
             ORDER BY (m.listen_mode = 'synced') DESC, m.role DESC, m.joined_at
             LIMIT 1",
            vec![session.session_id.into(), session.host_id.into()],
        ))
        .await?
    else {
        return Ok(None);
    };
    let new_host: Uuid = row.try_get("", "user_id")?;

    let queued = queued_entries(txn, session.session_id).await?;
    let here = projected_playback(session, &queued, Utc::now());
    set_anchor(
        txn,
        session.session_id,
        here.entry_id,
        here.is_playing,
        here.position_ms,
        // the new host's phone has to pick it up
        AnchorBy::Command,
    )
    .await?;
    txn.execute_raw(stmt(
        "UPDATE live_sessions SET host_id = $2, host_seen_at = now() WHERE session_id = $1",
        vec![session.session_id.into(), new_host.into()],
    ))
    .await?;
    // the new host always plays; the old one is gone
    txn.execute_raw(stmt(
        "UPDATE live_session_members SET
             listen_mode = CASE WHEN user_id = $3 THEN 'synced'::listen_mode ELSE listen_mode END,
             left_at = CASE WHEN user_id = $2 THEN now() ELSE left_at END
         WHERE session_id = $1 AND user_id IN ($2, $3)",
        vec![
            session.session_id.into(),
            session.host_id.into(),
            new_host.into(),
        ],
    ))
    .await?;
    // a projection that ran past what was current leaves those songs played
    if here.entry_id != session.current_entry_id {
        let before: Vec<i64> = queued
            .iter()
            .take_while(|entry| Some(entry.entry_id) != here.entry_id)
            .map(|entry| entry.entry_id)
            .collect();
        if !before.is_empty() {
            mark_played(txn, session.session_id, &before).await?;
            renumber(txn, session.session_id).await?;
        }
    }
    Ok(Some((bump(txn, session.session_id).await?, new_host)))
}

async fn end_locked(txn: &DatabaseTransaction, session: &SessionRow) -> Result<i64, CadenzaError> {
    txn.execute_raw(stmt(
        "UPDATE live_sessions SET ended_at = now(), is_playing = false WHERE session_id = $1",
        vec![session.session_id.into()],
    ))
    .await?;
    revoke_invites_for(txn, &InviteTargetRef::LiveSession(session.session_id)).await?;
    bump(txn, session.session_id).await
}

/// Ends the session. Host only. Returns the final version.
pub async fn end_session(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
) -> Result<i64, CadenzaError> {
    let txn = db.begin().await?;
    let (session, _) = lock_for(&txn, session_id, user_id, SessionAction::Manage).await?;
    let version = end_locked(&txn, &session).await?;
    txn.commit().await?;
    Ok(version)
}

/// Changes the host's settings. Returns the new version.
pub async fn update_session(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    patch: SessionPatch,
) -> Result<i64, CadenzaError> {
    if patch.name.is_none()
        && patch.default_role.is_none()
        && patch.allow_join_without_code.is_none()
        && patch.listen_along.is_none()
        && patch.approve_joins.is_none()
    {
        return Err(CadenzaError::InvalidRequestBody(
            "set at least one setting".into(),
        ));
    }
    let name = patch
        .name
        .as_deref()
        .map(|name| check_name(name, "session"))
        .transpose()?;
    let txn = db.begin().await?;
    lock_for(&txn, session_id, user_id, SessionAction::Manage).await?;
    txn.execute_raw(stmt(
        "UPDATE live_sessions SET
             name = COALESCE($2, name),
             default_role = COALESCE($3::session_role, default_role),
             allow_join_without_code = COALESCE($4, allow_join_without_code),
             listen_along = COALESCE($5, listen_along),
             approve_joins = COALESCE($6, approve_joins)
         WHERE session_id = $1",
        vec![
            session_id.into(),
            name.into(),
            patch.default_role.into(),
            patch.allow_join_without_code.into(),
            patch.listen_along.into(),
            patch.approve_joins.into(),
        ],
    ))
    .await?;
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Sets a member's role. Host only. Returns the new version.
pub async fn set_member_role(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    member_id: Uuid,
    role: SessionRole,
) -> Result<i64, CadenzaError> {
    let txn = db.begin().await?;
    let (session, _) = lock_for(&txn, session_id, user_id, SessionAction::Manage).await?;
    if member_id == session.host_id {
        return Err(CadenzaError::InvalidRequestBody(
            "the host's role does not change".into(),
        ));
    }
    let updated = txn
        .execute_raw(stmt(
            "UPDATE live_session_members SET role = $3::session_role
             WHERE session_id = $1 AND user_id = $2 AND left_at IS NULL AND NOT banned",
            vec![session_id.into(), member_id.into(), role.into()],
        ))
        .await?;
    if updated.rows_affected() == 0 {
        return Err(CadenzaError::NotFound);
    }
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Removes a member for good: they cannot rejoin, code or not. Host only.
/// Returns the new version.
pub async fn kick_member(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    member_id: Uuid,
) -> Result<i64, CadenzaError> {
    let txn = db.begin().await?;
    let (session, _) = lock_for(&txn, session_id, user_id, SessionAction::Manage).await?;
    if member_id == session.host_id {
        return Err(CadenzaError::InvalidRequestBody(
            "the host cannot remove themselves, end the session instead".into(),
        ));
    }
    let updated = txn
        .execute_raw(stmt(
            "UPDATE live_session_members SET banned = true, left_at = COALESCE(left_at, now())
             WHERE session_id = $1 AND user_id = $2",
            vec![session_id.into(), member_id.into()],
        ))
        .await?;
    if updated.rows_affected() == 0 {
        return Err(CadenzaError::NotFound);
    }
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Sets the caller's own listen mode: `remote` or `synced`. Returns the new
/// version.
pub async fn set_listen_mode(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    mode: ListenMode,
) -> Result<i64, CadenzaError> {
    let txn = db.begin().await?;
    lock_for(&txn, session_id, user_id, SessionAction::View).await?;
    txn.execute_raw(stmt(
        "UPDATE live_session_members SET listen_mode = $3::listen_mode
         WHERE session_id = $1 AND user_id = $2",
        vec![session_id.into(), user_id.into(), mode.into()],
    ))
    .await?;
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Adds songs. A queue editor, controller, or the host queues them where
/// `at` says. A suggester suggests them, wherever `at` says, except that
/// `PlayNow` needs control. A session with nothing current starts on the
/// first song queued, at `starting_at` when given, else from the top and playing.
/// Returns the new version.
pub async fn add_songs(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    songs: &[NewQueueSong],
    at: AddAt,
    starting_at: Option<StartAt>,
) -> Result<i64, CadenzaError> {
    if songs.is_empty() || songs.len() > MAX_SONGS_PER_ADD {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "add 1 to {MAX_SONGS_PER_ADD} songs"
        )));
    }
    if let Some(bad) = songs.iter().find(|song| !is_catalog_id(&song.song_id)) {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "'{}' is a library only song and cannot be shared",
            bad.song_id
        )));
    }
    let txn = db.begin().await?;
    let (session, actor) = lock_for(&txn, session_id, user_id, SessionAction::Suggest).await?;
    let status = add_lands_as(actor)
        .ok_or_else(|| CadenzaError::Forbidden("listeners cannot add songs".into()))?;
    if at == AddAt::PlayNow && !allowed(actor, SessionAction::Control) {
        return Err(CadenzaError::Forbidden(
            "only controllers can play a song right away".into(),
        ));
    }

    let queued = queued_entries(&txn, session_id).await?;
    if status == SessionEntryStatus::Queued && queued.len() as i64 + songs.len() as i64 > MAX_QUEUE
    {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "a session queue holds at most {MAX_QUEUE} songs"
        )));
    }
    // positions for suggestions only order them among themselves
    let start = if status == SessionEntryStatus::Queued {
        let current_index = session
            .current_entry_id
            .and_then(|id| queued.iter().position(|entry| entry.entry_id == id));
        let first_upcoming = current_index.map_or(0, |i| i + 1) as i32;
        let end = queued.len() as i32;
        let index = match at {
            AddAt::End => end,
            AddAt::Position(p) => (first_upcoming + p.max(0)).min(end),
            AddAt::PlayNow => first_upcoming,
        };
        txn.execute_raw(stmt(
            "UPDATE live_session_queue SET position = position + $3
             WHERE session_id = $1 AND status = 'queued' AND position >= $2",
            vec![session_id.into(), index.into(), (songs.len() as i32).into()],
        ))
        .await?;
        index
    } else {
        i32::MAX / 2
    };

    let mut first_added = None;
    for (offset, song) in songs.iter().enumerate() {
        let row = txn
            .query_one_raw(stmt(
            "INSERT INTO live_session_queue
                 (session_id, song_id, title, artist, artwork_url, duration_ms, position, status, added_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::session_entry_status, $9)
             RETURNING entry_id",
            vec![
                session_id.into(),
                song.song_id.clone().into(),
                song.title.trim().to_owned().into(),
                song.artist.clone().into(),
                song.artwork_url.clone().into(),
                song.duration_ms.filter(|ms| *ms > 0).into(),
                (start + offset as i32).into(),
                status.into(),
                user_id.into(),
            ],
        ))
        .await?
            .ok_or(CadenzaError::NotFound)?;
        first_added.get_or_insert(row.try_get::<i64>("", "entry_id")?);
    }
    if status == SessionEntryStatus::Queued {
        renumber(&txn, session_id).await?;
        if at == AddAt::PlayNow {
            advance_to(&txn, &session, first_added, true, AnchorBy::Command).await?;
        } else if session.current_entry_id.is_none()
            // an empty session starts on what was just added
            && let Some(first) = queued_entries(&txn, session_id).await?.first()
        {
            let start = starting_at.unwrap_or(StartAt {
                position_ms: 0,
                is_playing: true,
            });
            set_anchor(
                &txn,
                session_id,
                Some(first.entry_id),
                start.is_playing,
                start.position_ms,
                // a seed is the host's phone saying where it already is
                if starting_at.is_some() {
                    AnchorBy::HostPhone
                } else {
                    AnchorBy::Command
                },
            )
            .await?;
        }
    }
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Approves a suggestion onto the end of the queue, or rejects it. Host only.
/// Returns the new version.
pub async fn review_suggestion(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    entry_id: i64,
    approve: bool,
) -> Result<i64, CadenzaError> {
    let txn = db.begin().await?;
    let (session, _) = lock_for(&txn, session_id, user_id, SessionAction::Review).await?;
    let status = if approve {
        SessionEntryStatus::Queued
    } else {
        SessionEntryStatus::Rejected
    };
    let updated = txn
        .execute_raw(stmt(
            "UPDATE live_session_queue SET status = $3::session_entry_status,
                 position = (SELECT COALESCE(MAX(position) + 1, 0) FROM live_session_queue
                             WHERE session_id = $1 AND status = 'queued')
             WHERE session_id = $1 AND entry_id = $2 AND status = 'suggested'",
            vec![session_id.into(), entry_id.into(), status.into()],
        ))
        .await?;
    if updated.rows_affected() == 0 {
        return Err(CadenzaError::NotFound);
    }
    if approve && session.current_entry_id.is_none() {
        set_anchor(&txn, session_id, Some(entry_id), true, 0, AnchorBy::Command).await?;
    }
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Removes an upcoming entry, or withdraws the caller's own suggestion. The
/// current song is skipped, not removed. Returns the new version.
pub async fn remove_entry(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    entry_id: i64,
) -> Result<i64, CadenzaError> {
    let txn = db.begin().await?;
    let (session, actor) = lock_for(&txn, session_id, user_id, SessionAction::View).await?;
    if session.current_entry_id == Some(entry_id) {
        return Err(CadenzaError::InvalidRequestBody(
            "skip the current song instead of removing it".into(),
        ));
    }
    let row = txn
        .query_one_raw(stmt(
            "SELECT status::text AS status, added_by FROM live_session_queue
             WHERE session_id = $1 AND entry_id = $2",
            vec![session_id.into(), entry_id.into()],
        ))
        .await?
        .ok_or(CadenzaError::NotFound)?;
    let status: SessionEntryStatus = row.try_get("", "status")?;
    let added_by: Option<Uuid> = row.try_get("", "added_by")?;
    let may = match status {
        SessionEntryStatus::Queued => allowed(actor, SessionAction::EditQueue),
        SessionEntryStatus::Suggested => {
            added_by == Some(user_id) || allowed(actor, SessionAction::Review)
        }
        _ => false,
    };
    if !may {
        return Err(CadenzaError::Forbidden(
            "your role in this session does not allow that".into(),
        ));
    }
    txn.execute_raw(stmt(
        "DELETE FROM live_session_queue WHERE session_id = $1 AND entry_id = $2",
        vec![session_id.into(), entry_id.into()],
    ))
    .await?;
    renumber(&txn, session_id).await?;
    refill_for_repeat(&txn, session_id).await?;
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Moves an upcoming entry to `to` among the upcoming songs (0 is next).
/// Returns the new version.
pub async fn move_entry(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    entry_id: i64,
    to: i32,
) -> Result<i64, CadenzaError> {
    let txn = db.begin().await?;
    let (session, _) = lock_for(&txn, session_id, user_id, SessionAction::EditQueue).await?;
    let queued = queued_entries(&txn, session_id).await?;
    let ids: Vec<i64> = upcoming(&queued, session.current_entry_id)
        .iter()
        .map(|entry| entry.entry_id)
        .collect();
    let mut order = moved_order(&ids, entry_id, to).ok_or(CadenzaError::NotFound)?;
    // the current song keeps the front
    if let Some(current) = session.current_entry_id {
        order.insert(0, current);
    }
    write_order(&txn, "live_session_queue", "session_id", session_id, &order).await?;
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Moves the current song to `played` and makes `next` current from 0,
/// playing when `playing` and there is a next.
async fn advance_to(
    txn: &DatabaseTransaction,
    session: &SessionRow,
    next: Option<i64>,
    playing: bool,
    by: AnchorBy,
) -> Result<(), CadenzaError> {
    if let Some(current) = session.current_entry_id {
        mark_played(txn, session.session_id, &[current]).await?;
    }
    let playing = next.is_some() && playing;
    set_anchor(txn, session.session_id, next, playing, 0, by).await?;
    renumber(txn, session.session_id).await?;
    refill_for_repeat(txn, session.session_id).await?;
    Ok(())
}

/// A transport command. Controller or host. Play, pause, seek, shuffle off,
/// and a repeat change that put no songs back move only playback, so the
/// change carries it.
pub async fn playback_command(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    command: PlaybackCommand,
) -> Result<Change, CadenzaError> {
    let txn = db.begin().await?;
    let (session, _) = lock_for(&txn, session_id, user_id, SessionAction::Control).await?;
    let now = Utc::now();
    let queued = queued_entries(&txn, session_id).await?;
    let up_next = upcoming(&queued, session.current_entry_id);
    let here = projected_playback(&session, &queued, now);

    // whether the queue stayed put, so only playback moved
    let only_playback = match command {
        PlaybackCommand::Play | PlaybackCommand::Pause => {
            set_anchor(
                &txn,
                session_id,
                session.current_entry_id,
                command == PlaybackCommand::Play && session.current_entry_id.is_some(),
                here.position_ms,
                AnchorBy::Command,
            )
            .await?;
            true
        }
        PlaybackCommand::Seek { position_ms } => {
            set_anchor(
                &txn,
                session_id,
                session.current_entry_id,
                session.is_playing,
                position_ms,
                AnchorBy::Command,
            )
            .await?;
            true
        }
        PlaybackCommand::Next => {
            advance_to(
                &txn,
                &session,
                up_next.first().map(|entry| entry.entry_id),
                session.is_playing,
                AnchorBy::Command,
            )
            .await?;
            false
        }
        PlaybackCommand::Previous => {
            let last_played = txn
                .query_one_raw(stmt(
                    "SELECT entry_id FROM live_session_queue
                     WHERE session_id = $1 AND status = 'played'
                     ORDER BY played_at DESC NULLS LAST, position DESC, entry_id DESC
                     LIMIT 1",
                    vec![session_id.into()],
                ))
                .await?
                .map(|row| row.try_get::<i64>("", "entry_id"))
                .transpose()?;
            let restart = here.entry_id.is_some() && here.position_ms > RESTART_THRESHOLD_MS;
            match last_played.filter(|_| !restart) {
                Some(entry_id) => {
                    // back in the queue, ahead of what was current
                    txn.execute_raw(stmt(
                        "UPDATE live_session_queue
                         SET status = 'queued', played_at = NULL, position = -1
                         WHERE session_id = $1 AND entry_id = $2",
                        vec![session_id.into(), entry_id.into()],
                    ))
                    .await?;
                    // a session that ran out plays again
                    let playing = session.is_playing || session.current_entry_id.is_none();
                    set_anchor(
                        &txn,
                        session_id,
                        Some(entry_id),
                        playing,
                        0,
                        AnchorBy::Command,
                    )
                    .await?;
                    renumber(&txn, session_id).await?;
                }
                None => {
                    set_anchor(
                        &txn,
                        session_id,
                        session.current_entry_id,
                        session.is_playing,
                        0,
                        AnchorBy::Command,
                    )
                    .await?;
                }
            }
            false
        }
        PlaybackCommand::Shuffle { on } => {
            set_column(&txn, session_id, sessions::Column::Shuffle, on).await?;
            // off keeps the order; on reorders the queue
            if on {
                shuffle_upcoming(&txn, session_id, session.current_entry_id).await?;
            }
            !on
        }
        PlaybackCommand::Repeat { mode } => {
            set_column(&txn, session_id, sessions::Column::RepeatMode, mode).await?;
            !refill_for_repeat(&txn, session_id).await?
        }
        PlaybackCommand::Jump { entry_id } => {
            if !up_next.iter().any(|entry| entry.entry_id == entry_id) {
                return Err(CadenzaError::NotFound);
            }
            // everything before it counts as skipped past, so it leaves the queue
            let skipped: Vec<i64> = up_next
                .iter()
                .take_while(|entry| entry.entry_id != entry_id)
                .map(|entry| entry.entry_id)
                .collect();
            mark_played(&txn, session_id, &skipped).await?;
            advance_to(&txn, &session, Some(entry_id), true, AnchorBy::Command).await?;
            false
        }
    };
    let version = bump(&txn, session_id).await?;
    let playback = if only_playback {
        Some(playback_now(&txn, session_id).await?)
    } else {
        None
    };
    txn.commit().await?;
    Ok(Change { version, playback })
}

/// The host's device saying what it is really doing. Re-anchors on it. When
/// it is on a later queued entry than the server thought, everything before
/// that entry is marked played. Host only. Returns the change, carrying
/// playback when the queue stayed put, or `None` when nothing changed enough
/// to tell anyone.
///
/// `command_seq` is the last command the phone has followed. A report from
/// before a newer one describes playback that command already replaced, so it
/// only counts as the host being there.
pub async fn host_report(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    report: HostReport,
) -> Result<Option<Change>, CadenzaError> {
    let HostReport {
        entry_id,
        position_ms,
        is_playing,
        command_seq,
    } = report;
    let txn = db.begin().await?;
    let (session, _) = lock_for(&txn, session_id, user_id, SessionAction::Report).await?;
    set_column(
        &txn,
        session_id,
        sessions::Column::HostSeenAt,
        Expr::current_timestamp(),
    )
    .await?;
    if command_seq.is_some_and(|seen| seen < session.command_seq) {
        txn.commit().await?;
        return Ok(None);
    }

    let queued = queued_entries(&txn, session_id).await?;
    let known = entry_id.filter(|id| queued.iter().any(|entry| entry.entry_id == *id));
    // where everyone else thinks the phone is, to tell a seek from a heartbeat
    let here = projected_playback(&session, &queued, Utc::now());
    let jumped = known.is_some()
        && known == here.entry_id
        && (here.position_ms - position_ms).abs() > REPORT_JUMP_MS;
    let moved_to = known.filter(|id| Some(*id) != session.current_entry_id);
    let moved_on = moved_to.is_some();
    if let Some(target) = moved_to {
        let before: Vec<i64> = queued
            .iter()
            .take_while(|entry| entry.entry_id != target)
            .map(|entry| entry.entry_id)
            .collect();
        mark_played(&txn, session_id, &before).await?;
        set_anchor(
            &txn,
            session_id,
            Some(target),
            is_playing,
            position_ms,
            AnchorBy::HostPhone,
        )
        .await?;
        renumber(&txn, session_id).await?;
        refill_for_repeat(&txn, session_id).await?;
    } else {
        set_anchor(
            &txn,
            session_id,
            session.current_entry_id,
            is_playing,
            position_ms,
            AnchorBy::HostPhone,
        )
        .await?;
    }

    // a heartbeat that only confirms the projection is not worth an event
    let changed = moved_on || jumped || is_playing != session.is_playing;
    let change = if changed {
        let version = bump(&txn, session_id).await?;
        let playback = if moved_on {
            None
        } else {
            Some(playback_now(&txn, session_id).await?)
        };
        Some(Change { version, playback })
    } else {
        None
    };
    txn.commit().await?;
    Ok(change)
}

/// The host's device reached the end of `from_entry_id`. Guarded by the id,
/// so a double report advances once. Host only. Returns the new version, or
/// `None` when it was already past it.
pub async fn host_advance(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    from_entry_id: i64,
) -> Result<Option<i64>, CadenzaError> {
    let txn = db.begin().await?;
    let (session, _) = lock_for(&txn, session_id, user_id, SessionAction::Report).await?;
    if session.current_entry_id != Some(from_entry_id) {
        txn.commit().await?;
        return Ok(None);
    }
    let queued = queued_entries(&txn, session_id).await?;
    let next = upcoming(&queued, session.current_entry_id)
        .first()
        .map(|entry| entry.entry_id);
    advance_to(
        &txn,
        &session,
        next,
        session.is_playing,
        AnchorBy::HostPhone,
    )
    .await?;
    set_column(
        &txn,
        session_id,
        sessions::Column::HostSeenAt,
        Expr::current_timestamp(),
    )
    .await?;
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(Some(version))
}

/// Checks the caller may make an invite code. Host only.
pub async fn check_can_invite(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
) -> Result<(), CadenzaError> {
    let session = load_session(db, session_id, false)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    if !session.is_open(Utc::now()) {
        return Err(CadenzaError::SessionEnded);
    }
    if session.host_id != user_id {
        return Err(CadenzaError::Forbidden(
            "only the host can make invite codes".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::Duration;

    use super::*;

    fn entry(entry_id: i64, duration_ms: Option<i64>) -> QueueEntry {
        QueueEntry {
            entry_id,
            song_id: entry_id.to_string(),
            title: String::new(),
            artist: None,
            artwork_url: None,
            duration_ms,
            position: 0,
            status: SessionEntryStatus::Queued,
            added_by: None,
            added_by_username: None,
            added_at: Utc::now().fixed_offset(),
        }
    }

    fn session(current: Option<i64>, is_playing: bool, position_ms: i64) -> SessionRow {
        let now = Utc::now().fixed_offset();
        SessionRow {
            session_id: Uuid::nil(),
            host_id: Uuid::nil(),
            host_username: "host".into(),
            name: "s".into(),
            default_role: SessionRole::Suggester,
            allow_join_without_code: true,
            current_entry_id: current,
            is_playing,
            position_ms,
            position_at: now,
            version: 1,
            command_seq: 0,
            host_seen_at: now,
            created_at: now,
            ended_at: None,
            listen_along: false,
            approve_joins: true,
            shuffle: false,
            repeat_mode: RepeatMode::Off,
            has_guests: false,
            host_away_since: None,
            host_closed_app: false,
        }
    }

    #[test]
    fn upcoming_leaves_out_the_current_song() {
        let queued = [entry(1, None), entry(2, None), entry(3, None)];
        let ids: Vec<i64> = upcoming(&queued, Some(1))
            .iter()
            .map(|e| e.entry_id)
            .collect();
        assert_eq!(ids, vec![2, 3]);
    }

    #[test]
    fn playback_projects_into_the_next_entry() {
        let s = session(Some(1), true, 9_000);
        let queued = [entry(1, Some(10_000)), entry(2, Some(60_000))];
        let at = s.position_at.with_timezone(&Utc) + Duration::seconds(3);
        let p = projected_playback(&s, &queued, at);
        assert_eq!(p.entry_id, Some(2));
        assert_eq!(p.position_ms, 2_000);
        assert!(p.is_playing);
    }

    #[test]
    fn an_empty_session_is_not_playing() {
        let s = session(None, true, 0);
        let p = projected_playback(&s, &[], Utc::now());
        assert_eq!(p.entry_id, None);
        assert!(!p.is_playing);
    }

    #[test]
    fn a_quiet_host_closes_the_session() {
        let mut s = session(None, true, 0);
        assert!(s.is_open(Utc::now()));
        s.host_seen_at = (Utc::now() - Duration::minutes(31)).fixed_offset();
        assert!(!s.is_open(Utc::now()));
        // with someone else in it, it stays until the host ends it
        s.has_guests = true;
        assert!(s.is_open(Utc::now()));
    }
}
