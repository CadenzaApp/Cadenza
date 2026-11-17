use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};

use crate::db::entity::saved_queries;
use crate::db::saved_queries::{SavedSong, read_artwork_urls};

/// One saved query as the api returns it.
#[derive(Serialize)]
pub struct SavedQuery {
    pub saved_query_id: i64,
    pub name: String,
    /// The same shape `POST /queries/results` takes.
    pub query: serde_json::Value,
    pub consider_default_tags: bool,
    pub library_or_tagged: bool,
    pub favorite: bool,
    /// The cover the results screen showed, up to 4 urls. Empty when none was sent.
    pub artwork_urls: Vec<String>,
    /// How many songs it holds.
    pub song_count: i64,
    pub created_at: DateTime<FixedOffset>,
    /// When its songs were last stored. Null until they first are.
    pub songs_stored_at: Option<DateTime<FixedOffset>>,
    /// Shown on the user's profile.
    pub shared: bool,
}

impl SavedQuery {
    pub fn new(model: saved_queries::Model, song_count: i64) -> Self {
        Self {
            saved_query_id: model.saved_query_id,
            artwork_urls: read_artwork_urls(model.artwork_urls.as_ref()),
            name: model.name,
            query: model.query,
            consider_default_tags: model.consider_default_tags,
            library_or_tagged: model.library_or_tagged,
            favorite: model.favorite,
            song_count,
            created_at: model.created_at,
            songs_stored_at: model.songs_stored_at,
            shared: model.shared,
        }
    }
}

/// A query shared on a profile, as another user sees it. Leaves out the query itself,
/// whose tag ids only mean something to its owner.
#[derive(Serialize)]
pub struct ProfileQuery {
    pub saved_query_id: i64,
    pub name: String,
    pub artwork_urls: Vec<String>,
    pub song_count: i64,
}

impl ProfileQuery {
    pub fn new(model: saved_queries::Model, song_count: i64) -> Self {
        Self {
            saved_query_id: model.saved_query_id,
            artwork_urls: read_artwork_urls(model.artwork_urls.as_ref()),
            name: model.name,
            song_count,
        }
    }
}

/// The response of `GET /saved-queries/users/{user_id}`. `queries` is null when hidden.
#[derive(Serialize)]
pub struct ProfileQueriesResponse {
    pub queries: Option<Vec<ProfileQuery>>,
}

/// The body of `POST /saved-queries`.
#[derive(Deserialize)]
pub struct NewSavedQueryBody {
    pub name: String,
    pub query: serde_json::Value,
    #[serde(default)]
    pub consider_default_tags: bool,
    #[serde(default)]
    pub library_or_tagged: bool,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub artwork_urls: Option<Vec<String>>,
}

/// The body of `PATCH /saved-queries/{id}`. A missing key is left alone.
#[derive(Deserialize)]
pub struct PatchSavedQueryBody {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub favorite: Option<bool>,
    #[serde(default)]
    pub artwork_urls: Option<Vec<String>>,
    #[serde(default)]
    pub shared: Option<bool>,
}

/// One song a saved query holds.
#[derive(Serialize)]
pub struct SavedQuerySong {
    pub song_id: String,
    pub certain: bool,
}

impl From<SavedSong> for SavedQuerySong {
    fn from(song: SavedSong) -> Self {
        Self {
            song_id: song.song_id,
            certain: song.certain,
        }
    }
}

/// The response of `GET /saved-queries/{id}/songs`.
#[derive(Serialize)]
pub struct SavedQuerySongs {
    pub songs: Vec<SavedQuerySong>,
}
