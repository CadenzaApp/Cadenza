use crate::{AppState, auth::SupabaseClaims, db};
use axum::{Router, extract::{Json, State}, routing::{delete, post}};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;


pub async fn add_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    payload: Json<SongIdPayload>
) {
    let _ = db::songs::add_song_to_library(db, claims.user_id, payload.song_id).await;
}
