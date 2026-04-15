use crate::db;
use axum::{Json, extract::State};
use sea_orm::DatabaseConnection;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct ApplyTag {
    song_id: usize,
    name: String,
}

pub async fn apply_tag_handler(
    State(db): State<DatabaseConnection>,
    Json(payload): Json<ApplyTag>,
) {
    let _ = db::tagging::apply_tag(db, payload.song_id, &payload.name).await;
}
