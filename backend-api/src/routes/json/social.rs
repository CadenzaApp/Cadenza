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
///   "edited_at": null,
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
    /// `null` until the author edits the post.
    pub edited_at: Option<DateTime<Utc>>,
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
            edited_at: post.edited_at,
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
///   "edited_at": null,
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
    /// `null` until the author edits the comment.
    pub edited_at: Option<DateTime<Utc>>,
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
            edited_at: comment.edited_at,
            author: SocialAuthor {
                user_id: comment.author_id.to_string(),
                username: comment.author_username,
            },
        }
    }
}

/// `{user_id, username, bio, friend_count, friend_request_sent, friend_request_received, is_friend}`
/// from `GET /social/posts/user/:id`. `friend_count` is completed rows in
/// `friendships`. `friend_request_sent` is the viewer's pending request to
/// this user. `friend_request_received` is this user's pending request to the
/// viewer. `is_friend` is a completed friendship with the viewer.
#[derive(Serialize)]
pub struct SocialUserProfile {
    pub user_id: String,
    pub username: String,
    pub bio: String,
    pub friend_count: i64,
    pub friend_request_sent: bool,
    pub friend_request_received: bool,
    pub is_friend: bool,
}

impl From<PublicProfile> for SocialUserProfile {
    fn from(profile: PublicProfile) -> Self {
        Self {
            user_id: profile.user_id.to_string(),
            username: profile.username,
            bio: profile.bio,
            friend_count: profile.friend_count,
            friend_request_sent: profile.friend_request_sent,
            friend_request_received: profile.friend_request_received,
            is_friend: profile.is_friend,
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

/// `{incoming, outgoing, friends}` from `GET /social/friends`.
/// Each person is `{user_id, username}`.
/// `incoming` is requests waiting on the signed-in user. `outgoing` is
/// requests they sent. `friends` is completed pairs.
#[derive(Serialize)]
pub struct FriendshipsResponse {
    pub incoming: Vec<SocialAuthor>,
    pub outgoing: Vec<SocialAuthor>,
    pub friends: Vec<SocialAuthor>,
}

/// `{users}` from `GET /social/users`. Each person is `{user_id, username}`.
#[derive(Serialize)]
pub struct UserSearchResponse {
    pub users: Vec<SocialAuthor>,
}

/// One notification as `GET /social/notifications` returns it.
///
/// ```json
/// {
///   "notif_id": 1,
///   "title": "miles.davis",
///   "content": "liked your post",
///   "icon": "heart",
///   "created_at": "2026-11-10T18:00:00Z",
///   "unread": true
/// }
/// ```
#[derive(Serialize)]
pub struct SocialNotification {
    pub notif_id: i64,
    pub title: String,
    pub content: String,
    /// `heart`, `chatbubble`, or `person-add`.
    pub icon: String,
    pub created_at: DateTime<Utc>,
    pub unread: bool,
}

/// The sort position of the last row on a full page. The next request passes
/// these three fields back as query params.
#[derive(Serialize)]
pub struct NotificationCursor {
    pub unread: bool,
    pub created_at: DateTime<Utc>,
    pub notif_id: i64,
}

/// `{notifications, next}` from `GET /social/notifications`, at most 20.
/// Unread first, then newest, then `notif_id` descending.
#[derive(Serialize)]
pub struct NotificationsResponse {
    pub notifications: Vec<SocialNotification>,
    pub next: Option<NotificationCursor>,
}
