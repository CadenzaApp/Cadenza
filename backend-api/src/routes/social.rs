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
use std::collections::{HashMap, HashSet};

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        audience::{PrivacyField, visible_friend_ids},
        friend_relations,
        notification::{self, NotificationCursor as DbNotificationCursor},
        social::{
            self, CommentsCursor as DbCommentsCursor, FeedExclude, InterestDelta, NewPostTag,
            POST_TAG_LIMIT, PostTagPatch, SpotlightInput, TopicPostsCursor as DbTopicPostsCursor,
        },
    },
    err::CadenzaError,
    routes::json::{
        social::{
            AddSpotlightsResponse, CommentsCursor, CreateCommentResponse, CreatePostResponse,
            FeedHistoryItem, FeedHistoryResponse, FeedResponse, FriendshipsResponse,
            NotificationCursor, NotificationsResponse, PostCommentsResponse, PostTagsResponse,
            SocialAuthor, SocialComment, SocialFriend, SocialNotification, SocialPost,
            TopicPostsCursor, TopicPostsResponse, UserPostsResponse, UserRepliesResponse,
            UserSearchPerson, UserSearchResponse,
        },
        vec_into,
    },
    services::{
        realtime::SharedPresence,
        social_feed::{InitialSpotlightChance, NewPostTopic, SocialFeedService},
        song_metadata::SongMetadataService,
        spotlights::spawn_spotlight_tagging,
        tag_generation::TagGenerationService,
    },
};

const POST_CONTENT_MAX: usize = 500;
const POST_TAG_TEXT_MAX: usize = 24;
const COMMENT_CONTENT_MAX: usize = 500;
const TOPIC_MK_ID_MAX: usize = 128;
const TOPIC_NAME_MAX: usize = 200;

/// Ranked posts for the signed-in user. A spotlight may follow a ranked post.
///
/// `exclude` is `none`, `loaded`, or `viewed` (default `none`).
/// `first_page` is true on the first page. That response includes
/// `latest_view_order`, the highest `view_order` when the page was fetched.
/// Previously viewed starts at that number and goes down. Later pages omit it.
/// `initial_spotlight_chance` is `history` or a number from 0 to 1 (default
/// `0`). `history` reads the 3 newest viewed posts: 0.2 for each leading
/// non-spotlight, stopping at a spotlight, capped at 0.6. A spotlight viewed
/// more than two days ago sets that start to 0.6. A number is used as the
/// starting chance. `spotlight_chance` in the response is the chance after
/// this page, and the next page sends that number back. Up to 10 similar
/// and hot posts. After each ranked post,
/// a roll under the current chance inserts the next unviewed spotlight
/// behind it and resets the chance to 0, then the chance rises by 0.15.
/// Spotlights are not appended once those posts run out. The posts returned
/// are marked `loaded` and get no `view_order`.
/// `author` is null for a spotlight. `not_enough_spotlights`
/// is true when fewer than five of this user's spotlight posts are still
/// unviewed. `loaded` still counts.
///
/// ```json
/// { "feed": [ { "post_id": 1, "content": "hi", "likes": 0, "liked": false, "created_at": "2026-10-16T18:00:00Z", "edited_at": null, "author": { "user_id": "...", "username": "ada" }, "topic_mk_id": null, "comment_count": 0 } ], "not_enough_spotlights": false, "spotlight_chance": 0.4, "latest_view_order": 12 }
/// ```
async fn get_feed(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(query): Query<FeedQuery>,
) -> Result<Json<FeedResponse>, CadenzaError> {
    let latest_view_order = if query.first_page() {
        Some(social::max_view_order(&db, claims.user_id).await?)
    } else {
        None
    };
    let page = social
        .get_feed(
            &db,
            claims.user_id,
            query.exclude()?,
            query.initial_spotlight_chance()?,
        )
        .await?;
    Ok(Json(FeedResponse {
        feed: page.posts.into_iter().map(SocialPost::from).collect(),
        not_enough_spotlights: Some(page.not_enough_spotlights),
        spotlight_chance: Some(page.spotlight_chance),
        latest_view_order,
    }))
}

/// Posts this user viewed, from `before_view_order` downward.
///
/// `before_view_order` is the highest number included. The first page passes
/// `latest_view_order` from `GET /social/feed?first_page=true`. The next page
/// passes one less than the last row's `view_order`. `limit` defaults to 10
/// and caps at 50. Each item is a `SocialPost` plus `view_order` and
/// `viewed_at`. Blocked authors are left out.
///
/// ```json
/// { "feed": [ { "post_id": 1, "content": "hi", "likes": 0, "liked": false, "created_at": "2026-10-16T18:00:00Z", "edited_at": null, "author": { "user_id": "...", "username": "ada" }, "topic_mk_id": null, "comment_count": 0, "view_order": 4, "viewed_at": "2026-11-01T18:00:00Z" } ] }
/// ```
async fn get_feed_history(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<FeedHistoryResponse>, CadenzaError> {
    let limit = query.limit()?;
    let posts =
        social::feed_history(&db, claims.user_id, query.before_view_order()?, limit).await?;
    Ok(Json(FeedHistoryResponse {
        feed: posts
            .into_iter()
            .map(|row| FeedHistoryItem {
                post: row.post.into(),
                view_order: row.view_order,
                viewed_at: row.viewed_at,
            })
            .collect(),
    }))
}

#[derive(Deserialize)]
struct HistoryQuery {
    before_view_order: Option<i32>,
    limit: Option<i64>,
}

impl HistoryQuery {
    fn before_view_order(&self) -> Result<i32, CadenzaError> {
        self.before_view_order
            .ok_or_else(|| CadenzaError::InvalidRequestBody("before_view_order is required".into()))
    }

    fn limit(&self) -> Result<i64, CadenzaError> {
        match self.limit {
            None => Ok(social::HISTORY_DEFAULT_LIMIT),
            Some(limit) if limit < 1 => Err(CadenzaError::InvalidRequestBody(
                "limit must be at least 1".into(),
            )),
            Some(limit) => Ok(limit.min(social::HISTORY_MAX_LIMIT)),
        }
    }
}

#[derive(Deserialize)]
struct SpotlightsBody {
    spotlights: Vec<SpotlightItem>,
}

#[derive(Deserialize)]
struct SpotlightItem {
    #[serde(rename = "type")]
    kind: String,
    id: String,
}

/// Queues catalog ids as spotlight posts for the signed-in user. At most 5.
/// `type` is `artist` or `song`. `id` is a non-empty catalog id, at most 128
/// characters. A catalog id shares one null-author post. When that post has
/// no tags, a song gets up to five of its default tags and an artist gets up
/// to five of its Apple Music genres, read by the backend rather than taken
/// from the body. Tags already stored are applied before this answers. The
/// rest are generated or read after it, so a new song or artist post has no
/// tags for those few seconds. `added` is how many queue rows were new.
///
/// ```json
/// { "added": 2 }
/// ```
async fn add_spotlights(
    State(db): State<DatabaseConnection>,
    State(song_meta_service): State<SongMetadataService>,
    State(tag_gen_service): State<TagGenerationService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<SpotlightsBody>,
) -> Result<Json<AddSpotlightsResponse>, CadenzaError> {
    if body.spotlights.len() > social::SPOTLIGHT_QUEUE as usize {
        return Err(CadenzaError::InvalidRequestBody(
            "at most 5 spotlights".into(),
        ));
    }
    let mut items = Vec::with_capacity(body.spotlights.len());
    for item in body.spotlights {
        if item.kind != "artist" && item.kind != "song" {
            return Err(CadenzaError::InvalidRequestBody(
                "type must be artist or song".into(),
            ));
        }
        let id = item.id.trim();
        if id.is_empty() || id.chars().count() > TOPIC_MK_ID_MAX {
            return Err(CadenzaError::InvalidRequestBody(
                "id must be a non-empty catalog id of at most 128 characters".into(),
            ));
        }
        items.push(SpotlightInput {
            spotlight_type: item.kind,
            musickit_id: id.to_owned(),
        });
    }
    let queued = social::add_spotlights(&db, claims.user_id, &items).await?;
    spawn_spotlight_tagging(db, song_meta_service, tag_gen_service, queued.untagged);
    Ok(Json(AddSpotlightsResponse {
        added: queued.added,
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
        not_enough_spotlights: None,
        spotlight_chance: None,
        latest_view_order: None,
    }))
}

#[derive(Deserialize)]
struct FriendsFeedQuery {
    before: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
struct FeedQuery {
    exclude: Option<String>,
    initial_spotlight_chance: Option<String>,
    first_page: Option<bool>,
}

impl FeedQuery {
    fn first_page(&self) -> bool {
        self.first_page.unwrap_or(false)
    }

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

    fn initial_spotlight_chance(&self) -> Result<InitialSpotlightChance, CadenzaError> {
        let Some(raw) = self.initial_spotlight_chance.as_deref() else {
            return Ok(InitialSpotlightChance::Fixed(0.0));
        };
        let raw = raw.trim();
        if raw.is_empty() || raw == "0" {
            return Ok(InitialSpotlightChance::Fixed(0.0));
        }
        if raw == "history" {
            return Ok(InitialSpotlightChance::History);
        }
        let chance: f64 = raw.parse().map_err(|_| {
            CadenzaError::InvalidRequestBody(
                "initial_spotlight_chance must be history or a number from 0 to 1".into(),
            )
        })?;
        if !(0.0..=1.0).contains(&chance) {
            return Err(CadenzaError::InvalidRequestBody(
                "initial_spotlight_chance must be history or a number from 0 to 1".into(),
            ));
        }
        Ok(InitialSpotlightChance::Fixed(chance))
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
    if body.delta_scores.len() > 100 {
        return Err(CadenzaError::InvalidRequestBody(
            "at most 100 interests per update".into(),
        ));
    }
    let mut deltas = Vec::with_capacity(body.delta_scores.len());
    for score in body.delta_scores {
        if score.name.trim().is_empty()
            || score.name.chars().count() > 200
            || !score.delta.is_finite()
        {
            return Err(CadenzaError::InvalidRequestBody(
                "interest names must be 1-200 characters and deltas must be finite".into(),
            ));
        }
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
    #[serde(default)]
    tags: Vec<IncomingPostTag>,
}

#[derive(Deserialize)]
struct IncomingPostTag {
    text: String,
    color: String,
}

/// Creates a post for the signed-in user. `content` is at most 500 characters.
/// `topic_mk_id` is an optional Apple Music catalog id of a song or artist.
/// `shared_playlist_id` attaches a shared playlist the caller is a member of
/// instead; the two cannot both be set.
/// `topic_song_title` and `topic_artist_name` are display names from MusicKit,
/// used only to prefix the embedding; stored content is unchanged.
///
/// ```json
/// { "post_id": 1, "tags": [{ "tag_id": 4, "text": "live", "color": "#2061f1" }] }
/// ```
///
/// `tags` is optional, at most 10. Each is `{text, color}`. Text is trimmed,
/// internal whitespace is collapsed, and it is at most 24 characters. Color
/// is `#` plus 6 hex digits. A repeated word, ignoring case, is 422. The
/// author is marked `viewed` on the new post with their next `view_order`.
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
    let tags = parse_new_tags(&body.tags)?;
    let (post_id, tags) = social
        .create_post(&db, claims.user_id, &body.content, topic, &tags)
        .await?;
    Ok(Json(CreatePostResponse {
        post_id,
        tags: tags.into_iter().map(Into::into).collect(),
    }))
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
    /// Existing tags to rewrite, keyed by tag id. An id not listed is left alone.
    #[serde(default)]
    edit: HashMap<i64, IncomingPostTag>,
    /// Tag ids to remove.
    #[serde(default)]
    delete: Vec<i64>,
    /// Tags to add. The server assigns each `tag_id`.
    #[serde(default)]
    add: Vec<IncomingPostTag>,
}

/// Replaces the signed-in user's post text. `content` is trimmed and at most
/// 500 characters. `timestamp` is the client's edit time. One older than the
/// stored `edited_at` is ignored. A kept edit sets `edited_at` to `now()` and
/// re-embeds the stored text. When the post has a topic, `topic_song_title`
/// and `topic_artist_name` prefix that embedding the same way as create.
/// 404 when the post is missing or belongs to someone else. Responds with
/// `{tags}`, the post's tags after the edit. An older `timestamp` changes
/// neither the text nor the tags, and still returns the stored tags.
///
/// `edit` rewrites listed tags. `delete` removes those ids. `add` inserts
/// new ones. A field that is omitted does nothing. An id in both `edit` and
/// `delete`, or an id that is not on this post, is 422. More than 10 tags
/// after the write, or a repeated word ignoring case, is 422.
async fn update_post(
    State(db): State<DatabaseConnection>,
    State(social): State<SocialFeedService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(post_id): Path<i64>,
    Json(body): Json<EditContentBody>,
) -> Result<Json<PostTagsResponse>, CadenzaError> {
    let content = require_content(&body.content, POST_CONTENT_MAX)?;
    let edited_at = edited_at_from_millis(body.timestamp)?;
    let topic_song_title =
        parse_optional_text(body.topic_song_title, "topic_song_title", TOPIC_NAME_MAX)?;
    let topic_artist_name =
        parse_optional_text(body.topic_artist_name, "topic_artist_name", TOPIC_NAME_MAX)?;
    let tags = parse_tag_patch(body.edit, body.delete, body.add)?;
    let tags = social
        .update_post(
            &db,
            claims.user_id,
            post_id,
            content,
            edited_at,
            topic_song_title.as_deref(),
            topic_artist_name.as_deref(),
            &tags,
        )
        .await?;
    Ok(Json(PostTagsResponse {
        tags: tags.into_iter().map(Into::into).collect(),
    }))
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

fn parse_new_tags(tags: &[IncomingPostTag]) -> Result<Vec<NewPostTag>, CadenzaError> {
    if tags.len() > POST_TAG_LIMIT {
        return Err(CadenzaError::InvalidRequestBody(
            "a post can have at most 10 tags".into(),
        ));
    }
    let mut seen = HashSet::new();
    let mut parsed = Vec::with_capacity(tags.len());
    for tag in tags {
        let parsed_tag = parse_post_tag(tag)?;
        if !seen.insert(parsed_tag.text.to_lowercase()) {
            return Err(CadenzaError::InvalidRequestBody(
                "a post already has that tag".into(),
            ));
        }
        parsed.push(parsed_tag);
    }
    Ok(parsed)
}

fn parse_tag_patch(
    edit: HashMap<i64, IncomingPostTag>,
    delete: Vec<i64>,
    add: Vec<IncomingPostTag>,
) -> Result<PostTagPatch, CadenzaError> {
    let mut seen_delete = HashSet::new();
    for id in &delete {
        if !seen_delete.insert(*id) {
            return Err(CadenzaError::InvalidRequestBody(
                "a tag cannot be deleted twice".into(),
            ));
        }
        if edit.contains_key(id) {
            return Err(CadenzaError::InvalidRequestBody(
                "a tag cannot be edited and deleted".into(),
            ));
        }
    }
    let mut parsed_edit = HashMap::with_capacity(edit.len());
    for (id, tag) in edit {
        parsed_edit.insert(id, parse_post_tag(&tag)?);
    }
    Ok(PostTagPatch {
        edit: parsed_edit,
        delete,
        add: parse_new_tags(&add)?,
    })
}

fn parse_post_tag(tag: &IncomingPostTag) -> Result<NewPostTag, CadenzaError> {
    let text = tag.text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err(CadenzaError::InvalidRequestBody(
            "tag text is required".into(),
        ));
    }
    if text.chars().count() > POST_TAG_TEXT_MAX {
        return Err(CadenzaError::InvalidRequestBody(
            "tag text is longer than 24 characters".into(),
        ));
    }
    let color = tag.color.trim().to_ascii_lowercase();
    let hex = color.as_bytes();
    let valid =
        hex.len() == 7 && hex[0] == b'#' && hex[1..].iter().all(|byte| byte.is_ascii_hexdigit());
    if !valid {
        return Err(CadenzaError::InvalidRequestBody(
            "tag color must be #rrggbb".into(),
        ));
    }
    Ok(NewPostTag { text, color })
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

/// Marks posts `viewed` for the signed-in user. Every id takes the next
/// `view_order`, in `post_ids` order. A row that already had a number gets a
/// new, higher one. Responds with `null`.
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
/// first, then newest, then post id. A post with no author is left out.
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
struct NotificationIdsBody {
    notif_ids: Vec<i64>,
}

/// Marks the signed-in user's notifications in `notif_ids` read. Ids that are
/// not theirs are ignored. Responds with `null`.
async fn mark_notifications_read(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<NotificationIdsBody>,
) -> Result<Json<Value>, CadenzaError> {
    notification::mark_notifications_read(&db, claims.user_id, &body.notif_ids).await?;
    Ok(Json(Value::Null))
}

/// Deletes the signed-in user's notifications in `notif_ids`. Ids that are
/// not theirs are ignored. Responds with `null`.
async fn dismiss_notifications(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<NotificationIdsBody>,
) -> Result<Json<Value>, CadenzaError> {
    notification::dismiss_notifications(&db, claims.user_id, Some(&body.notif_ids)).await?;
    Ok(Json(Value::Null))
}

/// Deletes every notification the signed-in user has. Responds with `null`.
async fn clear_notifications(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<Value>, CadenzaError> {
    notification::dismiss_notifications(&db, claims.user_id, None).await?;
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

/// One user's comments, newest first, at most 100, each with the post it
/// is on. `user` in the path is the commenter.
///
/// ```json
/// { "replies": [ { "comment_id": 1, "post_id": 4, "content": "this", "likes": 2, "liked": false, "created_at": "2026-10-16T18:00:00Z", "edited_at": null, "author": { "user_id": "...", "username": "ada" }, "post": { "post_id": 4, "content": "new album is out", "author": { "user_id": "...", "username": "bo" } } } ] }
/// ```
async fn user_replies(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(author_id): Path<Uuid>,
) -> Result<Json<UserRepliesResponse>, CadenzaError> {
    let replies = social::get_author_comments(&db, claims.user_id, author_id).await?;
    Ok(Json(UserRepliesResponse {
        replies: vec_into(replies),
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
        .route("/feed/history", get(get_feed_history))
        .route("/feed/friends", get(get_friends_feed))
        .route("/spotlights", post(add_spotlights))
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
        .route("/comments/user/{author_id}", get(user_replies))
        .route("/users", get(search_users))
        .route("/friends", get(friendships))
        .route(
            "/notifications",
            get(notifications).delete(clear_notifications),
        )
        .route("/notifications/read", post(mark_notifications_read))
        .route("/notifications/dismiss", post(dismiss_notifications))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn tag(text: &str, color: &str) -> IncomingPostTag {
        IncomingPostTag {
            text: text.to_owned(),
            color: color.to_owned(),
        }
    }

    #[test]
    fn a_tag_trims_and_collapses_whitespace() {
        let parsed = parse_post_tag(&tag("  Live   Show  ", " #2061F1 ")).unwrap();
        assert_eq!(parsed.text, "Live Show");
        assert_eq!(parsed.color, "#2061f1");
    }

    #[test]
    fn a_tag_rejects_empty_text_and_a_bad_color() {
        assert!(parse_post_tag(&tag("   ", "#2061f1")).is_err());
        assert!(parse_post_tag(&tag("live", "blue")).is_err());
        assert!(parse_post_tag(&tag("live", "#fff")).is_err());
        assert!(parse_post_tag(&tag(&"x".repeat(25), "#2061f1")).is_err());
    }

    #[test]
    fn repeated_words_are_rejected() {
        let tags = vec![tag("Live", "#2061f1"), tag(" live ", "#00907f")];
        assert!(parse_new_tags(&tags).is_err());
    }

    #[test]
    fn an_edit_cannot_also_delete_the_same_tag() {
        let mut edit = HashMap::new();
        edit.insert(4, tag("live", "#2061f1"));
        assert!(parse_tag_patch(edit, vec![4], Vec::new()).is_err());
    }
}
