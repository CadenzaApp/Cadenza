use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        self,
        tags::{get_all_local_tags, get_local_tag_usage_counts, get_songs_with_tag, get_tag},
    },
    err::CadenzaError,
    routes::json::tag::Tag,
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
pub struct TagPlusMetadata {
    tag: Tag,
    count: usize,
}

#[derive(Serialize)]
pub enum GetTagsResponse {
    One(TagPlusSongs),
    All(Vec<TagPlusMetadata>),
}
#[derive(Deserialize)]
struct GetTagsParams {
    tag_id: Option<i64>,
}

async fn get_tags_handler(
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
                song_ids: get_songs_with_tag(&db, claims.user_id, tag_id).await?,
            })))
        }
        None => {
            let tags = get_all_local_tags(&db, claims.user_id).await?;
            let mut usage_counts = get_local_tag_usage_counts(&db, claims.user_id).await?;

            let tags_with_metadata: Vec<TagPlusMetadata> = tags
                .into_iter()
                .map(|tag| {
                    let count = usage_counts.remove(&tag.tag_id).unwrap_or(0);
                    TagPlusMetadata {
                        tag: tag.into(),
                        count,
                    }
                })
                .collect();
            Ok(Json(GetTagsResponse::All(tags_with_metadata)))
        }
    }
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
struct GetSongsWithTagParams {
    tag_id: i64,
}

async fn get_songs_with_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(payload): Query<GetSongsWithTagParams>,
) -> Result<Json<Vec<String>>, CadenzaError> {
    Ok(Json(
        get_songs_with_tag(&db, claims.user_id, payload.tag_id).await?,
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
        .route("/", get(get_tags_handler))
        .route("/", post(new_local_tag_handler))
        .route("/", delete(delete_local_tag_handler))
        .route("/suggest", get(suggest_tags_handler))
}
