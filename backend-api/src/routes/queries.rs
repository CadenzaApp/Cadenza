use crate::db;
use crate::db::queries::{Arrangement, QueryOptions};
use crate::db::settings::get_settings;
use crate::err::CadenzaError;
use crate::routes::json::metadata_tag::metadata_tags_of;
use crate::routes::json::query::{
    ArrangeField, MetadataKey, Query, QueryGroup, QueryResults, QuerySort,
};
use crate::services::metadata_tags::{song_rows_for_list, store_metadata_before_sorting};
use crate::services::song_metadata::SongMetadataService;
use crate::{AppState, auth::SupabaseClaims};
use axum::routing::post;
use axum::{Json, Router, extract::State};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
struct QueryResultsBody {
    query: Query,
    /// Defaults to false, so a caller that predates suggested tags keeps seeing
    /// only its own tags.
    #[serde(default)]
    consider_default_tags: bool,
    /// Defaults to false: the query runs over every song Cadenza knows.
    #[serde(default)]
    library_only: bool,
    /// Defaults to false. True hides explicit songs even when the caller's
    /// saved setting does not.
    #[serde(default)]
    hide_explicit: bool,
    /// Omitted for the query's own order.
    #[serde(default)]
    sort: Option<QuerySort>,
    /// Omitted for no groups.
    #[serde(default)]
    group: Option<QueryGroup>,
    /// The IANA zone a datetime group counts its days in. UTC when omitted.
    #[serde(default)]
    time_zone: Option<String>,
}

/// Returns every song matching the given query, in order. See
/// `routes::json::query::Query` for the shape of `query`, `QuerySort` for `sort`, and
/// `QueryGroup` for `group`.
///
/// The query runs over every song Cadenza knows: the caller's library (their rows in
/// `user_songs`, which `PATCH /songs` keeps in step with Apple Music), every song carrying
/// one of their tags, and every song stored in `metadata_song_tags_applied`. That is what
/// lets a negative filter match a song with no tags on it at all, including songs the
/// caller does not have.
///
/// `certain` marks a song in the caller's library or carrying one of their tags. Without a
/// `sort` or `group`, those come first and every one of them comes back, then only the
/// first `db::queries::MAX_DISCOVERED_SONGS` of the rest. With either, only the first
/// `db::queries::MAX_ARRANGED_SONGS` songs in that order come back, the caller's or not.
/// `capped` says when more matched.
///
/// A sorted or grouped query first stores the metadata of the caller's songs that have none,
/// so the sort has a row for each. It waits on Apple for a few; any more are stored on their
/// own task and come back in `missing_metadata` this time.
///
/// A sorted or grouped query's songs also carry `row`, what the song's row shows, from its
/// stored metadata, so the phone draws the list without asking Apple for every song. A song
/// with no stored title has none. `artwork_url` is left out until it is stored.
///
/// `consider_default_tags` widens what counts as a tag on a song to include the
/// shared default tags, for matching and for ranking, and lets the query name a
/// default tag id. A sort or group may name a default tag either way.
///
/// `library_only` narrows the songs to the caller's `user_songs` rows alone. Every match
/// is then `certain`, and `capped` is always false.
///
/// Explicit songs (by stored metadata) are dropped before the cap when the caller's saved
/// Hide explicit content setting is on, or when `hide_explicit` is true.
///
/// Request JSON:
/// ```json
/// {
///   "query": { "where": { "filter": { "field": "tag", "tag_id": 3, "op": "is_not_applied" } } },
///   "consider_default_tags": false,
///   "library_only": false,
///   "hide_explicit": false,
///   "sort": { "field": "metadata", "key": "title", "direction": "ascending" },
///   "group": { "field": "tag", "tag_id": 9, "direction": "ascending" },
///   "time_zone": "America/Denver"
/// }
/// ```
///
/// JSON return value format (see `json::query::QueryResults`):
/// ```json
/// {
///   "songs": [
///     {
///       "song_id": "songid1",
///       "certain": true,
///       "row": {
///         "title": "Purple Rain",
///         "artist_name": "Prince",
///         "album_name": "Purple Rain",
///         "album_id": "1440857781",
///         "duration_ms": 521000,
///         "artwork_url": "https://is1-ssl.mzstatic.com/image/thumb/.../512x512bb.jpg"
///       }
///     },
///     { "song_id": "songid2", "certain": false }
///   ],
///   "capped": false,
///   "groups": [{ "state": "value", "value": "true", "count": 2 }],
///   "missing_metadata": []
/// }
/// ```
async fn query_results_handler(
    State(db): State<DatabaseConnection>,
    State(song_meta_service): State<SongMetadataService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<QueryResultsBody>,
) -> Result<Json<QueryResults>, CadenzaError> {
    let arrangement = Arrangement {
        sort: body.sort,
        group: body.group,
        time_zone: body.time_zone,
    };
    // the saved setting applies whatever the caller sends, so a caller that
    // forgets the flag cannot show explicit songs to a user who hid them
    let hide_explicit =
        body.hide_explicit || get_settings(&db, claims.user_id).await?.hide_explicit;
    let options = QueryOptions {
        consider_default_tags: body.consider_default_tags,
        library_only: body.library_only,
        hide_explicit,
    };
    let sorted_by = sorted_metadata_key(&arrangement);
    let arranged = !arrangement.is_none();
    if arranged {
        let own = db::queries::get_own_song_ids(&db, claims.user_id, body.library_only).await?;
        store_metadata_before_sorting(&db, &song_meta_service, &own).await;
    }

    let mut results: QueryResults =
        db::queries::run_query(&db, &body.query, claims.user_id, options, &arrangement)
            .await?
            .into();
    if arranged {
        let song_ids: Vec<String> = results
            .songs
            .iter()
            .map(|song| song.song_id.clone())
            .collect();
        let mut rows = song_rows_for_list(&db, &song_meta_service, &song_ids).await?;
        for song in &mut results.songs {
            song.row = rows.remove(&song.song_id).map(Into::into);
        }
    }
    if let Some(key) = sorted_by {
        attach_sort_values(&db, &mut results, key).await?;
    }
    Ok(Json(results))
}

#[derive(Deserialize)]
struct ArrangeBody {
    /// The list's songs, in its own order. At most `db::queries::MAX_ARRANGED_SONG_IDS`.
    song_ids: Vec<String>,
    #[serde(default)]
    sort: Option<QuerySort>,
    #[serde(default)]
    group: Option<QueryGroup>,
    #[serde(default)]
    time_zone: Option<String>,
}

/// Returns the given songs sorted, grouped, or both, for a list whose songs only the phone
/// knows, like a playlist or the songs on a tag. Takes the same `sort`, `group` and
/// `time_zone` as `POST /queries/results` and returns the same shape. Every song comes back
/// once, `certain`, and nothing is capped. Without a `sort` the songs keep the order given.
///
/// First stores the metadata of every song that has none, waiting for Apple, so the sort
/// has a row for each.
///
/// Request JSON:
/// ```json
/// {
///   "song_ids": ["1440857781", "i.abc123"],
///   "sort": { "field": "tag", "tag_id": 4, "direction": "descending" }
/// }
/// ```
///
/// JSON return value format:
/// ```json
/// {
///   "songs": [
///     { "song_id": "i.abc123", "certain": true },
///     { "song_id": "1440857781", "certain": true }
///   ],
///   "capped": false,
///   "groups": null,
///   "missing_metadata": ["i.abc123"]
/// }
/// ```
async fn arrange_handler(
    State(db): State<DatabaseConnection>,
    State(song_meta_service): State<SongMetadataService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<ArrangeBody>,
) -> Result<Json<QueryResults>, CadenzaError> {
    if body.song_ids.len() > db::queries::MAX_ARRANGED_SONG_IDS {
        return Err(CadenzaError::QueryFormatError(format!(
            "lists are limited to {} songs",
            db::queries::MAX_ARRANGED_SONG_IDS
        )));
    }
    let arrangement = Arrangement {
        sort: body.sort,
        group: body.group,
        time_zone: body.time_zone,
    };
    if !arrangement.is_none() {
        store_metadata_before_sorting(&db, &song_meta_service, &body.song_ids).await;
    }

    let mut results: QueryResults =
        db::queries::arrange_song_ids(&db, claims.user_id, &body.song_ids, &arrangement)
            .await?
            .into();
    if let Some(key) = sorted_metadata_key(&arrangement) {
        attach_sort_values(&db, &mut results, key).await?;
    }
    Ok(Json(results))
}

/// The metadata tag a list is sorted by, if it is sorted by one.
fn sorted_metadata_key(arrangement: &Arrangement) -> Option<MetadataKey> {
    match arrangement.sort.as_ref()?.field {
        ArrangeField::Metadata { key } => Some(key),
        ArrangeField::Tag { .. } => None,
    }
}

/// Fills in each song's `sort_value`: its value of metadata tag `key`, as
/// `GET /songs/metadata-tags` shows it.
async fn attach_sort_values(
    db: &DatabaseConnection,
    results: &mut QueryResults,
    key: MetadataKey,
) -> Result<(), CadenzaError> {
    let song_ids: Vec<String> = results
        .songs
        .iter()
        .map(|song| song.song_id.clone())
        .collect();
    let mut values: HashMap<String, String> = db::metadata_tags::get_songs_metadata(db, &song_ids)
        .await?
        .iter()
        .filter_map(|row| {
            metadata_tags_of(row)
                .into_iter()
                .find(|tag| tag.key == key)
                .map(|tag| (row.song_id.clone(), tag.value))
        })
        .collect();
    for song in &mut results.songs {
        song.sort_value = values.remove(&song.song_id);
    }
    Ok(())
}

pub fn get_queries_router() -> Router<AppState> {
    Router::new()
        .route("/results", post(query_results_handler))
        .route("/arrange", post(arrange_handler))
}
