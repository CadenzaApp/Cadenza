use std::collections::HashMap;

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        self,
        tags::{get_user_tags_on_song, get_user_tags_on_songs},
    },
    err::CadenzaError,
    routes::json::{tag::Tag, vec_into},
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{delete, get, post},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;


#[derive(Deserialize)]
pub struct GetTagsOnSongQueryParams {
    song_id: String,
}

async fn get_tags_on_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<GetTagsOnSongQueryParams>,
) -> Result<Json<Vec<Tag>>, CadenzaError> {
    let user_tags = get_user_tags_on_song(&db, claims.user_id, &params.song_id).await?;
    Ok(Json(vec_into(user_tags)))
}


/// A list screen asks for a page of songs at a time, so cap it well above the
/// client's batch size but short of something that would blow up the query.
const MAX_BATCH_SONG_IDS: usize = 200;

#[derive(Deserialize)]
pub struct GetTagsOnSongsPayload {
    song_ids: Vec<String>,
}

async fn get_tags_on_songs_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<GetTagsOnSongsPayload>,
) -> Result<Json<HashMap<String, Vec<Tag>>>, CadenzaError> {
    if payload.song_ids.len() > MAX_BATCH_SONG_IDS {
        return Err(CadenzaError::QueryFormatError(format!(
            "song_ids is limited to {MAX_BATCH_SONG_IDS} songs per request"
        )));
    }

    let tags_by_song = get_user_tags_on_songs(&db, claims.user_id, &payload.song_ids).await?;

    Ok(Json(
        tags_by_song
            .into_iter()
            .map(|(song_id, tags)| (song_id, vec_into(tags)))
            .collect(),
    ))
}


#[derive(Deserialize)]
pub struct ApplyTagPayload {
    song_id: String,
    tag_id: i64,
}

async fn apply_user_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<ApplyTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::apply_user_tag(db, claims.user_id, payload.song_id, payload.tag_id).await
}

#[derive(Deserialize)]
pub struct UnapplyTagPayload {
    song_id: String,
    tag_id: i64,
}
async fn unapply_user_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<UnapplyTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::unapply_user_tag(db, claims.user_id, payload.song_id, payload.tag_id).await
}


pub fn get_songs_router() -> Router<AppState> {
    Router::new()
        .route("/tags", get(get_tags_on_song_handler))
        .route("/tags/batch", post(get_tags_on_songs_handler))
        .route("/tags", post(apply_user_tag_handler))
        .route("/tags", delete(unapply_user_tag_handler))
}
