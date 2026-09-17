use crate::db;
use crate::err::CadenzaError;
use crate::routes::json::query::Query;
use crate::{AppState, auth::SupabaseClaims};
use axum::routing::post;
use axum::{Json, Router, extract::State};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;

const MAX_QUERY_SONG_IDS: usize = 50_000;

#[derive(Deserialize)]
struct QueryResultsBody {
    query: Query,
    #[serde(default)]
    song_ids: Option<Vec<String>>,
    /// Defaults to false, so a caller that predates suggested tags keeps seeing
    /// only its own tags.
    #[serde(default)]
    consider_default_tags: bool,
}

/// Returns JSON array of ids of matching songs from the given query, most
/// relevant first. See `routes::json::query::Query` for the shape of `query`.
///
/// `song_ids` is the caller's current Apple Music library. Sending it evaluates
/// the query over exactly those songs, which is what lets a negative filter
/// match a song with no tags on it at all. Leaving it out evaluates the query
/// over the songs that already carry a tag.
///
/// `consider_default_tags` widens what counts as a tag on a song to include the
/// shared default tags, for matching and for ranking, and lets the query name a
/// default tag id.
///
/// Request JSON:
/// ```json
/// {
///   "query": { "where": { "filter": { "field": "tag", "tag_id": 3, "op": "is_not_applied" } } },
///   "song_ids": ["123", "456"],
///   "consider_default_tags": false
/// }
/// ```
///
/// JSON return value format:
/// ```json
/// [ "songid1", "songid2", ... ]
/// ```
async fn query_results_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<QueryResultsBody>,
) -> Result<Json<Vec<String>>, CadenzaError> {
    if let Some(song_ids) = &body.song_ids {
        if song_ids.len() > MAX_QUERY_SONG_IDS {
            return Err(CadenzaError::QueryFormatError(format!(
                "a query can evaluate at most {MAX_QUERY_SONG_IDS} songs",
            )));
        }
        if song_ids.iter().any(|song_id| song_id.is_empty()) {
            return Err(CadenzaError::QueryFormatError(
                "song ids cannot be empty".to_string(),
            ));
        }
    }

    Ok(Json(
        db::queries::run_query(
            &db,
            &body.query,
            claims.user_id,
            body.song_ids.as_deref(),
            body.consider_default_tags,
        )
        .await?,
    ))
}

pub fn get_queries_router() -> Router<AppState> {
    Router::new().route("/results", post(query_results_handler))
}
