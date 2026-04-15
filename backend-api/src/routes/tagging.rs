use crate::{AppState, auth::SupabaseClaims, db};
use axum::{Json, Router, extract::State, routing::{delete, post}};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct ApplyTagPayload {
    song_id: usize,
    name: String,
}

pub async fn apply_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims {claims, ..}: Claims<SupabaseClaims>,
    Json(payload): Json<ApplyTagPayload>,
) {
    let _ = db::tagging::apply_tag(db, claims.user_id, payload.song_id, &payload.name).await;
}


// NOTE: `RemoveTagPayload` identifies tags by id but
// `ApplyTagPayload` uses tag names.
// This is to allow `apply_tag_handler` to be called with
// tags that don't exist, in which case the tag will be 
// created first.

#[derive(Deserialize)]
pub struct RemoveTagPayload {
    song_id: usize,
    tag_id: usize,
}
pub async fn remove_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims {claims, ..}: Claims<SupabaseClaims>,
    Json(payload): Json<RemoveTagPayload>,
) {
    let _ = db::tagging::remove_tag(db, claims.user_id, payload.song_id, payload.tag_id).await;
}

pub fn get_tagging_router() -> Router<AppState> {
    Router::new()
        .route("/", post(apply_tag_handler))
        .route("/", delete(remove_tag_handler))
}
