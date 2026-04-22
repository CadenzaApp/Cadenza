use crate::{AppState, auth::SupabaseClaims, db, err::CadenzaError};
use axum::{
    Json, Router,
    extract::State,
    routing::{delete, post},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct NewTagPayload {
    name: String,
    color: String,
}

async fn new_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<NewTagPayload>,
) -> Result<String, CadenzaError> {
    let new_tag_id = db::tags::new_tag(db, claims.user_id, payload.name, payload.color).await?;

    Ok(new_tag_id.to_string())
}

#[derive(Deserialize)]
pub struct DeleteTagPayload {
    tag_id: i64,
}

async fn delete_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<DeleteTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::delete_tag(db, claims.user_id, payload.tag_id).await
}

#[derive(Deserialize)]
pub struct ApplyTagPayload {
    song_id: String,
    tag_id: i64,
}

async fn apply_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<ApplyTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::apply_tag(db, claims.user_id, payload.song_id, payload.tag_id).await
}

#[derive(Deserialize)]
pub struct RemoveTagPayload {
    song_id: String,
    tag_id: i64,
}
async fn remove_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<RemoveTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::remove_tag(db, claims.user_id, payload.song_id, payload.tag_id).await
}

pub fn get_tags_router() -> Router<AppState> {
    Router::new()
        .route("/", post(new_tag_handler))
        .route("/", delete(delete_tag_handler))
        .route("/applied", post(apply_tag_handler))
        .route("/applied", delete(remove_tag_handler))
}
