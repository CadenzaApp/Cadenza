use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        self,
        tags::{get_all_local_tags, get_local_tag_usage_counts, get_tags_on_song, is_global_tag},
    },
    err::CadenzaError,
    routes::json::{tag::Tag, vec_into},
    services::tag_generation::TagGenerationService,
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{delete, get, post},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct GetTagsOnSongQueryParams {
    song_id: String,
}

#[derive(Serialize)]
pub struct GetTagsResponse {
    global: Vec<Tag>,
    local: Vec<Tag>,
}
async fn get_tags_on_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<GetTagsOnSongQueryParams>,
) -> Result<Json<GetTagsResponse>, CadenzaError> {
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

    Ok(Json(GetTagsResponse { global, local }))
}

#[derive(Serialize)]
pub struct TagPlusMetadata {
    tag: Tag,
    count: usize,
}

async fn get_local_tags_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<Vec<TagPlusMetadata>>, CadenzaError> {
    let tags = get_all_local_tags(&db, claims.user_id).await?;
    let mut usage_counts = get_local_tag_usage_counts(&db, claims.user_id).await?;

    let tags_with_metadata = tags
        .into_iter()
        .map(|tag| {
            let count = usage_counts.remove(&tag.tag_id).unwrap_or(0);
            TagPlusMetadata { tag: tag.into(), count }
        })
        .collect();

    Ok(Json(tags_with_metadata))
}

#[derive(Deserialize)]
pub struct NewTagPayload {
    name: String,
    color: String,
}

async fn new_local_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<NewTagPayload>,
) -> Result<String, CadenzaError> {
    let new_tag_id =
        db::tags::new_local_tag(db, claims.user_id, payload.name, payload.color).await?;

    Ok(new_tag_id.to_string())
}

#[derive(Deserialize)]
pub struct DeleteTagPayload {
    tag_id: i64,
}

async fn delete_local_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<DeleteTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::delete_local_tag(db, claims.user_id, payload.tag_id).await
}

#[derive(Deserialize)]
pub struct ApplyTagPayload {
    song_id: String,
    tag_id: i64,
}

async fn apply_local_tag_handler(
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
async fn unapply_local_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<UnapplyTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::unapply_local_tag(db, claims.user_id, payload.song_id, payload.tag_id).await
}

#[derive(Deserialize)]
struct TagSuggestionQueryParams {
    song_desc: String,
    requested_tag_count: usize,
}

async fn suggest_tags_handler(
    _: Claims<SupabaseClaims>, // must have credentials to use this route
    State(tag_gen_service): State<TagGenerationService>,
    Query(payload): Query<TagSuggestionQueryParams>,
) -> Result<Json<Vec<String>>, CadenzaError> {
    let mut suggested_tags = tag_gen_service
        .generate_tags(&[payload.song_desc], Some(payload.requested_tag_count))
        .await?;

    match suggested_tags.is_empty() {
        true => Ok(Json(vec![])),
        false => Ok(Json(suggested_tags.remove(0))),
    }
}

pub fn get_tags_router() -> Router<AppState> {
    Router::new()
        .route("/", get(get_tags_on_song_handler))
        .route("/local", get(get_local_tags_handler))
        .route("/local", post(new_local_tag_handler))
        .route("/local", delete(delete_local_tag_handler))
        .route("/local/applied", post(apply_local_tag_handler))
        .route("/local/applied", delete(unapply_local_tag_handler))
        .route("/suggest", get(suggest_tags_handler))
}
