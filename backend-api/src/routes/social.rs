use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, patch, post},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use sea_orm::prelude::Uuid;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::social::{FeedExclude, InterestDelta},
    err::CadenzaError,
    routes::json::social::{CreatePostResponse, FeedResponse, SocialPost, UserPostsResponse},
    services::social_feed::SocialFeedService,
};

const POST_CONTENT_MAX: usize = 500;
const TOPIC_MK_ID_MAX: usize = 128;
const TOPIC_NAME_MAX: usize = 200;

/// Ranked posts for the signed-in user.
///
/// `exclude` is `none`, `loaded`, or `viewed` (default `none`). At most 10
/// posts. Each returned id is marked `loaded`.
///
/// ```json
/// { "feed": [ { "post_id": 1, "content": "hi", "likes": 0, "liked": false, "created_at": "2026-10-16T18:00:00Z", "author": { "user_id": "...", "username": "ada" }, "topic_mk_id": null } ] }
/// ```
async fn get_feed(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(query): Query<FeedQuery>,
) -> Result<Json<FeedResponse>, CadenzaError> {
    let posts = social
        .get_feed(&db, claims.user_id, query.exclude()?)
        .await?;
    Ok(Json(FeedResponse {
        feed: posts.into_iter().map(SocialPost::from).collect(),
    }))
}

#[derive(Deserialize)]
struct FeedQuery {
    exclude: Option<String>,
}

impl FeedQuery {
    fn exclude(&self) -> Result<FeedExclude, CadenzaError> {
        match self.exclude.as_deref().unwrap_or("none") {
            "none" => Ok(FeedExclude::None),
            "loaded" => Ok(FeedExclude::Loaded),
            "viewed" => Ok(FeedExclude::Viewed),
            other => Err(CadenzaError::InvalidRequestBody(format!(
                "exclude must be none, loaded, or viewed, not {other}"
            ))),
        }
    }
}

#[derive(Deserialize)]
struct UpdateInterestsBody {
    delta_scores: Vec<InterestScoreDelta>,
}

#[derive(Deserialize)]
struct InterestScoreDelta {
    name: String,
    itype: String,
    delta: f64,
}

/// Adds each delta to the signed-in user's score for that artist or genre.
/// An interest with no row yet starts at the delta. Embeds a name the first
/// time anything asks for it. Responds with `null`.
async fn update_interests(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<UpdateInterestsBody>,
) -> Result<Json<Value>, CadenzaError> {
    let mut deltas = Vec::with_capacity(body.delta_scores.len());
    for score in body.delta_scores {
        if score.itype != "genre" && score.itype != "artist" {
            return Err(CadenzaError::InvalidRequestBody(
                "itype must be genre or artist".into(),
            ));
        }
        deltas.push(InterestDelta {
            name: score.name,
            interest_type: score.itype,
            delta: score.delta,
        });
    }
    social
        .update_interests(&db, claims.user_id, &deltas)
        .await?;
    Ok(Json(Value::Null))
}

/// Shrinks the signed-in user's interest scores. No-op when they decayed in
/// the last 6 hours or their top score is under 5. Responds with `null`.
async fn decay_interests(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<Value>, CadenzaError> {
    social.decay_interests(&db, claims.user_id).await?;
    Ok(Json(Value::Null))
}

#[derive(Deserialize)]
struct CreatePostBody {
    content: String,
    #[serde(default)]
    topic_mk_id: Option<String>,
    #[serde(default)]
    topic_song_title: Option<String>,
    #[serde(default)]
    topic_artist_name: Option<String>,
}

/// Creates a post for the signed-in user. `content` is at most 500 characters.
/// `topic_mk_id` is an optional Apple Music catalog id of a song or artist.
/// `topic_song_title` and `topic_artist_name` are display names from MusicKit,
/// used only to prefix the embedding; stored content is unchanged.
///
/// ```json
/// { "post_id": 1 }
/// ```
async fn create_post(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<CreatePostBody>,
) -> Result<Json<CreatePostResponse>, CadenzaError> {
    if body.content.chars().count() > POST_CONTENT_MAX {
        return Err(CadenzaError::InvalidRequestBody(
            "content is longer than 500 characters".into(),
        ));
    }
    let topic_mk_id = parse_optional_text(body.topic_mk_id, "topic_mk_id", TOPIC_MK_ID_MAX)?;
    let topic_song_title =
        parse_optional_text(body.topic_song_title, "topic_song_title", TOPIC_NAME_MAX)?;
    let topic_artist_name =
        parse_optional_text(body.topic_artist_name, "topic_artist_name", TOPIC_NAME_MAX)?;
    let post_id = social
        .create_post(
            &db,
            claims.user_id,
            &body.content,
            topic_mk_id.as_deref(),
            topic_song_title.as_deref(),
            topic_artist_name.as_deref(),
        )
        .await?;
    Ok(Json(CreatePostResponse { post_id }))
}

fn parse_optional_text(
    raw: Option<String>,
    field: &str,
    max_chars: usize,
) -> Result<Option<String>, CadenzaError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > max_chars {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "{field} is longer than {max_chars} characters"
        )));
    }
    Ok(Some(trimmed.to_owned()))
}

#[derive(Deserialize)]
struct MarkViewedBody {
    post_ids: Vec<i64>,
}

/// Marks posts `viewed` for the signed-in user. Responds with `null`.
async fn mark_viewed(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<MarkViewedBody>,
) -> Result<Json<Value>, CadenzaError> {
    social
        .mark_posts_viewed(&db, claims.user_id, &body.post_ids)
        .await?;
    Ok(Json(Value::Null))
}

/// One user's public profile and their posts, newest first. `user` in the
/// path is the author. The signed-in user is the viewer, for `liked`.
///
/// ```json
/// { "profile": { "user_id": "...", "username": "ada", "bio": "" }, "posts": [] }
/// ```
async fn user_posts(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(author_id): Path<Uuid>,
) -> Result<Json<UserPostsResponse>, CadenzaError> {
    let (profile, posts) = social.user_posts(&db, claims.user_id, author_id).await?;
    Ok(Json(UserPostsResponse {
        profile: profile.into(),
        posts: posts.into_iter().map(SocialPost::from).collect(),
    }))
}

#[derive(Deserialize)]
struct LikeBody {
    timestamp: i64,
}

/// Likes a post. `timestamp` is the client's click time in milliseconds. A
/// click older than the last one this process accepted for the pair is ignored.
/// Responds with `null`.
async fn like_post(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(post_id): Path<i64>,
    Json(body): Json<LikeBody>,
) -> Result<Json<Value>, CadenzaError> {
    social
        .like_post(&db, claims.user_id, post_id, body.timestamp)
        .await?;
    Ok(Json(Value::Null))
}

/// Removes the signed-in user's like. Same `timestamp` rule as like. Responds
/// with `null`.
async fn unlike_post(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(post_id): Path<i64>,
    Json(body): Json<LikeBody>,
) -> Result<Json<Value>, CadenzaError> {
    social
        .unlike_post(&db, claims.user_id, post_id, body.timestamp)
        .await?;
    Ok(Json(Value::Null))
}

pub fn get_social_router() -> Router<AppState> {
    Router::new()
        .route("/feed", get(get_feed))
        .route("/interests/update", patch(update_interests))
        .route("/interests/decay", patch(decay_interests))
        .route("/posts", post(create_post))
        .route("/posts/views", post(mark_viewed))
        .route("/posts/user/{author_id}", get(user_posts))
        .route(
            "/posts/{post_id}/likes",
            post(like_post).delete(unlike_post),
        )
}
