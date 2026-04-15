use crate::{AppState, auth::SupabaseClaims, db};
use axum::{Router, extract::{Query, State}, routing::{delete, post}};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;


#[derive(Deserialize)]
pub struct SongIdQueryParam {
    song_id: usize
}

pub async fn add_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    params: Query<SongIdQueryParam>
) {
    let _ = db::songs::add_song_to_library(db, claims.user_id, params.song_id).await;
}

pub async fn remove_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    params: Query<SongIdQueryParam>
) {
    let _ = db::songs::remove_song_from_library(db, claims.user_id, params.song_id).await;
}

pub fn get_songs_router() -> Router<AppState> {
    Router::new()
        .route("/", post(add_song_handler))
        .route("/", delete(remove_song_handler))
}
