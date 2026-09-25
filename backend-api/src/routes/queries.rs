use crate::db;
use crate::err::CadenzaError;
use crate::routes::json::query::Query;
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
}

/// Returns JSON array of ids of matching songs from the given query, most
/// relevant first. See `routes::json::query::Query` for the shape of `query`.
///
/// The query runs over the caller's library, meaning their rows in `user_songs`,
/// which `PATCH /songs` keeps in step with Apple Music. That is what lets a
/// negative filter match a song with no tags on it at all.
///
/// `consider_default_tags` widens what counts as a tag on a song to include the
/// shared default tags, for matching and for ranking, and lets the query name a
/// default tag id.
///
/// Request JSON:
/// ```json
/// {
///   "query": { "where": { "filter": { "field": "tag", "tag_id": 3, "op": "is_not_applied" } } },
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
    Ok(Json(
        db::queries::run_query(&db, &body.query, claims.user_id, body.consider_default_tags)
            .await?,
    ))
}

pub fn get_queries_router() -> Router<AppState> {
    Router::new().route("/results", post(query_results_handler))
}
