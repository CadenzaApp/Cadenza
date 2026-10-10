//! Responses for the listening calendar and recorded sessions.

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::db::analytics::listening as db;

#[derive(Serialize)]
pub struct Listening {
    pub total_ms: i64,
    pub listening_ms: i64,
    pub plays: i64,
    pub session_count: i64,
    pub cells: Vec<Cell>,
}

#[derive(Serialize)]
pub struct Cell {
    pub start: String,
    pub listening_ms: i64,
    pub plays: i64,
}

impl From<db::Listening> for Listening {
    fn from(value: db::Listening) -> Self {
        Self {
            total_ms: value.total_ms,
            listening_ms: value.listening_ms,
            plays: value.plays,
            session_count: value.session_count,
            cells: value
                .cells
                .into_iter()
                .map(|cell| Cell {
                    start: cell.start,
                    listening_ms: cell.listening_ms,
                    plays: cell.plays,
                })
                .collect(),
        }
    }
}

#[derive(Serialize)]
pub struct Session {
    pub key: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub listening_ms: i64,
    pub plays: i64,
}

impl From<db::Session> for Session {
    fn from(value: db::Session) -> Self {
        Self {
            key: value.key,
            start: value.start,
            end: value.end,
            listening_ms: value.listening_ms,
            plays: value.plays,
        }
    }
}

#[derive(Serialize)]
pub struct SessionSong {
    pub song_id: String,
    pub listening_ms: i64,
    pub plays: i64,
    pub tags: Vec<String>,
}

impl From<db::SessionSong> for SessionSong {
    fn from(value: db::SessionSong) -> Self {
        Self {
            song_id: value.song_id,
            listening_ms: value.listening_ms,
            plays: value.plays,
            tags: value.tags,
        }
    }
}

#[derive(Serialize)]
pub struct Page<T> {
    pub entries: Vec<T>,
    pub has_more: bool,
}

impl<T> Page<T> {
    pub fn new<V: Into<T>>(mut entries: Vec<V>, limit: usize) -> Self {
        let has_more = entries.len() > limit;
        entries.truncate(limit);
        Self {
            entries: entries.into_iter().map(Into::into).collect(),
            has_more,
        }
    }
}
