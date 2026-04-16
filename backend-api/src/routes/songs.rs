use crate::{AppState, auth::SupabaseClaims, db, err::CadenzaError};
use axum::{
    Router,
    extract::{Json, State},
    routing::{delete, post},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct SongIdPayload {
    song_id: usize,
}

async fn add_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    payload: Json<SongIdPayload>,
) -> Result<(), CadenzaError> {
    db::songs::add_song_to_library(db, claims.user_id, payload.song_id).await
}

async fn remove_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    payload: Json<SongIdPayload>,
) -> Result<(), CadenzaError> {
    db::songs::remove_song_from_library(db, claims.user_id, payload.song_id).await
}

pub fn get_songs_router() -> Router<AppState> {
    Router::new()
        .route("/", post(add_song_handler))
        .route("/", delete(remove_song_handler))
}
