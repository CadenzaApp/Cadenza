//! Live sessions: `live_sessions`, `live_session_members`, `live_session_queue`.
//!
//! Each write is one transaction: lock the session row, work out the caller
//! (host or a member and their role), check `services::live_sessions::allowed`,
//! write, bump `version`. The caller publishes the new version after commit.
//!
//! The queue: `queued` entries in `position` order are what will play. The
//! current one is `current_entry_id` and stays `queued` until it ends, when it
//! becomes `played`. `suggested` entries wait for the host, who approves them
//! onto the end of the queue or rejects them.
//!
//! A non member reads `NotFound`, so a session id does not leak. The host
//! leaving ends the session; host transfer was the other option and is left
//! for later.

use chrono::{DateTime, FixedOffset, Utc};
use sea_orm::{
    ConnectionTrait, DatabaseTransaction, DbBackend, FromQueryResult, Statement, Value,
    prelude::Uuid,
};

use crate::db::Db;
use crate::db::{
    audience::{PrivacyField, can_see_field},
    invites::{InviteTargetRef, revoke_invites_for},
    now_playing::is_catalog_id,
};
use crate::err::CadenzaError;
use crate::services::live_sessions::{
    Actor, Anchor, Projected, SessionAction, SessionRole, add_lands_as, allowed, host_timed_out,
    project,
};

/// The most songs one add carries, and the most upcoming entries a queue holds.
pub const MAX_SONGS_PER_ADD: usize = 100;
pub const MAX_QUEUE: i64 = 500;

fn stmt(sql: &str, values: Vec<Value>) -> Statement {
    Statement::from_sql_and_values(DbBackend::Postgres, sql, values)
}

#[derive(Clone, Debug, FromQueryResult)]
pub struct SessionRow {
    pub session_id: Uuid,
    pub host_id: Uuid,
    pub host_username: String,
    pub name: String,
    pub default_role: String,
    pub allow_join_without_code: bool,
    pub current_entry_id: Option<i64>,
    pub is_playing: bool,
    pub position_ms: i64,
    pub position_at: DateTime<FixedOffset>,
    pub version: i64,
    pub host_seen_at: DateTime<FixedOffset>,
    pub created_at: DateTime<FixedOffset>,
    pub ended_at: Option<DateTime<FixedOffset>>,
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
        self.ended_at.is_none() && !host_timed_out(self.host_seen_at.with_timezone(&Utc), now)
    }
}

const SESSION_COLUMNS: &str =
    "s.session_id, s.host_id, COALESCE(h.username, 'unknown') AS host_username,
     s.name, s.default_role::text AS default_role, s.allow_join_without_code,
     s.current_entry_id, s.is_playing, s.position_ms, s.position_at, s.version,
     s.host_seen_at, s.created_at, s.ended_at";

#[derive(Clone, Debug, FromQueryResult)]
pub struct SessionMember {
    pub user_id: Uuid,
    pub username: String,
    pub role: String,
    pub listen_mode: String,
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
    pub status: String,
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

/// Everything a member's screen shows.
#[derive(Clone, Debug)]
pub struct SessionSnapshot {
    pub session: SessionRow,
    pub me: Actor,
    pub my_listen_mode: String,
    pub members: Vec<SessionMember>,
    pub current: Option<QueueEntry>,
    pub up_next: Vec<QueueEntry>,
    pub suggestions: Vec<QueueEntry>,
    pub playback: ProjectedPlayback,
}

/// Settings a host can change.
#[derive(Clone, Debug, Default)]
pub struct SessionPatch {
    pub name: Option<String>,
    pub default_role: Option<SessionRole>,
    pub allow_join_without_code: Option<bool>,
}

/// A transport command from a controller or the host.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlaybackCommand {
    Play,
    Pause,
    Seek { position_ms: i64 },
    Next,
    Jump { entry_id: i64 },
}

fn check_name(name: &str) -> Result<String, CadenzaError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(CadenzaError::InvalidRequestBody(
            "a session name is 1 to 100 characters".into(),
        ));
    }
    Ok(name.to_owned())
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
            "SELECT {SESSION_COLUMNS} FROM live_sessions s
             LEFT JOIN profile h ON h.uid = s.host_id
             WHERE s.session_id = $1 {lock}"
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
        Some(row) => {
            let role: String = row.try_get("", "role")?;
            SessionRole::parse(&role).map(Actor::Member)
        }
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

/// Sets the anchor. `current_entry_id` changes only when `entry` is `Some`.
async fn set_anchor(
    txn: &DatabaseTransaction,
    session_id: Uuid,
    entry: Option<Option<i64>>,
    is_playing: bool,
    position_ms: i64,
) -> Result<(), CadenzaError> {
    match entry {
        Some(entry_id) => {
            txn.execute_raw(stmt(
                "UPDATE live_sessions
                 SET current_entry_id = $2, is_playing = $3, position_ms = $4, position_at = now()
                 WHERE session_id = $1",
                vec![
                    session_id.into(),
                    entry_id.into(),
                    is_playing.into(),
                    position_ms.max(0).into(),
                ],
            ))
            .await?
        }
        None => {
            txn.execute_raw(stmt(
                "UPDATE live_sessions
                 SET is_playing = $2, position_ms = $3, position_at = now()
                 WHERE session_id = $1",
                vec![
                    session_id.into(),
                    is_playing.into(),
                    position_ms.max(0).into(),
                ],
            ))
            .await?
        }
    };
    Ok(())
}

/// Queued entries in play order, the current one included.
async fn queued_entries<C: ConnectionTrait>(
    db: &C,
    session_id: Uuid,
) -> Result<Vec<QueueEntry>, CadenzaError> {
    entries_with_status(db, session_id, "queued").await
}

async fn entries_with_status<C: ConnectionTrait>(
    db: &C,
    session_id: Uuid,
    status: &str,
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

/// Starts a session hosted by `host_id`, or returns the open one they already
/// have, so a double tap does not fail. Returns its id.
pub async fn start_session(
    db: &impl Db,
    host_id: Uuid,
    name: &str,
    default_role: SessionRole,
    allow_join_without_code: bool,
) -> Result<Uuid, CadenzaError> {
    let name = check_name(name)?;
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
            "INSERT INTO live_sessions (host_id, name, default_role, allow_join_without_code)
             VALUES ($1, $2, $3::session_role, $4) RETURNING session_id",
            vec![
                host_id.into(),
                name.into(),
                default_role.as_str().into(),
                allow_join_without_code.into(),
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
        "UPDATE live_sessions SET ended_at = now(), is_playing = false, version = version + 1
         WHERE host_id = $1 AND ended_at IS NULL
           AND host_seen_at < now() - interval '30 minutes'",
        vec![host_id.into()],
    ))
    .await?;
    Ok(())
}

/// The open session `user_id` hosts or is in, if any. Newest first, since
/// someone could be in more than one.
pub async fn current_session_id(db: &impl Db, user_id: Uuid) -> Result<Option<Uuid>, CadenzaError> {
    let row = db
        .query_one_raw(stmt(
            "SELECT s.session_id FROM live_session_members m
             JOIN live_sessions s ON s.session_id = m.session_id
             WHERE m.user_id = $1 AND m.left_at IS NULL AND NOT m.banned
               AND s.ended_at IS NULL
               AND s.host_seen_at > now() - interval '30 minutes'
             ORDER BY (s.host_id = $1) DESC, m.joined_at DESC
             LIMIT 1",
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
        .map(|member| member.listen_mode.clone())
        .unwrap_or_else(|| "remote".to_owned());

    let queued = queued_entries(db, session_id).await?;
    let current = session
        .current_entry_id
        .and_then(|id| queued.iter().find(|entry| entry.entry_id == id).cloned());
    let up_next = upcoming(&queued, session.current_entry_id);
    let suggestions = entries_with_status(db, session_id, "suggested").await?;
    let playback = projected_playback(&session, current.as_ref(), &up_next, now);

    Ok(SessionSnapshot {
        session,
        me,
        my_listen_mode,
        members,
        current,
        up_next,
        suggestions,
        playback,
    })
}

/// The anchor walked forward through the queue to `now`.
pub fn projected_playback(
    session: &SessionRow,
    current: Option<&QueueEntry>,
    up_next: &[QueueEntry],
    now: DateTime<Utc>,
) -> ProjectedPlayback {
    let Some(current) = current else {
        return ProjectedPlayback {
            entry_id: None,
            position_ms: 0,
            is_playing: false,
            as_of: now,
        };
    };
    let durations: Vec<Option<i64>> = std::iter::once(current.duration_ms)
        .chain(up_next.iter().map(|entry| entry.duration_ms))
        .collect();
    let Projected {
        entries_ahead,
        position_ms,
        finished,
    } = project(session.anchor(), &durations, now);
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

/// Joins as the session's default role, or rejoins with the role held before.
/// Without a code the session must be open to joins and the host's
/// `session_join` audience must allow the caller. A banned member cannot
/// rejoin either way. Returns the new version.
pub async fn join_session(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    via_code: bool,
) -> Result<i64, CadenzaError> {
    let txn = db.begin().await?;
    let session = load_session(&txn, session_id, true)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    if !session.is_open(Utc::now()) {
        return Err(CadenzaError::SessionEnded);
    }
    if session.host_id == user_id {
        txn.commit().await?;
        return Ok(session.version);
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
        let open_to_audience = session.allow_join_without_code
            && can_see_field(&txn, user_id, session.host_id, PrivacyField::SessionJoin).await?;
        if !open_to_audience {
            return Err(CadenzaError::Forbidden(
                "this session needs an invite code".into(),
            ));
        }
    }
    txn.execute_raw(stmt(
        "INSERT INTO live_session_members (session_id, user_id, role)
         VALUES ($1, $2, $3::session_role)
         ON CONFLICT (session_id, user_id)
         DO UPDATE SET left_at = NULL, joined_at = now()",
        vec![
            session_id.into(),
            user_id.into(),
            session.default_role.clone().into(),
        ],
    ))
    .await?;
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// What leaving did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Left {
    /// Still going, at this version.
    Left(i64),
    /// The host left, so it ended, at this version.
    Ended(i64),
}

/// Leaves. The host leaving ends the session.
pub async fn leave_session(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
) -> Result<Left, CadenzaError> {
    let txn = db.begin().await?;
    let (session, actor) = lock_for(&txn, session_id, user_id, SessionAction::View).await?;
    if actor == Actor::Host {
        let version = end_locked(&txn, &session).await?;
        txn.commit().await?;
        return Ok(Left::Ended(version));
    }
    txn.execute_raw(stmt(
        "UPDATE live_session_members SET left_at = now()
         WHERE session_id = $1 AND user_id = $2",
        vec![session_id.into(), user_id.into()],
    ))
    .await?;
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(Left::Left(version))
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
    {
        return Err(CadenzaError::InvalidRequestBody(
            "set at least one setting".into(),
        ));
    }
    let name = patch.name.as_deref().map(check_name).transpose()?;
    let txn = db.begin().await?;
    lock_for(&txn, session_id, user_id, SessionAction::Manage).await?;
    txn.execute_raw(stmt(
        "UPDATE live_sessions SET
             name = COALESCE($2, name),
             default_role = COALESCE($3::session_role, default_role),
             allow_join_without_code = COALESCE($4, allow_join_without_code)
         WHERE session_id = $1",
        vec![
            session_id.into(),
            name.into(),
            patch.default_role.map(|role| role.as_str()).into(),
            patch.allow_join_without_code.into(),
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
            vec![session_id.into(), member_id.into(), role.as_str().into()],
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
    mode: &str,
) -> Result<i64, CadenzaError> {
    if mode != "remote" && mode != "synced" {
        return Err(CadenzaError::InvalidRequestBody(
            "listen mode is remote or synced".into(),
        ));
    }
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

/// Adds songs. A queue editor, controller, or the host queues them at
/// `position` among the upcoming songs (or the end). A suggester suggests
/// them. Returns the new version.
pub async fn add_songs(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    songs: &[NewQueueSong],
    position: Option<i32>,
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

    let queued = queued_entries(&txn, session_id).await?;
    if status == "queued" && queued.len() as i64 + songs.len() as i64 > MAX_QUEUE {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "a session queue holds at most {MAX_QUEUE} songs"
        )));
    }
    // positions for suggestions only order them among themselves
    let start = if status == "queued" {
        let current_index = session
            .current_entry_id
            .and_then(|id| queued.iter().position(|entry| entry.entry_id == id));
        let first_upcoming = current_index.map_or(0, |i| i + 1) as i32;
        let end = queued.len() as i32;
        let at = position.map_or(end, |p| (first_upcoming + p.max(0)).min(end));
        txn.execute_raw(stmt(
            "UPDATE live_session_queue SET position = position + $3
             WHERE session_id = $1 AND status = 'queued' AND position >= $2",
            vec![session_id.into(), at.into(), (songs.len() as i32).into()],
        ))
        .await?;
        at
    } else {
        i32::MAX / 2
    };

    for (offset, song) in songs.iter().enumerate() {
        txn.execute_raw(stmt(
            "INSERT INTO live_session_queue
                 (session_id, song_id, title, artist, artwork_url, duration_ms, position, status, added_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::session_entry_status, $9)",
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
        .await?;
    }
    if status == "queued" {
        renumber(&txn, session_id).await?;
        // an empty session starts on what was just added
        if session.current_entry_id.is_none()
            && let Some(first) = queued_entries(&txn, session_id).await?.first()
        {
            set_anchor(&txn, session_id, Some(Some(first.entry_id)), true, 0).await?;
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
    let status = if approve { "queued" } else { "rejected" };
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
        set_anchor(&txn, session_id, Some(Some(entry_id)), true, 0).await?;
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
    let status: String = row.try_get("", "status")?;
    let added_by: Option<Uuid> = row.try_get("", "added_by")?;
    let own_suggestion = status == "suggested" && added_by == Some(user_id);
    let may = match status.as_str() {
        "queued" => allowed(actor, SessionAction::EditQueue),
        "suggested" => own_suggestion || allowed(actor, SessionAction::Review),
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
    let mut order: Vec<i64> = upcoming(&queued, session.current_entry_id)
        .iter()
        .map(|entry| entry.entry_id)
        .collect();
    let from = order
        .iter()
        .position(|id| *id == entry_id)
        .ok_or(CadenzaError::NotFound)?;
    let moved = order.remove(from);
    order.insert((to.max(0) as usize).min(order.len()), moved);
    // the current song keeps the front
    if let Some(current) = session.current_entry_id {
        order.insert(0, current);
    }
    txn.execute_raw(stmt(
        "UPDATE live_session_queue q SET position = t.ord::int - 1
         FROM unnest($2::bigint[]) WITH ORDINALITY AS t(entry_id, ord)
         WHERE q.session_id = $1 AND q.entry_id = t.entry_id",
        vec![
            session_id.into(),
            crate::db::shared_playlists::bigint_array(&order),
        ],
    ))
    .await?;
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Moves the current song to `played` and makes `next` current, playing from 0.
async fn advance_to(
    txn: &DatabaseTransaction,
    session: &SessionRow,
    next: Option<i64>,
) -> Result<(), CadenzaError> {
    if let Some(current) = session.current_entry_id {
        txn.execute_raw(stmt(
            "UPDATE live_session_queue SET status = 'played'
             WHERE session_id = $1 AND entry_id = $2",
            vec![session.session_id.into(), current.into()],
        ))
        .await?;
    }
    let playing = next.is_some() && session.is_playing;
    set_anchor(txn, session.session_id, Some(next), playing, 0).await?;
    renumber(txn, session.session_id).await
}

/// A transport command. Controller or host. Returns the new version.
pub async fn playback_command(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    command: PlaybackCommand,
) -> Result<i64, CadenzaError> {
    let txn = db.begin().await?;
    let (session, _) = lock_for(&txn, session_id, user_id, SessionAction::Control).await?;
    let now = Utc::now();
    let queued = queued_entries(&txn, session_id).await?;
    let current = session
        .current_entry_id
        .and_then(|id| queued.iter().find(|entry| entry.entry_id == id));
    let up_next = upcoming(&queued, session.current_entry_id);
    let here = projected_playback(&session, current, &up_next, now);

    match command {
        PlaybackCommand::Play | PlaybackCommand::Pause => {
            set_anchor(
                &txn,
                session_id,
                None,
                command == PlaybackCommand::Play && session.current_entry_id.is_some(),
                here.position_ms,
            )
            .await?;
        }
        PlaybackCommand::Seek { position_ms } => {
            set_anchor(&txn, session_id, None, session.is_playing, position_ms).await?;
        }
        PlaybackCommand::Next => {
            advance_to(&txn, &session, up_next.first().map(|entry| entry.entry_id)).await?;
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
            if !skipped.is_empty() {
                txn.execute_raw(stmt(
                    "UPDATE live_session_queue SET status = 'played'
                     WHERE session_id = $1 AND entry_id = ANY($2)",
                    vec![
                        session_id.into(),
                        crate::db::shared_playlists::bigint_array(&skipped),
                    ],
                ))
                .await?;
            }
            let playing = SessionRow {
                is_playing: true,
                ..session.clone()
            };
            advance_to(&txn, &playing, Some(entry_id)).await?;
        }
    }
    let version = bump(&txn, session_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// The host's device saying what it is really doing. Re-anchors on it. When
/// it is on a later queued entry than the server thought, everything before
/// that entry is marked played. Host only. Returns the new version, or `None`
/// when nothing changed enough to tell anyone.
pub async fn host_report(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    entry_id: Option<i64>,
    position_ms: i64,
    is_playing: bool,
) -> Result<Option<i64>, CadenzaError> {
    let txn = db.begin().await?;
    let (session, _) = lock_for(&txn, session_id, user_id, SessionAction::Report).await?;
    txn.execute_raw(stmt(
        "UPDATE live_sessions SET host_seen_at = now() WHERE session_id = $1",
        vec![session_id.into()],
    ))
    .await?;

    let queued = queued_entries(&txn, session_id).await?;
    let known = entry_id.filter(|id| queued.iter().any(|entry| entry.entry_id == *id));
    let moved_on = known.is_some() && known != session.current_entry_id;
    if moved_on {
        let target = known.unwrap();
        let before: Vec<i64> = queued
            .iter()
            .take_while(|entry| entry.entry_id != target)
            .map(|entry| entry.entry_id)
            .collect();
        if !before.is_empty() {
            txn.execute_raw(stmt(
                "UPDATE live_session_queue SET status = 'played'
                 WHERE session_id = $1 AND entry_id = ANY($2)",
                vec![
                    session_id.into(),
                    crate::db::shared_playlists::bigint_array(&before),
                ],
            ))
            .await?;
        }
        set_anchor(
            &txn,
            session_id,
            Some(Some(target)),
            is_playing,
            position_ms,
        )
        .await?;
        renumber(&txn, session_id).await?;
    } else {
        set_anchor(&txn, session_id, None, is_playing, position_ms).await?;
    }

    // a heartbeat that only confirms the projection is not worth an event
    let changed = moved_on || is_playing != session.is_playing;
    let version = if changed {
        Some(bump(&txn, session_id).await?)
    } else {
        None
    };
    txn.commit().await?;
    Ok(version)
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
    advance_to(&txn, &session, next).await?;
    txn.execute_raw(stmt(
        "UPDATE live_sessions SET host_seen_at = now() WHERE session_id = $1",
        vec![session_id.into()],
    ))
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
            status: "queued".into(),
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
            default_role: "suggester".into(),
            allow_join_without_code: true,
            current_entry_id: current,
            is_playing,
            position_ms,
            position_at: now,
            version: 1,
            host_seen_at: now,
            created_at: now,
            ended_at: None,
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
        let current = entry(1, Some(10_000));
        let next = [entry(2, Some(60_000))];
        let at = s.position_at.with_timezone(&Utc) + Duration::seconds(3);
        let p = projected_playback(&s, Some(&current), &next, at);
        assert_eq!(p.entry_id, Some(2));
        assert_eq!(p.position_ms, 2_000);
        assert!(p.is_playing);
    }

    #[test]
    fn an_empty_session_is_not_playing() {
        let s = session(None, true, 0);
        let p = projected_playback(&s, None, &[], Utc::now());
        assert_eq!(p.entry_id, None);
        assert!(!p.is_playing);
    }

    #[test]
    fn a_quiet_host_closes_the_session() {
        let mut s = session(None, false, 0);
        assert!(s.is_open(Utc::now()));
        s.host_seen_at = (Utc::now() - Duration::minutes(31)).fixed_offset();
        assert!(!s.is_open(Utc::now()));
    }
}
