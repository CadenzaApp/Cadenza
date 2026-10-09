use crate::db;
use crate::err::CadenzaError;
use crate::routes::json::query::{Query, QueryResults, QuerySort};
use crate::{AppState, auth::SupabaseClaims};
use axum::routing::post;
use axum::{Json, Router, extract::State};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;

#[derive(Deserialize)]
struct QueryResultsBody {
    query: Query,
    /// Defaults to false, so a caller that predates suggested tags keeps seeing
    /// only its own tags.
    #[serde(default)]
    consider_default_tags: bool,
    /// Omitted for most relevant first.
    #[serde(default)]
    sort: Option<QuerySort>,
}

/// Returns every song matching the given query, in order. See
/// `routes::json::query::Query` for the shape of `query`, and `QuerySort` for `sort`.
///
/// The query runs over every song Cadenza knows: the caller's library (their rows in
/// `user_songs`, which `PATCH /songs` keeps in step with Apple Music), every song carrying
/// one of their tags, and every song stored in `metadata_song_tags_applied`. That is what
/// lets a negative filter match a song with no tags on it at all, including songs the
/// caller does not have.
///
/// `certain` marks a song in the caller's library or carrying one of their tags. Every one
/// of those comes back. Only the first `db::queries::MAX_DISCOVERED_SONGS` of the rest do,
/// and `capped` says when more matched.
///
/// `consider_default_tags` widens what counts as a tag on a song to include the
/// shared default tags, for matching and for ranking, and lets the query name a
/// default tag id.
///
/// Request JSON:
/// ```json
/// {
///   "query": { "where": { "filter": { "field": "tag", "tag_id": 3, "op": "is_not_applied" } } },
///   "consider_default_tags": false,
///   "sort": { "key": "title", "direction": "ascending" }
/// }
/// ```
///
/// JSON return value format:
/// ```json
/// {
///   "songs": [
///     { "song_id": "songid1", "certain": true },
///     { "song_id": "songid2", "certain": false }
///   ],
///   "capped": false
/// }
/// ```
async fn query_results_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<QueryResultsBody>,
) -> Result<Json<QueryResults>, CadenzaError> {
    Ok(Json(
        db::queries::run_query(
            &db,
            &body.query,
            claims.user_id,
            body.consider_default_tags,
            body.sort,
        )
        .await?
        .into(),
    ))
}

pub fn get_queries_router() -> Router<AppState> {
    Router::new().route("/results", post(query_results_handler))
}
