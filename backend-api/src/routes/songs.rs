use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        self,
        tags::{get_tags_on_song, get_tags_on_songs, is_global_tag},
    },
    err::CadenzaError,
    routes::json::tag::Tag,
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{delete, get, post},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Deserialize)]
pub struct GetTagsOnSongQueryParams {
    song_id: String,
}

#[derive(Serialize)]
pub struct GetTagsOnSongResponse {
    global: Vec<Tag>,
    local: Vec<Tag>,
}
async fn get_tags_on_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<GetTagsOnSongQueryParams>,
) -> Result<Json<GetTagsOnSongResponse>, CadenzaError> {
    let mut all_tags = get_tags_on_song(&db, claims.user_id, &params.song_id).await?;

    // sort tags into global/local
    let mut global: Vec<Tag> = vec![];
    let mut local: Vec<Tag> = vec![];
    while let Some(tag) = all_tags.pop() {
        if is_global_tag(&tag) {
            global.push(tag.into());
        } else {
            local.push(tag.into());
        }
    }

    Ok(Json(GetTagsOnSongResponse { global, local }))
}

#[derive(Deserialize)]
struct GetTagsOnSongsPayload {
    song_ids: Vec<String>,
}

#[derive(Default, Serialize)]
struct TagsOnSong {
    global: Vec<Tag>,
    local: Vec<Tag>,
}

async fn get_tags_on_songs_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<GetTagsOnSongsPayload>,
) -> Result<Json<HashMap<String, TagsOnSong>>, CadenzaError> {
    let song_ids: Vec<String> = payload
        .song_ids
        .into_iter()
        .filter(|id| !id.is_empty())
        .collect();
    let tags_by_song = get_tags_on_songs(&db, claims.user_id, &song_ids).await?;
    let mut response = HashMap::new();

    for song_id in song_ids {
        let mut grouped = TagsOnSong::default();
        for tag in tags_by_song.get(&song_id).into_iter().flatten().cloned() {
            if is_global_tag(&tag) {
                grouped.global.push(tag.into());
            } else {
                grouped.local.push(tag.into());
            }
        }
        response.insert(song_id, grouped);
    }

    Ok(Json(response))
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
    db::tags::apply_local_tag(db, claims.user_id, payload.song_id, payload.tag_id).await
}

#[derive(Deserialize)]
pub struct UnapplyTagPayload {
    song_id: String,
    tag_id: i64,
}
async fn unapply_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<UnapplyTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::unapply_local_tag(db, claims.user_id, payload.song_id, payload.tag_id).await
}

pub fn get_songs_router() -> Router<AppState> {
    Router::new()
        .route("/tags", get(get_tags_on_song_handler))
        .route("/tags", post(apply_tag_handler))
        .route("/tags", delete(unapply_tag_handler))
        .route("/tags/batch", post(get_tags_on_songs_handler))
}
