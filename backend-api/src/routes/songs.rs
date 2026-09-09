use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        self,
        tags::{get_default_tags_on_songs, get_user_tags_on_song, set_default_tags_on_songs},
    },
    err::CadenzaError,
    routes::json::{tag::Tag, vec_into}, services::tag_generation::{GeneratedTag, TagGenerationService},
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{delete, get, post},
};
use axum_jwt_auth::Claims;
use std::collections::HashMap;
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


#[derive(Deserialize)]
pub struct SongIdAndDesc {
    song_id: String,
    /// description of the song used to generate tags, e.g. "Override by Yoshida Yasei"
    desc: String,
}

/// returns the default tags on each requested song.
///
/// songs without any default tags yet have them generated and stored first.
async fn get_default_tags_on_songs_handler(
    _: Claims<SupabaseClaims>, // only authorized users allowed
    State(db): State<DatabaseConnection>,
    State(tag_gen_service): State<TagGenerationService>,
    Json(songs): Json<Vec<SongIdAndDesc>>,
) -> Result<Json<HashMap<String, Vec<Tag>>>, CadenzaError> {
    let song_ids: Vec<String> = songs.iter().map(|song| song.song_id.clone()).collect();

    let mut default_tags = get_default_tags_on_songs(&db, &song_ids).await?;

    let untagged: Vec<&SongIdAndDesc> = songs
        .iter()
        .filter(|song| !default_tags.contains_key(&song.song_id))
        .collect();

    if !untagged.is_empty() {
        let descs: Vec<String> = untagged.iter().map(|song| song.desc.clone()).collect();
        let generated = tag_gen_service.generate_tags(&descs, None).await?;

        let generated_tags: HashMap<String, Vec<GeneratedTag>> = untagged
            .iter()
            .zip(generated)
            .map(|(song, tags)| (song.song_id.clone(), tags))
            .collect();

        default_tags.extend(set_default_tags_on_songs(&db, generated_tags).await?);
    }

    Ok(Json(
        default_tags
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
        .route("/default-tags", post(get_default_tags_on_songs_handler))
        .route("/tags", get(get_tags_on_song_handler))
        .route("/tags", post(apply_user_tag_handler))
        .route("/tags", delete(unapply_user_tag_handler))
}
