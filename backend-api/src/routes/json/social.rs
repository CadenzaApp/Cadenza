//! Wire shapes for `/social`.

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::db::social::{PublicProfile, SocialComment as CommentRow, SocialPost as PostRow};

/// One post as `/social/feed`, `/social/posts/user/:id`, and
/// `/social/posts/topic` return it.
///
/// ```json
/// {
///   "post_id": 1,
///   "content": "hello",
///   "likes": 2,
///   "liked": false,
///   "created_at": "2026-10-16T18:00:00Z",
///   "author": { "user_id": "11111111-1111-1111-1111-111111111111", "username": "ada" },
///   "topic_mk_id": "1615585008",
///   "comment_count": 3
/// }
/// ```
#[derive(Serialize)]
pub struct SocialPost {
    pub post_id: i64,
    pub content: String,
    pub likes: i64,
    pub liked: bool,
    pub created_at: DateTime<Utc>,
    pub author: SocialAuthor,
    /// Apple Music catalog id of the attached song or artist, or `null`.
    pub topic_mk_id: Option<String>,
    pub comment_count: i64,
}

#[derive(Serialize)]
pub struct SocialAuthor {
    pub user_id: String,
    pub username: String,
}

impl From<PostRow> for SocialPost {
    fn from(post: PostRow) -> Self {
        Self {
            post_id: post.post_id,
            content: post.content,
            likes: post.likes,
            liked: post.liked,
            created_at: post.created_at,
            author: SocialAuthor {
                user_id: post.author_id.to_string(),
                username: post.author_username,
            },
            topic_mk_id: post.topic_mk_id,
            comment_count: post.comment_count,
        }
    }
}

/// One comment as `GET /social/posts/:id/comments` returns it.
///
/// ```json
/// {
///   "comment_id": 1,
///   "post_id": 4,
///   "content": "this",
///   "likes": 2,
///   "liked": false,
///   "created_at": "2026-10-16T18:00:00Z",
///   "author": { "user_id": "11111111-1111-1111-1111-111111111111", "username": "ada" }
/// }
/// ```
#[derive(Serialize)]
pub struct SocialComment {
    pub comment_id: i64,
    pub post_id: i64,
    pub content: String,
    pub likes: i64,
    pub liked: bool,
    pub created_at: DateTime<Utc>,
    pub author: SocialAuthor,
}

impl From<CommentRow> for SocialComment {
    fn from(comment: CommentRow) -> Self {
        Self {
            comment_id: comment.comment_id,
            post_id: comment.post_id,
            content: comment.content,
            likes: comment.likes,
            liked: comment.liked,
            created_at: comment.created_at,
            author: SocialAuthor {
                user_id: comment.author_id.to_string(),
                username: comment.author_username,
            },
        }
    }
}

/// `{user_id, username, bio}` from `GET /social/posts/user/:id`.
#[derive(Serialize)]
pub struct SocialUserProfile {
    pub user_id: String,
    pub username: String,
    pub bio: String,
}

impl From<PublicProfile> for SocialUserProfile {
    fn from(profile: PublicProfile) -> Self {
        Self {
            user_id: profile.user_id.to_string(),
            username: profile.username,
            bio: profile.bio,
        }
    }
}

#[derive(Serialize)]
pub struct FeedResponse {
    pub feed: Vec<SocialPost>,
}

#[derive(Serialize)]
pub struct CreatePostResponse {
    pub post_id: i64,
}

#[derive(Serialize)]
pub struct UserPostsResponse {
    pub profile: SocialUserProfile,
    pub posts: Vec<SocialPost>,
}

/// `{posts}` from `GET /social/posts/topic`, most liked first.
#[derive(Serialize)]
pub struct TopicPostsResponse {
    pub posts: Vec<SocialPost>,
}

/// `{comments}` from `GET /social/posts/:id/comments`, most liked first.
#[derive(Serialize)]
pub struct PostCommentsResponse {
    pub comments: Vec<SocialComment>,
}

#[derive(Serialize)]
pub struct CreateCommentResponse {
    pub comment_id: i64,
}
