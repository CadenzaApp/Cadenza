use chrono::{DateTime, Utc};
use sea_orm::{ActiveEnum, prelude::Uuid};
use serde::{Deserialize, Serialize};

use crate::db::entity::sea_orm_active_enums::ListenMode;
use crate::db::live_sessions::{
    NewQueueSong, PlaybackNow, ProjectedPlayback, QueueEntry, SessionMember, SessionRow,
    SessionSnapshot,
};
use crate::services::live_sessions::{
    Actor, RepeatMode, SessionAction, SessionEntryStatus, SessionRole, allowed,
};

#[derive(Deserialize)]
pub struct StartLiveSession {
    pub name: String,
    /// What new members join as. Default `suggester`.
    pub default_role: Option<SessionRole>,
    /// Default true: anyone the host's `session_join` audience allows can join
    /// without a code.
    pub allow_join_without_code: Option<bool>,
    /// Opened by listen along: joins check the host's `listen_along` audience
    /// instead of `session_join`. Default false.
    #[serde(default)]
    pub listen_along: bool,
    /// Someone joining without a code asks first. Default true.
    pub approve_joins: Option<bool>,
}

#[derive(Serialize)]
pub struct LiveSessionId {
    pub session_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct LiveSessionMember {
    pub user_id: Uuid,
    pub username: String,
    pub role: SessionRole,
    pub listen_mode: ListenMode,
    pub is_host: bool,
    pub joined_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct LiveSessionEntry {
    pub entry_id: i64,
    pub song_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_id: Option<String>,
    pub artist_id: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_ms: Option<i64>,
    pub status: SessionEntryStatus,
    /// Order among entries of the same status.
    pub position: i32,
    pub added_by: Option<Uuid>,
    pub added_by_username: Option<String>,
    pub added_at: DateTime<Utc>,
}

impl From<QueueEntry> for LiveSessionEntry {
    fn from(entry: QueueEntry) -> Self {
        Self {
            entry_id: entry.entry_id,
            song_id: entry.song_id,
            title: entry.title,
            artist: entry.artist,
            album: entry.album,
            album_id: entry.album_id,
            artist_id: entry.artist_id,
            artwork_url: entry.artwork_url,
            duration_ms: entry.duration_ms,
            status: entry.status,
            position: entry.position,
            added_by: entry.added_by,
            added_by_username: entry.added_by_username,
            added_at: entry.added_at.with_timezone(&Utc),
        }
    }
}

/// Where playback is, projected to `as_of` (server clock). `command_seq`
/// moves only when someone other than the host's phone changes playback.
#[derive(Serialize)]
pub struct LiveSessionPlayback {
    pub entry_id: Option<i64>,
    pub position_ms: i64,
    pub is_playing: bool,
    pub as_of: DateTime<Utc>,
    pub command_seq: i64,
    pub shuffle: bool,
    pub repeat_mode: RepeatMode,
}

impl LiveSessionPlayback {
    fn new(projected: &ProjectedPlayback, session: &SessionRow) -> Self {
        Self {
            entry_id: projected.entry_id,
            position_ms: projected.position_ms,
            is_playing: projected.is_playing,
            as_of: projected.as_of,
            command_seq: session.command_seq,
            shuffle: session.shuffle,
            repeat_mode: session.repeat_mode,
        }
    }
}

impl From<&PlaybackNow> for LiveSessionPlayback {
    fn from(now: &PlaybackNow) -> Self {
        Self::new(&now.projected, &now.session)
    }
}

#[derive(Serialize)]
pub struct LiveSessionSnapshot {
    pub session_id: Uuid,
    pub name: String,
    pub host: LiveSessionMember,
    pub default_role: SessionRole,
    pub allow_join_without_code: bool,
    /// Opened by listen along, and not turned into a regular session since.
    pub listen_along: bool,
    /// Anyone besides the host was ever let in. A listen along session shows
    /// as live from then on.
    pub went_live: bool,
    pub approve_joins: bool,
    /// Waiting to be let in. Only the host sees them.
    pub join_requests: Vec<LiveSessionJoinRequest>,
    pub version: i64,
    /// `host`, or the caller's role.
    pub my_role: String,
    /// What the caller's role allows, so the app never keeps its own table.
    pub can: SessionPermissions,
    pub my_listen_mode: ListenMode,
    pub members: Vec<LiveSessionMember>,
    /// The entry the anchor is on. `playback.entry_id` can be later, when the
    /// projection has walked past it.
    pub current: Option<LiveSessionEntry>,
    pub up_next: Vec<LiveSessionEntry>,
    pub suggestions: Vec<LiveSessionEntry>,
    pub playback: LiveSessionPlayback,
    pub created_at: DateTime<Utc>,
}

fn member(row: SessionMember, host_id: Uuid) -> LiveSessionMember {
    LiveSessionMember {
        is_host: row.user_id == host_id,
        user_id: row.user_id,
        username: row.username,
        role: row.role,
        listen_mode: row.listen_mode,
        joined_at: row.joined_at.with_timezone(&Utc),
    }
}

impl From<SessionSnapshot> for LiveSessionSnapshot {
    fn from(snapshot: SessionSnapshot) -> Self {
        let session = snapshot.session;
        let playback = LiveSessionPlayback::new(&snapshot.playback, &session);
        let host_id = session.host_id;
        let members: Vec<LiveSessionMember> = snapshot
            .members
            .into_iter()
            .map(|row| member(row, host_id))
            .collect();
        let host = members
            .iter()
            .find(|m| m.is_host)
            .map(|m| LiveSessionMember {
                user_id: m.user_id,
                username: m.username.clone(),
                role: m.role,
                listen_mode: m.listen_mode,
                is_host: true,
                joined_at: m.joined_at,
            })
            .unwrap_or(LiveSessionMember {
                user_id: host_id,
                username: session.host_username.clone(),
                role: SessionRole::Controller,
                listen_mode: ListenMode::Synced,
                is_host: true,
                joined_at: session.created_at.with_timezone(&Utc),
            });
        Self {
            session_id: session.session_id,
            name: session.name,
            host,
            default_role: session.default_role,
            allow_join_without_code: session.allow_join_without_code,
            listen_along: session.listen_along,
            went_live: session.went_live,
            approve_joins: session.approve_joins,
            join_requests: snapshot
                .join_requests
                .into_iter()
                .map(|request| LiveSessionJoinRequest {
                    user_id: request.user_id,
                    username: request.username,
                    requested_at: request.requested_at.with_timezone(&Utc),
                })
                .collect(),
            version: session.version,
            can: snapshot.me.into(),
            my_role: match snapshot.me {
                Actor::Host => "host".to_owned(),
                Actor::Member(role) => role.to_value(),
            },
            my_listen_mode: snapshot.my_listen_mode,
            members,
            current: snapshot.current.map(Into::into),
            up_next: snapshot.up_next.into_iter().map(Into::into).collect(),
            suggestions: snapshot.suggestions.into_iter().map(Into::into).collect(),
            playback,
            created_at: session.created_at.with_timezone(&Utc),
        }
    }
}

/// [`allowed`] for each action the app gates on.
#[derive(Serialize)]
pub struct SessionPermissions {
    pub suggest: bool,
    pub edit_queue: bool,
    pub control: bool,
    pub review: bool,
    pub manage: bool,
}

impl From<Actor> for SessionPermissions {
    fn from(actor: Actor) -> Self {
        let can = |action| allowed(actor, action);
        Self {
            suggest: can(SessionAction::Suggest),
            edit_queue: can(SessionAction::EditQueue),
            control: can(SessionAction::Control),
            review: can(SessionAction::Review),
            manage: can(SessionAction::Manage),
        }
    }
}

#[derive(Serialize)]
pub struct LiveSessionJoinRequest {
    pub user_id: Uuid,
    pub username: String,
    pub requested_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct PatchLiveSession {
    pub name: Option<String>,
    pub default_role: Option<SessionRole>,
    pub allow_join_without_code: Option<bool>,
    /// False turns a listen along session into a regular one.
    pub listen_along: Option<bool>,
    pub approve_joins: Option<bool>,
}

#[derive(Deserialize)]
pub struct AnswerJoinRequest {
    pub accept: bool,
}

/// `joined` when in the session now, `asked` when the host has to let them in.
#[derive(Serialize)]
pub struct JoinResult {
    pub version: i64,
    pub status: &'static str,
}

/// [`JoinResult`] plus which session, for joining someone from Listening now.
#[derive(Serialize)]
pub struct JoinListeningResult {
    pub session_id: Uuid,
    pub version: i64,
    pub status: &'static str,
}

#[derive(Deserialize)]
pub struct SetLiveSessionRole {
    pub role: SessionRole,
}

/// `POST /live-sessions/{id}/host` body: the member who hosts next.
#[derive(Deserialize)]
pub struct TransferHost {
    pub user_id: Uuid,
}

#[derive(Deserialize)]
pub struct SetListenMode {
    pub listen_mode: ListenMode,
}

#[derive(Deserialize)]
pub struct QueueSong {
    pub song_id: String,
    pub title: String,
    pub artist: Option<String>,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub album_id: Option<String>,
    #[serde(default)]
    pub artist_id: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_ms: Option<i64>,
}

impl From<QueueSong> for NewQueueSong {
    fn from(song: QueueSong) -> Self {
        Self {
            song_id: song.song_id,
            title: song.title,
            artist: song.artist,
            album: song.album,
            album_id: song.album_id,
            artist_id: song.artist_id,
            artwork_url: song.artwork_url,
            duration_ms: song.duration_ms,
        }
    }
}

#[derive(Deserialize)]
pub struct AddToQueue {
    pub songs: Vec<QueueSong>,
    /// Among the upcoming songs, 0 is next. Missing means the end.
    pub position: Option<i32>,
    /// Puts them next and plays the first right away. Controllers and the
    /// host only. Overrides `position`.
    #[serde(default)]
    pub play_now: bool,
    /// Where playback is on the host's phone, for a session with nothing
    /// current yet, like one just started from what was already playing.
    /// Missing starts the first song from the top.
    pub start_position_ms: Option<i64>,
    pub start_playing: Option<bool>,
}

/// `PATCH /live-sessions/{id}/queue/{entry_id}`.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum QueueEntryAction {
    Move { position: i32 },
    Approve,
    Reject,
}

/// `POST /live-sessions/{id}/playback`. Controllers send the commands; only
/// the host's device sends `report` and `advance`.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlaybackBody {
    Play,
    Pause,
    Seek {
        position_ms: i64,
    },
    Next,
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
    Report {
        entry_id: Option<i64>,
        position_ms: i64,
        is_playing: bool,
        /// The last `command_seq` the phone followed.
        command_seq: Option<i64>,
    },
    Advance {
        from_entry_id: i64,
    },
}

#[derive(Serialize)]
pub struct SessionVersion {
    /// Null when nothing changed, like a report that only confirmed the
    /// projection.
    pub version: Option<i64>,
    pub ended: bool,
    /// The new playback, when the write moved only that. The `playback`
    /// event carries the same.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playback: Option<LiveSessionPlayback>,
}
