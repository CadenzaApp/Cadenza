//! Request and response shapes for `/events` and `/analytics`.

use std::collections::HashMap;

pub mod listening;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::db::analytics::{
    CellTag, EntityPlays, HeatmapCell, SongReplays, TagListening, TagPlays, TagShares, TrendPoint,
};
use crate::routes::json::tag::TagType;
use crate::services::analytics::metrics::MetricUnit;

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
    /// Distinct tags on songs with a counted play. Not capped like `top_tags`.
    pub tags_played: i64,
    /// Plays in each hour of the local day, 24 entries, index 0 is midnight.
    pub plays_by_hour: Vec<i64>,
    /// A ranking per dimension, keyed by its name, the same way `stats` is keyed
    /// by metric name. Built from the registry, so a new dimension appears here
    /// without a new field.
    pub top: HashMap<String, Vec<EntityPlayCount>>,
    pub top_tags: Vec<TagPlayCount>,
    pub most_replayed: Vec<SongReplayCount>,
}

/// One row of a ranking, whatever it is a ranking of.
///
/// `label` is null for songs: Apple Music owns song titles and the api never
/// stores one, so the client resolves those from `sample_song_id`. It resolves
/// every row's artwork from that same id in one batch.
#[derive(Serialize)]
pub struct EntityPlayCount {
    pub key: String,
    pub label: Option<String>,
    pub sub_label: Option<String>,
    pub entity_id: Option<String>,
    pub sample_song_id: String,
    pub plays: i64,
}

impl From<EntityPlays> for EntityPlayCount {
    fn from(value: EntityPlays) -> Self {
        Self {
            key: value.key,
            label: value.label,
            sub_label: value.sub_label,
            entity_id: value.entity_id,
            sample_song_id: value.sample_song_id,
            plays: value.plays,
        }
    }
}

/// A tag and its plays, flat, so the client can draw it with the same tag
/// component as everywhere else.
#[derive(Serialize)]
pub struct TagPlayCount {
    pub id: i64,
    pub name: String,
    pub color: String,
    #[serde(rename = "type")]
    pub tag_type: TagType,
    pub plays: i64,
    /// The tag's most played song in the window, to draw a cover from.
    pub sample_song_id: String,
}

impl From<TagPlays> for TagPlayCount {
    fn from(value: TagPlays) -> Self {
        Self {
            id: value.tag_id,
            name: value.name,
            color: value.color,
            tag_type: value.tag_type.into(),
            plays: value.plays,
            sample_song_id: value.sample_song_id,
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
    /// What the values mean, so the client can format them without knowing the
    /// metric by name.
    pub unit: MetricUnit,
    pub bucket: String,
    /// Dense: one point per bucket in the window, zero where nothing happened.
    pub points: Vec<TrendBucket>,
}

#[derive(Serialize)]
pub struct TrendBucket {
    /// The bucket's first local day, `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MI` for
    /// an hour bucket.
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

/// What `GET /analytics/top` answers with.
#[derive(Serialize)]
pub struct AnalyticsTopList {
    pub dimension: String,
    pub description: String,
    pub entries: Vec<EntityPlayCount>,
}

/// What `GET /analytics/top-tags` answers with.
#[derive(Serialize)]
pub struct AnalyticsTopTags {
    pub entries: Vec<TagPlayCount>,
}

/// What `GET /analytics/tag-shares` answers with.
#[derive(Serialize)]
pub struct AnalyticsTagShares {
    pub total_ms: i64,
    pub tagged_ms: i64,
    pub tags: Vec<TagListeningTime>,
}

#[derive(Serialize)]
pub struct TagListeningTime {
    pub id: i64,
    pub name: String,
    pub color: String,
    #[serde(rename = "type")]
    pub tag_type: TagType,
    pub listening_ms: i64,
}

impl From<TagListening> for TagListeningTime {
    fn from(value: TagListening) -> Self {
        Self {
            id: value.tag_id,
            name: value.name,
            color: value.color,
            tag_type: value.tag_type.into(),
            listening_ms: value.listening_ms,
        }
    }
}

impl From<TagShares> for AnalyticsTagShares {
    fn from(value: TagShares) -> Self {
        Self {
            total_ms: value.total_ms,
            tagged_ms: value.tagged_ms,
            tags: value.tags.into_iter().map(Into::into).collect(),
        }
    }
}

/// What `GET /analytics/heatmap` answers with.
#[derive(Serialize)]
pub struct AnalyticsHeatmap {
    pub bucket: String,
    /// Sparse: only buckets with a play.
    pub cells: Vec<HeatmapEntry>,
    /// Every tag a cell names, once each, so a cell carries only the id.
    pub tags: Vec<HeatmapTag>,
}

#[derive(Serialize)]
pub struct HeatmapEntry {
    /// Local bucket start, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MI`.
    pub start: String,
    pub plays: i64,
    pub tag_id: Option<i64>,
}

#[derive(Serialize)]
pub struct HeatmapTag {
    pub id: i64,
    pub name: String,
    pub color: String,
}

impl From<CellTag> for HeatmapTag {
    fn from(value: CellTag) -> Self {
        Self {
            id: value.tag_id,
            name: value.name,
            color: value.color,
        }
    }
}

impl AnalyticsHeatmap {
    /// Splits each cell's tag out into the shared list, first seen first.
    pub fn new(bucket: String, cells: Vec<HeatmapCell>) -> Self {
        let mut tags: Vec<HeatmapTag> = Vec::new();
        let cells = cells
            .into_iter()
            .map(|cell| {
                let tag_id = cell.tag.map(|tag| {
                    let id = tag.tag_id;
                    if !tags.iter().any(|seen| seen.id == id) {
                        tags.push(tag.into());
                    }
                    id
                });
                HeatmapEntry {
                    start: cell.start,
                    plays: cell.plays,
                    tag_id,
                }
            })
            .collect();
        Self {
            bucket,
            cells,
            tags,
        }
    }
}
