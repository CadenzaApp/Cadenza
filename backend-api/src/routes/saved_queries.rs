use crate::{
    AppState,
    auth::SupabaseClaims,
    db::saved_queries::{
        NewSavedQuery, SavedQueryPatch, count_songs, create_saved_query, delete_saved_query,
        get_saved_query, list_saved_queries, update_saved_query,
    },
    err::CadenzaError,
    routes::json::{
        query::Query,
        saved_query::{NewSavedQueryBody, PatchSavedQueryBody, SavedQuery, SavedQuerySongs},
        vec_into,
    },
    services::saved_queries::{saved_songs, store_saved_songs},
};
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde_json::Value;

/// The longest name a saved query can have, in characters.
const MAX_NAME_CHARS: usize = 100;

/// Returns every query the signed-in user saved, favorites first, then newest first.
///
/// JSON return value format:
/// ```json
/// [
///   {
///     "saved_query_id": 3,
///     "name": "Late night favorites",
///     "query": { "where": { "and": [ { "filter": { "field": "tag", "tag_id": 4, "op": "is_applied" } } ] } },
///     "consider_default_tags": false,
///     "library_or_tagged": true,
///     "favorite": true,
///     "artwork_urls": ["https://..."],
///     "song_count": 42,
///     "created_at": "2026-11-08T18:00:00Z",
///     "songs_stored_at": "2026-11-08T18:00:00Z"
///   }
/// ]
/// ```
async fn list_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<Vec<SavedQuery>>, CadenzaError> {
    let saved = list_saved_queries(&db, claims.user_id).await?;
    let ids: Vec<i64> = saved.iter().map(|model| model.saved_query_id).collect();
    let counts = count_songs(&db, &ids).await?;
    Ok(Json(
        saved
            .into_iter()
            .map(|model| {
                let count = counts.get(&model.saved_query_id).copied().unwrap_or(0);
                SavedQuery::new(model, count)
            })
            .collect(),
    ))
}

/// Saves a query by name, stores the songs it matches now, and returns it in the shape
/// `GET /saved-queries` lists. `query` is the shape `POST /queries/results` takes, run the
/// same way with the caller's Hide explicit content setting. `artwork_urls` is the cover the
/// results screen showed, up to 4. `InvalidRequestBody` for an empty or too long name,
/// `QueryFormatError` for a bad query, `QueryNameAlreadyTaken` when the user already has a
/// query by that name.
async fn create_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<NewSavedQueryBody>,
) -> Result<Json<SavedQuery>, CadenzaError> {
    let name = check_name(&body.name)?;
    // stored as sent, but only once it parses as a query
    serde_json::from_value::<Query>(body.query.clone())
        .map_err(|err| CadenzaError::QueryFormatError(err.to_string()))?;

    let saved = create_saved_query(
        &db,
        claims.user_id,
        NewSavedQuery {
            name,
            query: body.query,
            consider_default_tags: body.consider_default_tags,
            library_or_tagged: body.library_or_tagged,
            favorite: body.favorite,
            artwork_urls: body.artwork_urls,
        },
    )
    .await?;
    with_songs_stored(&db, claims.user_id, saved).await
}

/// Changes a saved query's name, favorite, or cover, and returns it. A missing key is left
/// alone. Same name rules as saving. `NotFound` when the user has none by that id.
async fn patch_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(saved_query_id): Path<i64>,
    Json(body): Json<PatchSavedQueryBody>,
) -> Result<Json<SavedQuery>, CadenzaError> {
    let patch = SavedQueryPatch {
        name: body.name.as_deref().map(check_name).transpose()?,
        favorite: body.favorite,
        artwork_urls: body.artwork_urls,
    };
    let saved = update_saved_query(&db, claims.user_id, saved_query_id, patch).await?;
    let count = count_songs(&db, &[saved_query_id])
        .await?
        .get(&saved_query_id)
        .copied()
        .unwrap_or(0);
    Ok(Json(SavedQuery::new(saved, count)))
}

/// Deletes one of the signed-in user's saved queries. Responds with `null`.
/// `NotFound` when they have none by that id.
async fn delete_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(saved_query_id): Path<i64>,
) -> Result<Json<Value>, CadenzaError> {
    delete_saved_query(&db, claims.user_id, saved_query_id).await?;
    Ok(Json(Value::Null))
}

/// Returns the songs a saved query holds, in order: what it matched when it was saved or
/// last rerun, plus any added since by tagging when the caller has `auto_update_queries`
/// on. `certain` is the same as on `/queries/results`. A query saved before songs were
/// stored has them stored on this first read. `NotFound` when the user has none by that id.
///
/// ```json
/// { "songs": [ { "song_id": "1440857781", "certain": true } ] }
/// ```
async fn songs_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(saved_query_id): Path<i64>,
) -> Result<Json<SavedQuerySongs>, CadenzaError> {
    let songs = saved_songs(&db, claims.user_id, saved_query_id).await?;
    Ok(Json(SavedQuerySongs {
        songs: vec_into(songs),
    }))
}

/// Runs a saved query again the way it was saved, replaces its songs with what it matches
/// now, and returns it in the shape `GET /saved-queries` lists. `NotFound` when the user
/// has none by that id.
async fn rerun_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(saved_query_id): Path<i64>,
) -> Result<Json<SavedQuery>, CadenzaError> {
    let saved = get_saved_query(&db, claims.user_id, saved_query_id).await?;
    with_songs_stored(&db, claims.user_id, saved).await
}

/// Stores a saved query's songs and returns it with them counted.
async fn with_songs_stored(
    db: &DatabaseConnection,
    user_id: sea_orm::prelude::Uuid,
    saved: crate::db::entity::saved_queries::Model,
) -> Result<Json<SavedQuery>, CadenzaError> {
    let songs = store_saved_songs(db, user_id, &saved).await?;
    // read back for songs_stored_at
    let saved = get_saved_query(db, user_id, saved.saved_query_id).await?;
    Ok(Json(SavedQuery::new(saved, songs.len() as i64)))
}

/// The name trimmed. `InvalidRequestBody` when that is empty or too long.
fn check_name(name: &str) -> Result<String, CadenzaError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CadenzaError::InvalidRequestBody(
            "name must not be empty".to_owned(),
        ));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "name must be at most {MAX_NAME_CHARS} characters"
        )));
    }
    Ok(name.to_owned())
}

pub fn get_saved_queries_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_handler).post(create_handler))
        .route(
            "/{saved_query_id}",
            axum::routing::patch(patch_handler).delete(delete_handler),
        )
        .route("/{saved_query_id}/songs", get(songs_handler))
        .route("/{saved_query_id}/rerun", post(rerun_handler))
}
