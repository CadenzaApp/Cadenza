use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        comment_votes::{CommentVote, VoteTally, get_song_vote_tallies, set_comment_vote},
        comments::{delete_user_comment, get_song_comments, new_comment},
    },
    err::CadenzaError,
    routes::json::comment::{Comment, CommentThread},
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
pub struct GetCommentsQueryParams {
    song_id: String,
}

/// Returns every comment on a song, from every user. Top level comments come
/// newest first, each with its replies oldest first. `mine` is true on the
/// comments the signed in user left, `votes` is up votes minus down votes, and
/// `my_vote` is the signed in user's vote.
///
/// JSON return value format:
/// ```json
/// [
///   {
///     "id": 41,
///     "content": "the bridge at 2:10",
///     "created_at": "2026-09-15T18:03:11.482913Z",
///     "mine": false,
///     "votes": 3,
///     "my_vote": "up",
///     "replies": [
///       { "id": 42, "content": "agreed", "created_at": "2026-09-15T18:20:05.107Z", "mine": true, "votes": 0, "my_vote": null }
///     ]
///   },
///   ...
/// ]
/// ```
async fn get_song_comments_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<GetCommentsQueryParams>,
) -> Result<Json<Vec<CommentThread>>, CadenzaError> {
    let threads = get_song_comments(&db, &params.song_id).await?;
    let tallies = get_song_vote_tallies(&db, claims.user_id, &params.song_id).await?;

    Ok(Json(
        threads
            .into_iter()
            .map(|(top_level, replies)| {
                CommentThread::new(top_level, replies, &tallies, claims.user_id)
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct NewCommentPayload {
    song_id: String,
    /// the top level comment this one replies to, left out for a top level comment
    parent_id: Option<i64>,
    content: String,
}

/// Leaves the user's comment on a song, or a reply when `parent_id` is set
/// (see `db::comments::new_comment` for the checks). Returns the new comment.
///
/// JSON return value format:
/// ```json
/// { "id": 43, "content": "the bridge at 2:10", "created_at": "2026-09-15T18:03:11.482913Z", "mine": true, "votes": 0, "my_vote": null }
/// ```
async fn new_comment_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<NewCommentPayload>,
) -> Result<Json<Comment>, CadenzaError> {
    let comment = new_comment(
        &db,
        claims.user_id,
        payload.song_id,
        payload.parent_id,
        &payload.content,
    )
    .await?;

    // a comment that was just left has no votes yet
    Ok(Json(Comment::new(
        comment,
        VoteTally::default(),
        claims.user_id,
    )))
}

#[derive(Deserialize)]
pub struct DeleteCommentPayload {
    comment_id: i64,
}

/// Deletes one of the user's comments along with every reply to it. Returns an
/// empty body, or `NotFound` if the user has no comment with that id.
async fn delete_user_comment_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<DeleteCommentPayload>,
) -> Result<(), CadenzaError> {
    delete_user_comment(&db, claims.user_id, payload.comment_id).await
}

#[derive(Deserialize)]
pub struct VotePayload {
    comment_id: i64,
    /// "up" or "down", or null to take the user's vote back
    vote: Option<CommentVote>,
}

/// Sets the user's vote on a comment, replacing the vote they already cast, or
/// takes it back when `vote` is null. Returns an empty body, or `NotFound` if an
/// up or down vote names a comment that doesn't exist.
async fn vote_on_comment_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<VotePayload>,
) -> Result<(), CadenzaError> {
    set_comment_vote(&db, claims.user_id, payload.comment_id, payload.vote).await
}

pub fn get_comments_router() -> Router<AppState> {
    Router::new()
        .route("/", get(get_song_comments_handler))
        .route("/", post(new_comment_handler))
        .route("/", delete(delete_user_comment_handler))
        .route("/votes", post(vote_on_comment_handler))
}
