use chrono::{DateTime, Utc};

pub struct UserSongAttributes {
    pub play_count: u32,
    pub is_favorite: bool,
    pub is_hidden: bool,
    pub added_at: DateTime<Utc>,
}