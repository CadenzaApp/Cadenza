use std::collections::{BTreeMap, HashMap};

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        self,
        tags::{
            TagMetadata, get_all_user_tags, get_songs_with_user_tag, get_tag,
            get_user_tags_metadata,
        },
    },
    err::CadenzaError,
    routes::json::{
        tag::{Tag, TagType},
        tag_score::ScoredTag,
        vec_into,
    },
    services::tag_generation::{TagGenerationService, TagSpecs},
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{delete, get, patch, post},
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
    metadata: HashMap<i64, TagMetadata>,
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
        None => Ok(Json(GetTagsResponse::All(TagsWithMetadata {
            tags: vec_into(get_all_user_tags(&db, claims.user_id).await?),
            metadata: get_user_tags_metadata(&db, claims.user_id).await?,
        }))),
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

/// How many default tags one search returns at most.
const DEFAULT_TAG_SEARCH_LIMIT: u64 = 5;

#[derive(Deserialize)]
struct DefaultTagSearchParams {
    /// A blank search, or none at all, matches every default tag.
    #[serde(default)]
    search: String,
}

/// Returns up to 5 default tags whose names contain `search`, ignoring case. A
/// blank search still returns 5 tags.
///
/// These are the shared default tags (`user_id IS NULL`), not the caller's own,
/// so two users searching the same text get the same tags back.
///
/// JSON return value format:
/// ```json
/// [ { "id": 3, "name": "chill", "color": "#7c3aed", "type": "basic" }, ... ]
/// ```
async fn search_default_tags_handler(
    State(db): State<DatabaseConnection>,
    _: Claims<SupabaseClaims>, // must have credentials to use this route
    Query(params): Query<DefaultTagSearchParams>,
) -> Result<Json<Vec<Tag>>, CadenzaError> {
    Ok(Json(vec_into(
        db::tags::search_default_tags(&db, &params.search, DEFAULT_TAG_SEARCH_LIMIT).await?,
    )))
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
) -> Result<Json<Vec<TagSpecs>>, CadenzaError> {
    let mut suggested_tags = tag_gen_service
        .generate_tags(&[payload.song_desc], Some(payload.requested_tag_count))
        .await?;

    match suggested_tags.is_empty() {
        true => Ok(Json(vec![])),
        false => Ok(Json(suggested_tags.remove(0))),
    }
}

/// Adds each of the body's deltas to the signed in user's score for that tag
/// name, so the app can track which tags they keep reaching for. A name the user
/// has no score for starts at its delta, and a negative delta takes a score
/// down, below zero included.
///
/// Scores are per tag name, not per tag id, so they cover default tags and names
/// the user has no tag of at all.
///
/// Request body, a tag name to how far to move its score:
/// ```json
/// { "pop": 5, "rock": 10, "jazz": -2 }
/// ```
///
/// Names are lowercased, whitespace collapsed, and cut to 50 bytes first, so
/// `"Pop"` and `" pop "` are one score, and two names that collapse into one have
/// their deltas added together. At most 200 names per request.
///
/// JSON return value format, the score every named tag is left at:
/// ```json
/// { "jazz": -2, "pop": 5, "rock": 10 }
/// ```
async fn edit_tag_scores_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(deltas): Json<HashMap<String, i64>>,
) -> Result<Json<BTreeMap<String, i64>>, CadenzaError> {
    Ok(Json(
        db::tag_scores::add_to_tag_scores(&db, claims.user_id, deltas).await?,
    ))
}

#[derive(Deserialize)]
struct TopTagScoresParams {
    k: u64,
}

/// Returns the signed in user's `k` highest tag scores, keyed by tag name. A map
/// has no order, so the client sorts it. `k` is at most 200.
///
/// Each value is `[score, color, source]`. `color` is the user's own tag's when
/// they have a tag of that name, and `source` is then `"local"`. Otherwise it is
/// the default tag's, and `source` is `"global"`. Scores of 0 and below are left
/// out, and so are names with no tag at all. A user with fewer than `k` names
/// left gets all of those.
///
/// JSON return value format, for `?k=3`:
/// ```json
/// {
///     "chill": [4, "#7c3aed", "global"],
///     "pop": [5, "#ec4899", "local"],
///     "rock": [10, "#ef4444", "local"]
/// }
/// ```
async fn get_top_tag_scores_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<TopTagScoresParams>,
) -> Result<Json<HashMap<String, ScoredTag>>, CadenzaError> {
    let scores = db::tag_scores::get_top_tag_scores(&db, claims.user_id, params.k).await?;

    Ok(Json(
        scores
            .into_iter()
            .map(|(name, score)| (name, score.into()))
            .collect(),
    ))
}

pub fn get_tags_router() -> Router<AppState> {
    Router::new()
        .route("/", get(get_user_tags_handler))
        .route("/", post(new_user_tag_handler))
        .route("/", delete(delete_user_tag_handler))
        .route(
            "/scores",
            get(get_top_tag_scores_handler).patch(edit_tag_scores_handler),
        )
        .route("/default-tags", get(search_default_tags_handler))
        .route("/suggest", get(suggest_tags_handler))
}
