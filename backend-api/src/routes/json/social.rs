//! Wire shapes for `/social`.

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::db::social::{PublicProfile, SocialPost as PostRow};

/// One post as `/social/feed` and `/social/posts/user/:id` return it.
///
/// ```json
/// {
///   "post_id": 1,
///   "content": "hello",
///   "likes": 2,
///   "liked": false,
///   "created_at": "2026-10-16T18:00:00Z",
///   "author": { "user_id": "11111111-1111-1111-1111-111111111111", "username": "ada" }
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
