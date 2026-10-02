//! Request and response shapes for `/events` and `/analytics`.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::db::analytics::{SongPlays, SongReplays, TagPlays, TrendPoint};

/// One event as the client sends it. The user id is never in here; it comes from
/// the JWT.
#[derive(Deserialize)]
pub struct EventPayload {
    /// One of `services::analytics::EventType`'s names.
    #[serde(rename = "type")]
    pub event_type: String,
    pub song_id: Option<String>,
    pub occurred_at: DateTime<Utc>,
    /// IANA name, e.g. `America/Denver`. Defaults to UTC when absent.
    #[serde(default)]
    pub client_tz: Option<String>,
    /// The listening sitting this happened in, when the client is tracking one.
    #[serde(default)]
    pub session_id: Option<Uuid>,
    /// Unique per user. Re-sending the same id stores nothing the second time.
    pub client_event_id: String,
    #[serde(default)]
    pub payload: Option<Value>,
}

/// A batch of events. A single event is a batch of one: mobile clients go
/// offline and flush a queue, so there is no single-event endpoint.
#[derive(Deserialize)]
pub struct EventBatchPayload {
    pub events: Vec<EventPayload>,
}

/// What `POST /events` answers with.
#[derive(Serialize)]
pub struct EventBatchResponse {
    /// Every `client_event_id` now stored, including ones an earlier attempt
    /// stored. The client clears exactly these from its queue.
    pub accepted: Vec<String>,
}

/// What `GET /analytics/summary` answers with.
///
/// `stats` is flat and generated from the metric registry, so a new metric shows
/// up here without a client change. `rates` holds the ratios, which are computed
/// from `stats` rather than stored, because averaging a ratio over buckets is
/// not the same as the ratio of the sums.
#[derive(Serialize)]
pub struct AnalyticsSummary {
    pub stats: HashMap<String, i64>,
    pub rates: HashMap<String, f64>,
    /// Distinct local days with at least one counted play.
    pub active_days: i64,
    /// Plays in each hour of the local day, 24 entries, index 0 is midnight.
    pub plays_by_hour: Vec<i64>,
    pub top_songs: Vec<SongPlayCount>,
    pub top_tags: Vec<TagPlayCount>,
    pub most_replayed: Vec<SongReplayCount>,
    /// The window actually used, resolved. Null on both ends means the user has
    /// no events at all.
    pub window: ResolvedWindow,
}

#[derive(Serialize)]
pub struct ResolvedWindow {
    pub since: Option<DateTime<Utc>>,
    pub until: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct SongPlayCount {
    pub song_id: String,
    pub plays: i64,
}

impl From<SongPlays> for SongPlayCount {
    fn from(value: SongPlays) -> Self {
        Self {
            song_id: value.song_id,
            plays: value.plays,
        }
    }
}

#[derive(Serialize)]
pub struct TagPlayCount {
    pub name: String,
    pub color: String,
    pub plays: i64,
}

impl From<TagPlays> for TagPlayCount {
    fn from(value: TagPlays) -> Self {
        Self {
            name: value.name,
            color: value.color,
            plays: value.plays,
        }
    }
}

#[derive(Serialize)]
pub struct SongReplayCount {
    pub song_id: String,
    pub most_in_one_session: i64,
    pub plays: i64,
}

impl From<SongReplays> for SongReplayCount {
    fn from(value: SongReplays) -> Self {
        Self {
            song_id: value.song_id,
            most_in_one_session: value.most_in_one_session,
            plays: value.plays,
        }
    }
}

/// What `GET /analytics/trends` answers with.
#[derive(Serialize)]
pub struct AnalyticsTrend {
    pub metric: String,
    pub description: String,
    pub bucket: String,
    /// Dense: one point per bucket in the window, zero where nothing happened.
    pub points: Vec<TrendBucket>,
}

#[derive(Serialize)]
pub struct TrendBucket {
    /// The bucket's first local day, `YYYY-MM-DD`.
    pub bucket: String,
    pub value: i64,
}

impl From<TrendPoint> for TrendBucket {
    fn from(value: TrendPoint) -> Self {
        Self {
            bucket: value.bucket,
            value: value.value,
        }
    }
}

/// What `GET /analytics/metrics` answers with: the registry, so a client can
/// build its own metric picker without hardcoding the list.
#[derive(Serialize)]
pub struct MetricInfo {
    pub name: String,
    pub description: String,
}
