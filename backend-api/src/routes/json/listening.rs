use chrono::{DateTime, Utc};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};

use crate::db::{
    entity::now_playing,
    listening_history::RecentPlay as DbRecentPlay,
    now_playing::{
        ListeningUser, NowPlayingUpdate, UpNextSong, projected_position_ms, read_up_next,
    },
};

/// `PUT /listening/now-playing` body. `song_id` is the Apple Music catalog id.
#[derive(Deserialize)]
pub struct PutNowPlaying {
    pub song_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_ms: Option<i64>,
    pub is_playing: bool,
    pub position_ms: i64,
    /// The next songs in the queue. Only the first two are kept.
    #[serde(default)]
    pub up_next: Vec<UpNextSong>,
}

impl From<PutNowPlaying> for NowPlayingUpdate {
    fn from(body: PutNowPlaying) -> Self {
        Self {
            song_id: body.song_id,
            title: body.title,
            artist: body.artist,
            album: body.album,
            artwork_url: body.artwork_url,
            duration_ms: body.duration_ms,
            is_playing: body.is_playing,
            position_ms: body.position_ms,
            up_next: body.up_next,
        }
    }
}

/// A live now playing row. `position_ms` is projected to `as_of`, the server's
/// clock when the response was built.
#[derive(Serialize)]
pub struct NowPlaying {
    pub song_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_ms: Option<i64>,
    pub position_ms: i64,
    pub as_of: DateTime<Utc>,
    pub live_session_id: Option<Uuid>,
    pub up_next: Vec<UpNextSong>,
}

impl NowPlaying {
    pub fn at(row: now_playing::Model, now: DateTime<Utc>) -> Self {
        Self {
            position_ms: projected_position_ms(&row, now),
            up_next: read_up_next(&row.up_next),
            song_id: row.song_id,
            title: row.title,
            artist: row.artist,
            album: row.album,
            artwork_url: row.artwork_url,
            duration_ms: row.duration_ms,
            as_of: now,
            live_session_id: row.live_session_id,
        }
    }
}

/// One friend on the listening now list.
#[derive(Serialize)]
pub struct FriendListening {
    pub user_id: Uuid,
    pub username: String,
    /// `live_session_id` is set when they host or play along in a session.
    pub now_playing: NowPlaying,
    /// The viewer may join that session without a code.
    pub can_join: bool,
}

impl FriendListening {
    pub fn at(user: ListeningUser, now: DateTime<Utc>) -> Self {
        Self {
            user_id: user.user_id,
            username: user.username,
            can_join: user.can_join,
            now_playing: NowPlaying::at(user.now_playing, now),
        }
    }
}

#[derive(Serialize)]
pub struct FriendsListeningResponse {
    pub listening: Vec<FriendListening>,
}

#[derive(Serialize)]
pub struct RecentPlay {
    pub song_id: String,
    pub played_at: DateTime<Utc>,
    pub artist_name: Option<String>,
    pub album_name: Option<String>,
}

impl From<DbRecentPlay> for RecentPlay {
    fn from(play: DbRecentPlay) -> Self {
        Self {
            song_id: play.song_id,
            played_at: play.played_at.with_timezone(&Utc),
            artist_name: play.artist_name,
            album_name: play.album_name,
        }
    }
}

/// What one user's listening shows the viewer. `now_playing` is null when
/// nothing is playing or it is hidden. `recent_plays` is null only when hidden.
#[derive(Serialize)]
pub struct UserListeningResponse {
    pub user_id: Uuid,
    pub now_playing: Option<NowPlaying>,
    pub recent_plays: Option<Vec<RecentPlay>>,
}
