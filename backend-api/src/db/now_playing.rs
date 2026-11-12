//! What each user is playing right now, one row per user in `now_playing`.
//! Current state only. When or how often a song was played is
//! `listening_events`.
//!
//! The client writes a row on a track change, a play or pause, a seek, and a
//! heartbeat while playing. A row counts as playing only while [`is_live`], so
//! a phone that stops reporting drops off on its own.

use chrono::{DateTime, Duration, FixedOffset, Utc};
use sea_orm::{
    ActiveValue::Set, ConnectionTrait, DbBackend, EntityTrait, FromQueryResult, Statement,
    prelude::Uuid, sea_query::OnConflict,
};

use serde::{Deserialize, Serialize};

use crate::db::{
    audience::{PrivacyField, can_see_field, visible_friend_ids},
    entity::now_playing::{self, Column},
    live_sessions::{HAS_GUESTS_SQL, OPEN_SESSION_SQL},
};
use crate::err::CadenzaError;

/// How long past a song's projected end a row still counts as playing, so a
/// late heartbeat or a slow next track does not blink it off.
pub const LIVE_GRACE: Duration = Duration::seconds(60);

/// How long a row with no known duration counts as playing after its last
/// write. The heartbeat is a minute, so two missed ones drop it.
pub const UNKNOWN_DURATION_LIVE: Duration = Duration::seconds(120);

/// The most up next songs a row keeps. The card has room for two.
pub const MAX_UP_NEXT: usize = 2;

/// One song after the current one in the player's queue, for display.
/// `song_id` is null for a library only song, since its id means nothing to
/// anyone else.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpNextSong {
    pub song_id: Option<String>,
    pub title: String,
    pub artist: Option<String>,
    pub artwork_url: Option<String>,
}

/// One write from the player. The server stamps `position_at` with its own
/// clock, so a phone with a wrong clock still projects right.
#[derive(Clone, Debug)]
pub struct NowPlayingUpdate {
    /// Apple Music catalog id.
    pub song_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_ms: Option<i64>,
    pub is_playing: bool,
    pub position_ms: i64,
    /// The next songs in the queue, first first. Trimmed to [`MAX_UP_NEXT`].
    pub up_next: Vec<UpNextSong>,
}

/// A live row and whose it is, for the friends listening list.
#[derive(Clone, Debug)]
pub struct ListeningUser {
    pub user_id: Uuid,
    pub username: String,
    /// `live_session_id` is the open session they host or play along in,
    /// when it shows as live: anything but a listen along session nobody
    /// joined.
    pub now_playing: now_playing::Model,
    /// The viewer may join without a code: that session, or with none, a
    /// listen along session made for them by joining.
    pub can_join: bool,
    /// In a live session that shows as live, so listed even while paused.
    pub in_live_session: bool,
}

/// Whether `song_id` can be shared. A library id (`i.` prefix) means nothing on
/// another account, so only catalog ids cross users.
pub fn is_catalog_id(song_id: &str) -> bool {
    !song_id.is_empty() && !song_id.starts_with("i.")
}

/// Whether the row still counts as playing at `now`: playing, and the song
/// would not have ended more than [`LIVE_GRACE`] ago.
pub fn is_live(row: &now_playing::Model, now: DateTime<Utc>) -> bool {
    if !row.is_playing {
        return false;
    }
    let ends_at = match row.duration_ms {
        Some(duration_ms) => {
            let left = (duration_ms - row.position_ms).max(0);
            row.position_at.with_timezone(&Utc) + Duration::milliseconds(left) + LIVE_GRACE
        }
        None => row.updated_at.with_timezone(&Utc) + UNKNOWN_DURATION_LIVE,
    };
    ends_at > now
}

/// Where the song is at `now`, projected from the anchor. Never past the end.
pub fn projected_position_ms(row: &now_playing::Model, now: DateTime<Utc>) -> i64 {
    let mut position = row.position_ms;
    if row.is_playing {
        position += (now - row.position_at.with_timezone(&Utc))
            .num_milliseconds()
            .max(0);
    }
    match row.duration_ms {
        Some(duration_ms) => position.min(duration_ms),
        None => position,
    }
}

/// Writes the user's current state, replacing what was there.
/// `InvalidRequestBody` for a library song id or a negative position.
pub async fn upsert_now_playing(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    update: NowPlayingUpdate,
) -> Result<(), CadenzaError> {
    if !is_catalog_id(&update.song_id) {
        return Err(CadenzaError::InvalidRequestBody(
            "only catalog songs can be shared".into(),
        ));
    }
    if update.position_ms < 0 || update.duration_ms.is_some_and(|ms| ms <= 0) {
        return Err(CadenzaError::InvalidRequestBody(
            "position and duration must not be negative".into(),
        ));
    }

    let now = Utc::now().fixed_offset();
    let row = now_playing::ActiveModel {
        user_id: Set(user_id),
        song_id: Set(update.song_id),
        title: Set(update.title),
        artist: Set(update.artist),
        album: Set(update.album),
        artwork_url: Set(update.artwork_url),
        duration_ms: Set(update.duration_ms),
        is_playing: Set(update.is_playing),
        position_ms: Set(update.position_ms),
        position_at: Set(now),
        live_session_id: Set(None),
        up_next: Set(serde_json::json!(clean_up_next(update.up_next))),
        updated_at: Set(now),
    };
    now_playing::Entity::insert(row)
        .on_conflict(
            OnConflict::column(Column::UserId)
                .update_columns([
                    Column::SongId,
                    Column::Title,
                    Column::Artist,
                    Column::Album,
                    Column::ArtworkUrl,
                    Column::DurationMs,
                    Column::IsPlaying,
                    Column::PositionMs,
                    Column::PositionAt,
                    Column::UpNext,
                    Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec_without_returning(db)
        .await?;
    Ok(())
}

/// At most [`MAX_UP_NEXT`] songs, with any library id dropped.
fn clean_up_next(mut songs: Vec<UpNextSong>) -> Vec<UpNextSong> {
    songs.truncate(MAX_UP_NEXT);
    for song in &mut songs {
        if song.song_id.as_deref().is_some_and(|id| !is_catalog_id(id)) {
            song.song_id = None;
        }
    }
    songs
}

/// A stored up next list, or empty when it is not shaped like one.
pub fn read_up_next(stored: &serde_json::Value) -> Vec<UpNextSong> {
    serde_json::from_value(stored.clone()).unwrap_or_default()
}

/// Removes the user's row. A missing row is a no-op.
pub async fn clear_now_playing(
    db: &impl ConnectionTrait,
    user_id: Uuid,
) -> Result<(), CadenzaError> {
    now_playing::Entity::delete_by_id(user_id).exec(db).await?;
    Ok(())
}

/// What `owner` is playing, when `viewer` may see it and it is live.
pub async fn now_playing_for_viewer(
    db: &impl ConnectionTrait,
    viewer: Uuid,
    owner: Uuid,
) -> Result<Option<now_playing::Model>, CadenzaError> {
    if !can_see_field(db, viewer, owner, PrivacyField::NowPlaying).await? {
        return Ok(None);
    }
    let row = now_playing::Entity::find_by_id(owner).one(db).await?;
    let now = Utc::now();
    Ok(row.filter(|row| is_live(row, now)))
}

#[derive(FromQueryResult)]
struct ListeningRow {
    username: String,
    user_id: Uuid,
    song_id: String,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    artwork_url: Option<String>,
    duration_ms: Option<i64>,
    is_playing: bool,
    position_ms: i64,
    position_at: DateTime<FixedOffset>,
    live_session_id: Option<Uuid>,
    up_next: serde_json::Value,
    updated_at: DateTime<FixedOffset>,
    can_join: bool,
    shows_live: bool,
}

/// `viewer`'s friends who are playing something now and let friends see it,
/// most recently updated first. A friend in a live session stays on the list
/// while it is open, paused or not.
pub async fn friends_listening(
    db: &impl ConnectionTrait,
    viewer: Uuid,
) -> Result<Vec<ListeningUser>, CadenzaError> {
    let ids = visible_friend_ids(db, viewer, PrivacyField::NowPlaying).await?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows = ListeningRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        &format!(
            "SELECT f.user_id, COALESCE(p.username, 'unknown') AS username,
                -- their phone's row, or with none (they stopped the music) the
                -- song their session is on, or the session's name
                COALESCE(np.song_id, ce.song_id, '') AS song_id,
                COALESCE(np.title, ce.title, ls.name) AS title,
                CASE WHEN np.user_id IS NULL THEN ce.artist ELSE np.artist END AS artist,
                np.album,
                CASE WHEN np.user_id IS NULL THEN ce.artwork_url ELSE np.artwork_url END
                    AS artwork_url,
                CASE WHEN np.user_id IS NULL THEN ce.duration_ms ELSE np.duration_ms END
                    AS duration_ms,
                COALESCE(np.is_playing, ls.is_playing AND ce.entry_id IS NOT NULL, false)
                    AS is_playing,
                COALESCE(np.position_ms, ls.position_ms, 0) AS position_ms,
                COALESCE(np.position_at, ls.position_at, now()) AS position_at,
                COALESCE(np.up_next, '[]'::jsonb) AS up_next,
                COALESCE(np.updated_at, ls.position_at, now()) AS updated_at,
                ls.session_id AS live_session_id,
                COALESCE(ls.shows_live, false) AS shows_live,
                -- with no session, joining makes a listen along one, so the
                -- listen along audience decides; the viewer is a friend
                COALESCE(
                    ls.can_join,
                    COALESCE(op.listen_along, 'nobody') IN ('friends', 'everyone')
                ) AS can_join
         FROM unnest($1::uuid[]) AS f(user_id)
         LEFT JOIN now_playing np ON np.user_id = f.user_id
         LEFT JOIN profile p ON p.uid = f.user_id
         LEFT JOIN privacy_settings op ON op.user_id = f.user_id
         -- the open session they host, or play along in on their own device
         LEFT JOIN LATERAL (
             SELECT s.session_id, s.name, s.current_entry_id, s.is_playing,
                    s.position_ms, s.position_at,
                    s.allow_join_without_code
                    AND NOT EXISTS (
                        SELECT 1 FROM live_session_members b
                        WHERE b.session_id = s.session_id AND b.user_id = $2 AND b.banned
                    )
                    -- a listen along session has its own audience, off by default
                    AND CASE CASE WHEN s.listen_along
                                  THEN COALESCE(hp.listen_along, 'nobody')
                                  ELSE COALESCE(hp.session_join, 'friends') END
                        WHEN 'everyone' THEN true
                        WHEN 'friends' THEN s.host_id = $2 OR EXISTS (
                            SELECT 1 FROM friendships fr
                            WHERE fr.status = 'complete'
                              AND fr.user1 = LEAST(s.host_id, $2)
                              AND fr.user2 = GREATEST(s.host_id, $2)
                        )
                        ELSE false
                    END AS can_join,
                    NOT s.listen_along OR {has_guests} AS shows_live
             FROM live_session_members m
             JOIN live_sessions s ON s.session_id = m.session_id
             LEFT JOIN privacy_settings hp ON hp.user_id = s.host_id
             WHERE m.user_id = f.user_id AND m.left_at IS NULL AND NOT m.banned
               AND {open}
               AND (s.host_id = f.user_id OR m.listen_mode = 'synced')
             ORDER BY (s.host_id = f.user_id) DESC
             LIMIT 1
         ) ls ON true
         LEFT JOIN live_session_queue ce ON ce.entry_id = ls.current_entry_id
         WHERE np.is_playing OR COALESCE(ls.shows_live, false)
         ORDER BY COALESCE(np.updated_at, ls.position_at) DESC",
            open = *OPEN_SESSION_SQL,
            has_guests = HAS_GUESTS_SQL,
        ),
        vec![ids.to_vec().into(), viewer.into()],
    ))
    .all(db)
    .await?;

    let now = Utc::now();
    Ok(rows
        .into_iter()
        .map(|row| ListeningUser {
            in_live_session: row.shows_live,
            user_id: row.user_id,
            username: row.username,
            can_join: row.can_join,
            now_playing: now_playing::Model {
                user_id: row.user_id,
                song_id: row.song_id,
                title: row.title,
                artist: row.artist,
                album: row.album,
                artwork_url: row.artwork_url,
                duration_ms: row.duration_ms,
                is_playing: row.is_playing,
                position_ms: row.position_ms,
                position_at: row.position_at,
                live_session_id: row.live_session_id.filter(|_| row.shows_live),
                up_next: row.up_next,
                updated_at: row.updated_at,
            },
        })
        .filter(|user| user.in_live_session || is_live(&user.now_playing, now))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(is_playing: bool, duration_ms: Option<i64>, position_ms: i64) -> now_playing::Model {
        let at = Utc::now().fixed_offset();
        now_playing::Model {
            user_id: Uuid::nil(),
            song_id: "1".into(),
            title: "song".into(),
            artist: None,
            album: None,
            artwork_url: None,
            duration_ms,
            is_playing,
            position_ms,
            position_at: at,
            live_session_id: None,
            up_next: serde_json::json!([]),
            updated_at: at,
        }
    }

    #[test]
    fn up_next_keeps_two_and_drops_library_ids() {
        let song = |id: &str| UpNextSong {
            song_id: Some(id.into()),
            title: "t".into(),
            artist: None,
            artwork_url: None,
        };
        let cleaned = clean_up_next(vec![song("1"), song("i.abc"), song("3")]);
        assert_eq!(cleaned.len(), 2);
        assert_eq!(cleaned[0].song_id.as_deref(), Some("1"));
        assert_eq!(cleaned[1].song_id, None);
        assert_eq!(read_up_next(&serde_json::json!({"a": 1})), vec![]);
    }

    #[test]
    fn library_ids_cannot_be_shared() {
        assert!(is_catalog_id("1440857781"));
        assert!(!is_catalog_id("i.abc123"));
        assert!(!is_catalog_id(""));
    }

    #[test]
    fn live_until_the_song_ends_plus_grace() {
        let playing = row(true, Some(200_000), 50_000);
        let anchor = playing.position_at.with_timezone(&Utc);
        assert!(is_live(&playing, anchor + Duration::seconds(150)));
        assert!(is_live(&playing, anchor + Duration::seconds(209)));
        assert!(!is_live(&playing, anchor + Duration::seconds(211)));
    }

    #[test]
    fn paused_is_never_live() {
        let paused = row(false, Some(200_000), 0);
        assert!(!is_live(&paused, paused.position_at.with_timezone(&Utc)));
    }

    #[test]
    fn unknown_duration_lives_off_the_last_write() {
        let playing = row(true, None, 0);
        let written = playing.updated_at.with_timezone(&Utc);
        assert!(is_live(&playing, written + Duration::seconds(119)));
        assert!(!is_live(&playing, written + Duration::seconds(121)));
    }

    #[test]
    fn position_projects_while_playing_and_stops_at_the_end() {
        let playing = row(true, Some(10_000), 4_000);
        let anchor = playing.position_at.with_timezone(&Utc);
        assert_eq!(
            projected_position_ms(&playing, anchor + Duration::seconds(3)),
            7_000
        );
        assert_eq!(
            projected_position_ms(&playing, anchor + Duration::seconds(30)),
            10_000
        );
        let paused = row(false, Some(10_000), 4_000);
        assert_eq!(
            projected_position_ms(&paused, anchor + Duration::seconds(3)),
            4_000
        );
    }
}
