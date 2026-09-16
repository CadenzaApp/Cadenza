use std::collections::HashMap;

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        self,
        tags::{TagMetadata, get_all_user_tags, get_songs_with_user_tag, get_tag, get_user_tags_metadata},
    },
    err::CadenzaError,
    routes::json::{
        tag::{Tag, TagType},
        vec_into,
    },
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

#[derive(Serialize)]
pub struct TagPlusSongs {
    tag: Tag,
    song_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct TagsWithMetadata {
    tags: Vec<Tag>,
    metadata: HashMap<i64, TagMetadata>
}

#[derive(Serialize)]
pub enum GetTagsResponse {
    One(TagPlusSongs),
    All(TagsWithMetadata),
}
#[derive(Deserialize)]
struct GetTagsParams {
    tag_id: Option<i64>,
}

async fn get_user_tags_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<GetTagsParams>,
) -> Result<Json<GetTagsResponse>, CadenzaError> {
    match params.tag_id {
        Some(tag_id) => {
            let Some(tag) = get_tag(&db, tag_id).await? else {
                return Err(CadenzaError::NotFound);
            };
            Ok(Json(GetTagsResponse::One(TagPlusSongs {
                tag: tag.into(),
                song_ids: get_songs_with_user_tag(&db, claims.user_id, tag_id).await?,
            })))
        }
        None => {
            Ok(Json(GetTagsResponse::All(TagsWithMetadata{
                tags: vec_into(get_all_user_tags(&db, claims.user_id).await?),
                metadata: get_user_tags_metadata(&db, claims.user_id).await?
            })))
        }
    }
}

#[derive(Deserialize)]
pub struct NewTagPayload {
    name: String,
    color: String,
    /// Defaults to a basic tag, so clients that predate attribute tags keep
    /// working unchanged.
    #[serde(default, rename = "type")]
    tag_type: TagType,
}

async fn new_user_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<NewTagPayload>,
) -> Result<String, CadenzaError> {
    let new_tag_id = db::tags::new_user_tag(
        db,
        claims.user_id,
        payload.name,
        payload.color,
        payload.tag_type.into(),
    )
    .await?;

    Ok(new_tag_id.to_string())
}

#[derive(Deserialize)]
pub struct DeleteTagPayload {
    tag_id: i64,
}

async fn delete_user_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<DeleteTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::delete_user_tag(db, claims.user_id, payload.tag_id).await
}

#[derive(Deserialize)]
struct GetSongsWithUserTagParams {
    tag_id: i64,
}

async fn get_songs_with_user_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(payload): Query<GetSongsWithUserTagParams>,
) -> Result<Json<Vec<String>>, CadenzaError> {
    Ok(Json(
        get_songs_with_user_tag(&db, claims.user_id, payload.tag_id).await?,
    ))
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
        .route("/", get(get_user_tags_handler))
        .route("/", post(new_user_tag_handler))
        .route("/", delete(delete_user_tag_handler))
        .route("/suggest", get(suggest_tags_handler))
}
