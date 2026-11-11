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

/// `{user_id, username, bio, friend_count, friend_request_sent, friend_request_received, is_friend, is_favorite, blocked}`
/// from `GET /social/posts/user/:id`. `friend_count` is completed rows in
/// `friendships`. `friend_request_sent` is the viewer's pending request to
/// this user. `friend_request_received` is this user's pending request to the
/// viewer. `is_friend` is a completed friendship with the viewer.
/// `is_favorite` is the viewer's favorite. `blocked` is the viewer's block.
#[derive(Serialize)]
pub struct SocialUserProfile {
    pub user_id: String,
    pub username: String,
    pub bio: String,
    pub friend_count: i64,
    pub friend_request_sent: bool,
    pub friend_request_received: bool,
    pub is_friend: bool,
    pub is_favorite: bool,
    pub blocked: bool,
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
            is_favorite: profile.is_favorite,
            blocked: profile.blocked,
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

/// The sort position of the last topic post on a full page. The next request
/// passes these three fields back as query params.
#[derive(Serialize)]
pub struct TopicPostsCursor {
    pub likes: i64,
    pub created_at: DateTime<Utc>,
    pub post_id: i64,
}

/// `{posts, next}` from `GET /social/posts/topic`, at most 10.
/// Most liked first, then newest, then post id descending.
#[derive(Serialize)]
pub struct TopicPostsResponse {
    pub posts: Vec<SocialPost>,
    pub next: Option<TopicPostsCursor>,
}

/// The sort position of the last comment on a full page. The next request
/// passes these three fields back as query params.
#[derive(Serialize)]
pub struct CommentsCursor {
    pub likes: i64,
    pub created_at: DateTime<Utc>,
    pub comment_id: i64,
}

/// `{comments, next}` from `GET /social/posts/:id/comments`, at most 20.
/// Most liked first, then newest, then comment id descending.
#[derive(Serialize)]
pub struct PostCommentsResponse {
    pub comments: Vec<SocialComment>,
    pub next: Option<CommentsCursor>,
}

#[derive(Serialize)]
pub struct CreateCommentResponse {
    pub comment_id: i64,
}

/// `{incoming, outgoing, friends, blocked}` from `GET /social/friends`.
/// Each person is `{user_id, username}`.
/// `incoming` is requests waiting on the signed-in user. `outgoing` is
/// requests they sent. `friends` is completed pairs. `blocked` is accounts
/// they blocked.
#[derive(Serialize)]
pub struct FriendshipsResponse {
    pub incoming: Vec<SocialAuthor>,
    pub outgoing: Vec<SocialAuthor>,
    pub friends: Vec<SocialFriend>,
    pub blocked: Vec<SocialAuthor>,
}

/// One friend in `GET /social/friends`. `online` is whether they have the app
/// open, false when their now playing is hidden from friends. `favorite` is
/// the caller's favorite.
#[derive(Serialize)]
pub struct SocialFriend {
    pub user_id: String,
    pub username: String,
    pub online: bool,
    pub favorite: bool,
}

/// One person from `GET /social/users`. `is_friend` is a completed friendship.
#[derive(Serialize)]
pub struct UserSearchPerson {
    pub user_id: String,
    pub username: String,
    pub is_friend: bool,
}

/// `{users}` from `GET /social/users`.
#[derive(Serialize)]
pub struct UserSearchResponse {
    pub users: Vec<UserSearchPerson>,
}

/// One notification as `GET /social/notifications` returns it.
///
/// ```json
/// {
///   "notif_id": 1,
///   "title": "miles.davis",
///   "content": "sent you a friend request",
///   "type": "friend_req_received",
///   "created_at": "2026-11-10T18:00:00Z",
///   "unread": true,
///   "metadata": { "sender_id": "00000000-0000-0000-0000-000000000000", "resolution": null }
/// }
/// ```
#[derive(Serialize)]
pub struct SocialNotification {
    pub notif_id: i64,
    pub title: String,
    pub content: String,
    /// `friend_req_received`, `friend_req_accepted`, or `comment`.
    #[serde(rename = "type")]
    pub notif_type: String,
    pub created_at: DateTime<Utc>,
    pub unread: bool,
    /// `{"post_id"}` for a comment, or `{"sender_id", "resolution"}` for a friend request.
    pub metadata: serde_json::Value,
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
