use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{delete, get, patch, post},
};
use axum_jwt_auth::Claims;
use chrono::{DateTime, Utc};
use sea_orm::DatabaseConnection;
use sea_orm::prelude::Uuid;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        audience::{PrivacyField, visible_friend_ids},
        friend_relations,
        notification::{self, NotificationCursor as DbNotificationCursor},
        social::{
            self, CommentsCursor as DbCommentsCursor, FeedExclude, InterestDelta,
            TopicPostsCursor as DbTopicPostsCursor,
        },
    },
    err::CadenzaError,
    routes::json::social::{
        CommentsCursor, CreateCommentResponse, CreatePostResponse, FeedResponse,
        FriendshipsResponse, NotificationCursor, NotificationsResponse, PostCommentsResponse,
        SocialAuthor, SocialComment, SocialFriend, SocialNotification, SocialPost,
        TopicPostsCursor, TopicPostsResponse, UserPostsResponse, UserSearchPerson,
        UserSearchResponse,
    },
    services::{
        realtime::SharedPresence,
        social_feed::{NewPostTopic, SocialFeedService},
    },
};

const POST_CONTENT_MAX: usize = 500;
const COMMENT_CONTENT_MAX: usize = 500;
const TOPIC_MK_ID_MAX: usize = 128;
const TOPIC_NAME_MAX: usize = 200;

/// Ranked posts for the signed-in user.
///
/// `exclude` is `none`, `loaded`, or `viewed` (default `none`). At most 10
/// posts. Each returned id is marked `loaded`.
///
/// ```json
/// { "feed": [ { "post_id": 1, "content": "hi", "likes": 0, "liked": false, "created_at": "2026-10-16T18:00:00Z", "edited_at": null, "author": { "user_id": "...", "username": "ada" }, "topic_mk_id": null, "comment_count": 0 } ] }
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

/// Posts by completed friends and the caller, newest first, 20 a page.
/// `before` (RFC 3339) pages back: pass the last post's `created_at`. A
/// shorter page is the end. Nothing is marked loaded or viewed.
///
/// ```json
/// { "feed": [ { "post_id": 1, "content": "hi", "likes": 0, "liked": false, "created_at": "2026-10-16T18:00:00Z", "edited_at": null, "author": { "user_id": "...", "username": "ada" }, "topic_mk_id": null, "comment_count": 0 } ] }
/// ```
async fn get_friends_feed(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(query): Query<FriendsFeedQuery>,
) -> Result<Json<FeedResponse>, CadenzaError> {
    let posts = social::get_friends_feed(&db, claims.user_id, query.before).await?;
    Ok(Json(FeedResponse {
        feed: posts.into_iter().map(SocialPost::from).collect(),
    }))
}

#[derive(Deserialize)]
struct FriendsFeedQuery {
    before: Option<DateTime<Utc>>,
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
    #[serde(default)]
    shared_playlist_id: Option<i64>,
}

/// Creates a post for the signed-in user. `content` is at most 500 characters.
/// `topic_mk_id` is an optional Apple Music catalog id of a song or artist.
/// `shared_playlist_id` attaches a shared playlist the caller is a member of
/// instead; the two cannot both be set.
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
    let topic = match (topic_mk_id.as_deref(), body.shared_playlist_id) {
        (Some(_), Some(_)) => {
            return Err(CadenzaError::InvalidRequestBody(
                "a post attaches a song or artist, or a shared playlist, not both".into(),
            ));
        }
        (Some(mk_id), None) => NewPostTopic::Apple {
            mk_id,
            song_title: topic_song_title.as_deref(),
            artist_name: topic_artist_name.as_deref(),
        },
        (None, Some(playlist_id)) => NewPostTopic::SharedPlaylist(playlist_id),
        (None, None) => NewPostTopic::None,
    };
    let post_id = social
        .create_post(&db, claims.user_id, &body.content, topic)
        .await?;
    Ok(Json(CreatePostResponse { post_id }))
}

#[derive(Deserialize)]
struct EditContentBody {
    content: String,
    /// Client time in milliseconds, the same clock a like sends.
    timestamp: i64,
    #[serde(default)]
    topic_song_title: Option<String>,
    #[serde(default)]
    topic_artist_name: Option<String>,
}

/// Replaces the signed-in user's post text. `content` is trimmed and at most
/// 500 characters. `timestamp` is the client's edit time. One older than the
/// stored `edited_at` is ignored. A kept edit sets `edited_at` to `now()` and
/// re-embeds the stored text. When the post has a topic, `topic_song_title`
/// and `topic_artist_name` prefix that embedding the same way as create.
/// 404 when the post is missing or belongs to someone else. Responds with
/// `null`.
async fn update_post(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(post_id): Path<i64>,
    Json(body): Json<EditContentBody>,
) -> Result<Json<Value>, CadenzaError> {
    let content = require_content(&body.content, POST_CONTENT_MAX)?;
    let edited_at = edited_at_from_millis(body.timestamp)?;
    let topic_song_title =
        parse_optional_text(body.topic_song_title, "topic_song_title", TOPIC_NAME_MAX)?;
    let topic_artist_name =
        parse_optional_text(body.topic_artist_name, "topic_artist_name", TOPIC_NAME_MAX)?;
    social
        .update_post(
            &db,
            claims.user_id,
            post_id,
            content,
            edited_at,
            topic_song_title.as_deref(),
            topic_artist_name.as_deref(),
        )
        .await?;
    Ok(Json(Value::Null))
}

/// Deletes the signed-in user's post. Likes, comments, and view rows go with
/// it. 404 when the post is missing or belongs to someone else. Responds with
/// `null`.
async fn delete_post(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(post_id): Path<i64>,
) -> Result<Json<Value>, CadenzaError> {
    social.delete_post(&db, claims.user_id, post_id).await?;
    Ok(Json(Value::Null))
}

/// One post, the same shape as a feed row. 404 when it is gone.
///
/// ```json
/// { "post_id": 1, "content": "hi", "likes": 3, "liked": false, "created_at": "2026-10-16T18:00:00Z", "edited_at": null, "author": { "user_id": "...", "username": "ada" }, "topic_mk_id": "1615585008", "comment_count": 0 }
/// ```
async fn get_post(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(post_id): Path<i64>,
) -> Result<Json<SocialPost>, CadenzaError> {
    let mut posts = social::get_posts(&db, claims.user_id, &[post_id]).await?;
    let Some(post) = posts.pop() else {
        return Err(CadenzaError::NotFound);
    };
    Ok(Json(post.into()))
}

fn require_content(raw: &str, max_chars: usize) -> Result<&str, CadenzaError> {
    let content = raw.trim();
    if content.is_empty() {
        return Err(CadenzaError::InvalidRequestBody(
            "content is required".into(),
        ));
    }
    if content.chars().count() > max_chars {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "content is longer than {max_chars} characters"
        )));
    }
    Ok(content)
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

#[derive(Deserialize)]
struct TopicPostsQuery {
    topic_mk_id: String,
    likes: Option<i64>,
    created_at: Option<DateTime<Utc>>,
    post_id: Option<i64>,
}

impl TopicPostsQuery {
    /// `None` is the first page. The three cursor fields travel together.
    fn cursor(&self) -> Result<Option<DbTopicPostsCursor>, CadenzaError> {
        match (self.likes, self.created_at, self.post_id) {
            (None, None, None) => Ok(None),
            (Some(likes), Some(created_at), Some(post_id)) => Ok(Some(DbTopicPostsCursor {
                likes,
                created_at,
                post_id,
            })),
            _ => Err(CadenzaError::InvalidRequestBody(
                "likes, created_at, and post_id are set together".into(),
            )),
        }
    }
}

/// Posts whose topic is this Apple Music catalog id, at most 10. Most liked
/// first, then newest, then post id.
///
/// Omit `likes`, `created_at`, and `post_id` for the first page. Pass `next`
/// from the previous response as those three fields for the following page.
///
/// ```json
/// { "posts": [ { "post_id": 1, "content": "hi", "likes": 3, "liked": false, "created_at": "2026-10-16T18:00:00Z", "edited_at": null, "author": { "user_id": "...", "username": "ada" }, "topic_mk_id": "1615585008", "comment_count": 0 } ], "next": null }
/// ```
async fn topic_posts(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(query): Query<TopicPostsQuery>,
) -> Result<Json<TopicPostsResponse>, CadenzaError> {
    let cursor = query.cursor()?;
    let topic_mk_id = parse_optional_text(Some(query.topic_mk_id), "topic_mk_id", TOPIC_MK_ID_MAX)?
        .ok_or_else(|| CadenzaError::InvalidRequestBody("topic_mk_id is required".into()))?;
    let page = social
        .topic_posts(&db, claims.user_id, &topic_mk_id, cursor)
        .await?;
    Ok(Json(TopicPostsResponse {
        posts: page.posts.into_iter().map(SocialPost::from).collect(),
        next: page.next.map(|cursor| TopicPostsCursor {
            likes: cursor.likes,
            created_at: cursor.created_at,
            post_id: cursor.post_id,
        }),
    }))
}

/// Sends a friend request from the signed-in user to `user_id`.
///
/// `user1` is the lexicographically smaller uuid. Status is `to_user1` when
/// that person is the recipient, and `to_user2` when the other person is.
/// Sending the same request again responds with `null` and sends nothing. A
/// new request notifies the recipient. If they already requested the caller,
/// the row becomes `complete` and they are notified that it was accepted. 409
/// `FriendshipAlreadyExists` when the pair is already friends. 403
/// `UserBlocked` when either one blocked the other. 422 when `user_id` is the
/// caller.
async fn request_friendship(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Value>, CadenzaError> {
    social::request_friendship(&db, claims.user_id, user_id).await?;
    Ok(Json(Value::Null))
}

/// Removes the friendship row between the signed-in user and `user_id`.
/// Status does not matter: a pending request and a completed friendship both
/// go. A missing row responds with `null`. 422 when `user_id` is the caller.
async fn delete_friendship(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Value>, CadenzaError> {
    social::delete_friendship(&db, claims.user_id, user_id).await?;
    Ok(Json(Value::Null))
}

/// How many people one search returns when it does not say.
const DEFAULT_USER_SEARCH_LIMIT: u64 = 20;
/// The most people one search can ask for.
const MAX_USER_SEARCH_LIMIT: u64 = 50;

#[derive(Deserialize)]
struct UserSearchQuery {
    /// A blank search returns no one.
    #[serde(default)]
    search: String,
    /// How many to return, 20 when left out and never more than 50.
    #[serde(default)]
    limit: Option<u64>,
}

/// People whose username contains `search`, other than the caller.
///
/// Case insensitive. A blank search returns no one. `limit` defaults to 20
/// and is at most 50. Username order.
///
/// ```json
/// { "users": [ { "user_id": "...", "username": "ada", "is_friend": false } ] }
/// ```
async fn search_users(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(query): Query<UserSearchQuery>,
) -> Result<Json<UserSearchResponse>, CadenzaError> {
    let limit = query
        .limit
        .unwrap_or(DEFAULT_USER_SEARCH_LIMIT)
        .clamp(1, MAX_USER_SEARCH_LIMIT);
    let people = social::search_users(&db, claims.user_id, &query.search, limit).await?;
    Ok(Json(UserSearchResponse {
        users: people
            .into_iter()
            .map(|person| UserSearchPerson {
                user_id: person.user_id.to_string(),
                username: person.username,
                is_friend: person.is_friend,
            })
            .collect(),
    }))
}

#[derive(Deserialize)]
struct NotificationQuery {
    unread: Option<bool>,
    created_at: Option<DateTime<Utc>>,
    notif_id: Option<i64>,
}

impl NotificationQuery {
    /// `None` is the first page. The three cursor fields travel together.
    fn cursor(&self) -> Result<Option<DbNotificationCursor>, CadenzaError> {
        match (self.unread, self.created_at, self.notif_id) {
            (None, None, None) => Ok(None),
            (Some(unread), Some(created_at), Some(notif_id)) => Ok(Some(DbNotificationCursor {
                unread,
                created_at,
                notif_id,
            })),
            _ => Err(CadenzaError::InvalidRequestBody(
                "unread, created_at, and notif_id are set together".into(),
            )),
        }
    }
}

/// The signed-in user's notifications, at most 20. Unread first, then newest,
/// with `notif_id` breaking a `created_at` tie.
///
/// Omit the query params for the first page. Pass `next` from the previous
/// response as `unread`, `created_at`, and `notif_id` for the following page.
///
/// ```json
/// { "notifications": [ { "notif_id": 1, "title": "miles.davis", "content": "sent you a friend request", "type": "friend_req_received", "created_at": "2026-11-10T18:00:00Z", "unread": true, "metadata": { "sender_id": "00000000-0000-0000-0000-000000000000", "resolution": null } } ], "next": null }
/// ```
async fn notifications(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(query): Query<NotificationQuery>,
) -> Result<Json<NotificationsResponse>, CadenzaError> {
    let page = notification::list_notifications(&db, claims.user_id, query.cursor()?).await?;
    Ok(Json(NotificationsResponse {
        notifications: page
            .notifications
            .into_iter()
            .map(|row| SocialNotification {
                notif_id: row.notif_id,
                title: row.title,
                content: row.content,
                notif_type: row.notif_type,
                created_at: row.created_at,
                unread: row.unread,
                metadata: row.metadata,
            })
            .collect(),
        next: page.next.map(|cursor| NotificationCursor {
            unread: cursor.unread,
            created_at: cursor.created_at,
            notif_id: cursor.notif_id,
        }),
    }))
}

#[derive(Deserialize)]
struct MarkNotificationsReadBody {
    notif_ids: Vec<i64>,
}

/// Marks the signed-in user's notifications in `notif_ids` read. Ids that are
/// not theirs are ignored. Responds with `null`.
async fn mark_notifications_read(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<MarkNotificationsReadBody>,
) -> Result<Json<Value>, CadenzaError> {
    notification::mark_notifications_read(&db, claims.user_id, &body.notif_ids).await?;
    Ok(Json(Value::Null))
}

/// The signed-in user's friends, pending requests, and blocked accounts.
/// Friends sort favorites first, then online, then by username. `online` is
/// false for a friend who hides their now playing from friends.
///
/// ```json
/// { "incoming": [ { "user_id": "...", "username": "ada" } ], "outgoing": [], "friends": [ { "user_id": "...", "username": "bo", "online": true, "favorite": false } ], "blocked": [] }
/// ```
async fn friendships(
    State(db): State<DatabaseConnection>,
    State(presence): State<SharedPresence>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<FriendshipsResponse>, CadenzaError> {
    let (lists, favorites, visible, blocked) = tokio::try_join!(
        social::list_friendships(&db, claims.user_id),
        friend_relations::favorite_ids(&db, claims.user_id),
        visible_friend_ids(&db, claims.user_id, PrivacyField::NowPlaying),
        friend_relations::blocked_people(&db, claims.user_id),
    )?;
    let online = presence.online_among(&visible);
    let people = |list: Vec<social::FriendPerson>| {
        list.into_iter()
            .map(|person| SocialAuthor {
                user_id: person.user_id.to_string(),
                username: person.username,
            })
            .collect()
    };
    // list_friendships is username order and the sort is stable, so that
    // order holds inside each group
    let mut friends: Vec<SocialFriend> = lists
        .friends
        .into_iter()
        .map(|person| SocialFriend {
            online: online.contains(&person.user_id),
            favorite: favorites.contains(&person.user_id),
            user_id: person.user_id.to_string(),
            username: person.username,
        })
        .collect();
    friends.sort_by_key(|friend| (!friend.favorite, !friend.online));
    Ok(Json(FriendshipsResponse {
        incoming: people(lists.incoming),
        outgoing: people(lists.outgoing),
        friends,
        blocked: people(blocked),
    }))
}

/// Marks a friend a favorite, or with DELETE, drops it. 404 when they are not
/// a friend. Responds with `null`.
async fn favorite_friend(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Value>, CadenzaError> {
    friend_relations::favorite_friend(&db, claims.user_id, user_id).await?;
    Ok(Json(Value::Null))
}

async fn unfavorite_friend(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Value>, CadenzaError> {
    friend_relations::unfavorite_friend(&db, claims.user_id, user_id).await?;
    Ok(Json(Value::Null))
}

/// Blocks `user_id`, or with DELETE, unblocks. A block ends any friendship or
/// request between the two and hides each one's posts from the other. An
/// unblock does not bring the friendship back. Responds with `null`.
async fn block_user(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Value>, CadenzaError> {
    friend_relations::block_user(&db, claims.user_id, user_id).await?;
    Ok(Json(Value::Null))
}

async fn unblock_user(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Value>, CadenzaError> {
    friend_relations::unblock_user(&db, claims.user_id, user_id).await?;
    Ok(Json(Value::Null))
}

/// Accepts an incoming friend request from `user_id`. Sets that row to
/// `complete` and notifies the sender. 404 when there is no request waiting
/// on the caller. Responds with `null`.
async fn accept_friendship(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Value>, CadenzaError> {
    social::accept_friendship(&db, claims.user_id, user_id).await?;
    Ok(Json(Value::Null))
}

/// One user's public profile and their posts, newest first. `user` in the
/// path is the author. The signed-in user is the viewer, for `liked`.
///
/// ```json
/// { "profile": { "user_id": "...", "username": "ada", "bio": "", "friend_count": 0, "friend_request_sent": false, "friend_request_received": false, "is_friend": false }, "posts": [] }
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

#[derive(Deserialize)]
struct CommentsQuery {
    likes: Option<i64>,
    created_at: Option<DateTime<Utc>>,
    comment_id: Option<i64>,
}

impl CommentsQuery {
    /// `None` is the first page. The three cursor fields travel together.
    fn cursor(&self) -> Result<Option<DbCommentsCursor>, CadenzaError> {
        match (self.likes, self.created_at, self.comment_id) {
            (None, None, None) => Ok(None),
            (Some(likes), Some(created_at), Some(comment_id)) => Ok(Some(DbCommentsCursor {
                likes,
                created_at,
                comment_id,
            })),
            _ => Err(CadenzaError::InvalidRequestBody(
                "likes, created_at, and comment_id are set together".into(),
            )),
        }
    }
}

/// Comments on this post, at most 20. Most liked first, then newest, then
/// comment id.
///
/// Omit the query params for the first page. Pass `next` from the previous
/// response as `likes`, `created_at`, and `comment_id` for the following page.
///
/// ```json
/// { "comments": [ { "comment_id": 1, "post_id": 4, "content": "this", "likes": 2, "liked": false, "created_at": "2026-10-16T18:00:00Z", "edited_at": null, "author": { "user_id": "...", "username": "ada" } } ], "next": null }
/// ```
async fn get_comments(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(post_id): Path<i64>,
    Query(query): Query<CommentsQuery>,
) -> Result<Json<PostCommentsResponse>, CadenzaError> {
    let page = social
        .get_post_comments(&db, claims.user_id, post_id, query.cursor()?)
        .await?;
    Ok(Json(PostCommentsResponse {
        comments: page.comments.into_iter().map(SocialComment::from).collect(),
        next: page.next.map(|cursor| CommentsCursor {
            likes: cursor.likes,
            created_at: cursor.created_at,
            comment_id: cursor.comment_id,
        }),
    }))
}

#[derive(Deserialize)]
struct CreateCommentBody {
    content: String,
}

/// Creates a comment on this post for the signed-in user. `content` is at
/// most 500 characters. The post's author is notified, unless they wrote the
/// comment. 404 when the post is gone.
///
/// ```json
/// { "comment_id": 1 }
/// ```
async fn create_comment(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(post_id): Path<i64>,
    Json(body): Json<CreateCommentBody>,
) -> Result<Json<CreateCommentResponse>, CadenzaError> {
    let content = require_content(&body.content, COMMENT_CONTENT_MAX)?;
    let comment_id = social
        .create_comment(&db, claims.user_id, post_id, content)
        .await?;
    Ok(Json(CreateCommentResponse { comment_id }))
}

/// Replaces the signed-in user's comment text. `content` is trimmed and at
/// most 500 characters. `timestamp` is the client's edit time. One older than
/// the stored `edited_at` is ignored. A kept edit sets `edited_at` to `now()`.
/// 404 when the comment is missing or belongs to someone else. Responds with
/// `null`.
async fn update_comment(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(comment_id): Path<i64>,
    Json(body): Json<EditContentBody>,
) -> Result<Json<Value>, CadenzaError> {
    let content = require_content(&body.content, COMMENT_CONTENT_MAX)?;
    let edited_at = edited_at_from_millis(body.timestamp)?;
    social
        .update_comment(&db, claims.user_id, comment_id, content, edited_at)
        .await?;
    Ok(Json(Value::Null))
}

/// The client's edit time. Out of range for a `timestamptz` is a 422.
fn edited_at_from_millis(timestamp: i64) -> Result<DateTime<Utc>, CadenzaError> {
    DateTime::from_timestamp_millis(timestamp)
        .ok_or_else(|| CadenzaError::InvalidRequestBody("timestamp is out of range".to_owned()))
}

/// Deletes the signed-in user's comment and drops the post's comment count.
/// Comment likes go with it. 404 when the comment is missing or belongs to
/// someone else. Responds with `null`.
async fn delete_comment(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(comment_id): Path<i64>,
) -> Result<Json<Value>, CadenzaError> {
    social
        .delete_comment(&db, claims.user_id, comment_id)
        .await?;
    Ok(Json(Value::Null))
}

/// Likes a comment. `timestamp` is the client's click time in milliseconds.
/// Same older-click rule as post likes. Responds with `null`.
async fn like_comment(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(comment_id): Path<i64>,
    Json(body): Json<LikeBody>,
) -> Result<Json<Value>, CadenzaError> {
    social
        .like_comment(&db, claims.user_id, comment_id, body.timestamp)
        .await?;
    Ok(Json(Value::Null))
}

/// Removes the signed-in user's comment like. Same timestamp rule as like.
/// Responds with `null`.
async fn unlike_comment(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(comment_id): Path<i64>,
    Json(body): Json<LikeBody>,
) -> Result<Json<Value>, CadenzaError> {
    social
        .unlike_comment(&db, claims.user_id, comment_id, body.timestamp)
        .await?;
    Ok(Json(Value::Null))
}

pub fn get_social_router() -> Router<AppState> {
    Router::new()
        .route("/feed", get(get_feed))
        .route("/feed/friends", get(get_friends_feed))
        .route("/interests/update", patch(update_interests))
        .route("/interests/decay", patch(decay_interests))
        .route("/posts", post(create_post))
        .route(
            "/posts/{post_id}",
            get(get_post).delete(delete_post).patch(update_post),
        )
        .route("/posts/views", post(mark_viewed))
        .route("/posts/topic", get(topic_posts))
        .route("/posts/user/{author_id}", get(user_posts))
        .route("/users", get(search_users))
        .route("/friends", get(friendships))
        .route("/notifications", get(notifications))
        .route("/notifications/read", post(mark_notifications_read))
        .route("/friends/{user_id}/accept", post(accept_friendship))
        .route(
            "/friends/{user_id}/favorite",
            post(favorite_friend).delete(unfavorite_friend),
        )
        .route("/blocks/{user_id}", post(block_user).delete(unblock_user))
        .route(
            "/friends/{user_id}",
            post(request_friendship).delete(delete_friendship),
        )
        .route(
            "/posts/{post_id}/likes",
            post(like_post).delete(unlike_post),
        )
        .route(
            "/posts/{post_id}/comments",
            get(get_comments).post(create_comment),
        )
        .route(
            "/comments/{comment_id}",
            delete(delete_comment).patch(update_comment),
        )
        .route(
            "/comments/{comment_id}/likes",
            post(like_comment).delete(unlike_comment),
        )
}
