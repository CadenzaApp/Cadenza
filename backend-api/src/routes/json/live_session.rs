use chrono::{DateTime, Utc};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};

use crate::db::live_sessions::{NewQueueSong, QueueEntry, SessionMember, SessionSnapshot};
use crate::services::live_sessions::{Actor, SessionRole};

#[derive(Deserialize)]
pub struct StartLiveSession {
    pub name: String,
    /// What new members join as. Default `suggester`.
    pub default_role: Option<String>,
    /// Default true: anyone the host's `session_join` audience allows can join
    /// without a code.
    pub allow_join_without_code: Option<bool>,
    /// Opened by listen along: joins check the host's `listen_along` audience
    /// instead of `session_join`. Default false.
    #[serde(default)]
    pub listen_along: bool,
}

#[derive(Serialize)]
pub struct LiveSessionId {
    pub session_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct LiveSessionMember {
    pub user_id: Uuid,
    pub username: String,
    pub role: String,
    pub listen_mode: String,
    pub is_host: bool,
    pub joined_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct LiveSessionEntry {
    pub entry_id: i64,
    pub song_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_ms: Option<i64>,
    pub status: String,
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
}

#[derive(Serialize)]
pub struct LiveSessionSnapshot {
    pub session_id: Uuid,
    pub name: String,
    pub host: LiveSessionMember,
    pub default_role: String,
    pub allow_join_without_code: bool,
    /// Opened by listen along, and not turned into a regular session since.
    pub listen_along: bool,
    pub version: i64,
    /// `host`, or the caller's role.
    pub my_role: String,
    pub my_listen_mode: String,
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
                role: m.role.clone(),
                listen_mode: m.listen_mode.clone(),
                is_host: true,
                joined_at: m.joined_at,
            })
            .unwrap_or(LiveSessionMember {
                user_id: host_id,
                username: session.host_username.clone(),
                role: SessionRole::Controller.as_str().to_owned(),
                listen_mode: "synced".to_owned(),
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
            version: session.version,
            my_role: match snapshot.me {
                Actor::Host => "host".to_owned(),
                Actor::Member(role) => role.as_str().to_owned(),
            },
            my_listen_mode: snapshot.my_listen_mode,
            members,
            current: snapshot.current.map(Into::into),
            up_next: snapshot.up_next.into_iter().map(Into::into).collect(),
            suggestions: snapshot.suggestions.into_iter().map(Into::into).collect(),
            playback: LiveSessionPlayback {
                entry_id: snapshot.playback.entry_id,
                position_ms: snapshot.playback.position_ms,
                is_playing: snapshot.playback.is_playing,
                as_of: snapshot.playback.as_of,
                command_seq: session.command_seq,
            },
            created_at: session.created_at.with_timezone(&Utc),
        }
    }
}

#[derive(Deserialize)]
pub struct PatchLiveSession {
    pub name: Option<String>,
    pub default_role: Option<String>,
    pub allow_join_without_code: Option<bool>,
    /// False turns a listen along session into a regular one.
    pub listen_along: Option<bool>,
}

#[derive(Deserialize)]
pub struct SetLiveSessionRole {
    pub role: String,
}

#[derive(Deserialize)]
pub struct SetListenMode {
    /// `remote` or `synced`.
    pub listen_mode: String,
}

#[derive(Deserialize)]
pub struct QueueSong {
    pub song_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_ms: Option<i64>,
}

impl From<QueueSong> for NewQueueSong {
    fn from(song: QueueSong) -> Self {
        Self {
            song_id: song.song_id,
            title: song.title,
            artist: song.artist,
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
    Jump {
        entry_id: i64,
    },
    Report {
        entry_id: Option<i64>,
        position_ms: i64,
        is_playing: bool,
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
}
