//! Social posts, likes, comments, view status, interests, friendships, user
//! search, notifications, and the ranked feed's SQL.
//!
//! Ranking math that does not need the database lives here too. Turning text
//! into vectors is `services::social_feed`, which calls the python model.

use std::collections::HashMap;

use crate::db::entity::{comment_likes, comments, post_likes, posts, profile};
use crate::db::friend_relations::{
    NOT_BLOCKED_AUTHOR, blocked_either_way, clear_favorites_between,
};
use crate::err::CadenzaError;
use crate::services::notification::{NewNotification, NotificationType, push_notification};
use chrono::{DateTime, TimeZone, Utc};
use sea_orm::prelude::Uuid;
use sea_orm::{
    ActiveValue::{NotSet, Set},
    ColumnTrait, Condition, ConnectionTrait, DatabaseConnection, DbBackend, DbErr, EntityTrait,
    FromQueryResult, JoinType, QueryFilter, QueryOrder, QuerySelect, QueryTrait, RuntimeErr,
    Statement, TransactionTrait, Value,
    sea_query::{ArrayType, Expr, ExprTrait, Func, OnConflict},
};

/// How many posts one `/feed` call returns. A shorter page means that exclude
/// mode is exhausted.
pub const FEED_SIZE: i64 = 10;

/// How many posts one `GET /social/posts/topic` call returns.
pub const TOPIC_POST_LIMIT: i64 = 10;

/// How many comments one `GET /social/posts/:id/comments` call returns.
pub const COMMENT_PAGE_LIMIT: u64 = 20;

/// Second line of a received friend-request notification. Accept and ignore
/// find the row by this text.
const FRIEND_REQUEST_RECEIVED: &str = "sent you a friend request";

/// Flat extra on [`score_post`] when the author is a completed friend.
pub const FRIEND_SCORE_BOOST: f64 = 10_000.0;

/// Prepended to the user vector so one day of age costs this much similarity
/// in the nearest-post lookup. Matches the python feed this replaced.
const AGE_MULTIPLIER: f64 = 0.02;

/// `posts.embedding_w_bday` stores days since this instant in its first component.
fn posts_epoch() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
}

/// Which `post_view_status` rows `/feed` leaves out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeedExclude {
    /// No view-status filter.
    None,
    /// Skip posts this user has already fully viewed.
    Viewed,
    /// Skip posts `/feed` has already returned to this user.
    Loaded,
}

/// One post, shaped for the feed and the profile page.
#[derive(Clone, Debug)]
pub struct SocialPost {
    pub post_id: i64,
    pub content: String,
    pub likes: i64,
    pub liked: bool,
    pub created_at: DateTime<Utc>,
    /// `None` until the author edits the post.
    pub edited_at: Option<DateTime<Utc>>,
    pub author_id: Uuid,
    pub author_username: String,
    /// Apple Music catalog id of the attached song or artist, when the author
    /// picked one. Kind is not stored; the client asks MusicKit.
    pub topic_mk_id: Option<String>,
    pub comment_count: i64,
}

/// One comment on a post, most liked first.
#[derive(Clone, Debug)]
pub struct SocialComment {
    pub comment_id: i64,
    pub post_id: i64,
    pub content: String,
    pub likes: i64,
    pub liked: bool,
    pub created_at: DateTime<Utc>,
    /// `None` until the author edits the comment.
    pub edited_at: Option<DateTime<Utc>>,
    pub author_id: Uuid,
    pub author_username: String,
}

/// Public header for someone else's profile page.
#[derive(Clone, Debug)]
pub struct PublicProfile {
    pub user_id: Uuid,
    pub username: String,
    pub bio: String,
    /// Completed rows in `friendships` where this user is `user1` or `user2`.
    pub friend_count: i64,
    /// The viewer already has a pending request to this user.
    pub friend_request_sent: bool,
    /// This user already has a pending request to the viewer.
    pub friend_request_received: bool,
    /// The viewer and this user have a completed friendship.
    pub is_friend: bool,
    /// The viewer marked this friend a favorite.
    pub is_favorite: bool,
    /// The viewer blocked this user.
    pub blocked: bool,
}

/// One named interest a score update wants to move.
#[derive(Clone, Debug)]
pub struct InterestDelta {
    pub name: String,
    pub interest_type: String,
    pub delta: f64,
}

/// A candidate from the similar, hot, or friend query, before it is rescored.
#[derive(Clone, Debug)]
pub struct FeedCandidate {
    pub post_id: i64,
    pub embedding: Vec<f64>,
    pub likes: i64,
    pub created_at: DateTime<Utc>,
    /// Set by the friend source. Other sources leave it false; merge keeps true.
    pub sent_by_friend: bool,
}

/// Inserts a post and returns its id. `embedding` is the model vector;
/// `embedding_w_bday` is that vector with days-since-epoch in front.
/// `topic_mk_id` is the Apple Music catalog id of an attached song or artist.
pub async fn insert_post(
    db: &DatabaseConnection,
    user_id: Uuid,
    content: &str,
    embedding: &[f64],
    embedding_w_bday: &[f64],
    topic_mk_id: Option<&str>,
) -> Result<i64, CadenzaError> {
    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO posts (user_id, content, embedding, embedding_w_bday, topic_mk_id)
             VALUES ($1, $2, $3::vector, $4::vector, $5)
             RETURNING post_id",
            vec![
                user_id.into(),
                content.to_owned().into(),
                vector_literal(embedding).into(),
                vector_literal(embedding_w_bday).into(),
                topic_mk_id.map(str::to_owned).into(),
            ],
        ))
        .await?
        .ok_or_else(|| CadenzaError::DatabaseError("inserting a post returned no id".into()))?;
    Ok(row.try_get_by_index(0)?)
}

/// Deletes the author's post. `NotFound` when no row matches, including a post
/// owned by someone else. Comments, likes, and view status cascade from `posts`.
pub async fn delete_post(
    db: &DatabaseConnection,
    user_id: Uuid,
    post_id: i64,
) -> Result<(), CadenzaError> {
    let deleted = posts::Entity::delete_many()
        .filter(posts::Column::PostId.eq(post_id))
        .filter(posts::Column::UserId.eq(user_id))
        .exec(db)
        .await?;
    if deleted.rows_affected == 0 {
        return Err(CadenzaError::NotFound);
    }
    Ok(())
}

/// The author's post clocks. `created_at` keeps the age component of
/// `embedding_w_bday`. `edited_at` is the database time of the last edit, or
/// `None` when the text has never changed. `topic_mk_id` is set when the post
/// has a topic, so an edit can prefix the embedding. `None` for the whole
/// value when the post is missing or owned by someone else.
pub async fn author_post_clock(
    db: &DatabaseConnection,
    user_id: Uuid,
    post_id: i64,
) -> Result<Option<PostClock>, CadenzaError> {
    let row = PostClockRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT created_at, edited_at, topic_mk_id FROM posts WHERE post_id = $1 AND user_id = $2",
        vec![post_id.into(), user_id.into()],
    ))
    .one(db)
    .await?;
    Ok(row.map(|row| PostClock {
        created_at: row.created_at.with_timezone(&Utc),
        edited_at: row.edited_at.map(|edited_at| edited_at.with_timezone(&Utc)),
        topic_mk_id: row.topic_mk_id,
    }))
}

/// `created_at`, the database time of the last edit, and the stored topic id.
pub struct PostClock {
    pub created_at: DateTime<Utc>,
    pub edited_at: Option<DateTime<Utc>>,
    pub topic_mk_id: Option<String>,
}

/// True when the client's `incoming` time is the same instant or later than
/// the stored `edited_at`. A row that has never been edited takes the first one.
pub fn edit_replaces(stored: Option<DateTime<Utc>>, incoming: DateTime<Utc>) -> bool {
    stored.is_none_or(|stored| incoming >= stored)
}

/// Replaces the author's post text and embedding. `edited_at` is `now()`.
/// `client_time` older than the stored `edited_at` leaves the row alone.
/// `NotFound` when the post is missing or owned by someone else.
pub async fn update_post_text(
    db: &DatabaseConnection,
    user_id: Uuid,
    post_id: i64,
    content: &str,
    embedding: &[f64],
    embedding_w_bday: &[f64],
    client_time: DateTime<Utc>,
) -> Result<(), CadenzaError> {
    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE posts
             SET content = $3,
                 edited_at = now(),
                 embedding = $5::vector,
                 embedding_w_bday = $6::vector
             WHERE post_id = $1 AND user_id = $2
               AND (edited_at IS NULL OR edited_at <= $4)
             RETURNING post_id",
            vec![
                post_id.into(),
                user_id.into(),
                content.to_owned().into(),
                client_time.into(),
                vector_literal(embedding).into(),
                vector_literal(embedding_w_bday).into(),
            ],
        ))
        .await?;
    if row.is_some() {
        return Ok(());
    }
    finish_stale_edit(
        db,
        "SELECT post_id FROM posts WHERE post_id = $1 AND user_id = $2",
        vec![post_id.into(), user_id.into()],
    )
    .await
}

/// Records a like and bumps `likes` / `hot_score` only when the row is new.
pub async fn like_post(
    db: &DatabaseConnection,
    user_id: Uuid,
    post_id: i64,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;
    let inserted = post_likes::Entity::insert(post_likes::ActiveModel {
        post_id: Set(post_id),
        user_id: Set(user_id),
        date: NotSet,
    })
    .on_conflict(
        OnConflict::columns([post_likes::Column::PostId, post_likes::Column::UserId])
            .do_nothing()
            .to_owned(),
    )
    .exec_with_returning(&txn)
    .await;
    match inserted {
        Ok(_) => {}
        Err(DbErr::RecordNotInserted) => {
            txn.commit().await?;
            return Ok(());
        }
        Err(err) => return Err(err.into()),
    }
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE posts
         SET likes = likes + 1,
             hot_score = 10 * LOG(2, likes + 1) + (created_at::date - '1970-01-01'::date)
         WHERE post_id = $1",
        vec![post_id.into()],
    ))
    .await?;
    txn.commit().await?;
    Ok(())
}

/// Removes a like and drops `likes` / `hot_score` only when a row was deleted.
pub async fn unlike_post(
    db: &DatabaseConnection,
    user_id: Uuid,
    post_id: i64,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;
    let deleted = post_likes::Entity::delete_many()
        .filter(post_likes::Column::PostId.eq(post_id))
        .filter(post_likes::Column::UserId.eq(user_id))
        .exec_with_returning(&txn)
        .await?;
    if deleted.is_empty() {
        txn.commit().await?;
        return Ok(());
    }
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE posts
         SET likes = GREATEST(likes - 1, 0),
             hot_score = 10 * LOG(2, GREATEST(likes - 1, 1))
                 + (created_at::date - '1970-01-01'::date)
         WHERE post_id = $1",
        vec![post_id.into()],
    ))
    .await?;
    txn.commit().await?;
    Ok(())
}

/// The other person's username, or `"unknown"` when they have no profile.
async fn actor_username(db: &impl ConnectionTrait, user_id: Uuid) -> Result<String, CadenzaError> {
    let row = profile::Entity::find_by_id(user_id).one(db).await?;
    Ok(match row {
        Some(row) if !row.username.trim().is_empty() => row.username,
        _ => "unknown".to_owned(),
    })
}

/// A comment stores `post_id`. A friend request stores the sender and an
/// unanswered resolution.
fn notification_metadata(
    notif_type: NotificationType,
    sender_id: Uuid,
    post_id: Option<i64>,
) -> serde_json::Value {
    match notif_type {
        NotificationType::Comment => serde_json::json!({ "post_id": post_id }),
        NotificationType::FriendReqReceived | NotificationType::FriendReqAccepted => {
            serde_json::json!({
                "sender_id": sender_id,
                "resolution": null,
            })
        }
    }
}

/// One unread notification for `recipient_id`. A comment's title is
/// `<username> commented on your post` and its content is the comment. A
/// friend request's title is the other person's username. The same person
/// gets nothing, so a comment on your own post is quiet.
async fn notify_user(
    db: &impl ConnectionTrait,
    recipient_id: Uuid,
    sender_id: Uuid,
    content: &str,
    notif_type: NotificationType,
    post_id: Option<i64>,
) -> Result<(), CadenzaError> {
    if recipient_id == sender_id {
        return Ok(());
    }
    let username = actor_username(db, sender_id).await?;
    let title = match notif_type {
        NotificationType::Comment => format!("{username} commented on your post"),
        NotificationType::FriendReqReceived | NotificationType::FriendReqAccepted => username,
    };
    push_notification(
        db,
        NewNotification {
            user_id: recipient_id,
            title,
            content: content.to_owned(),
            notif_type,
            metadata: notification_metadata(notif_type, sender_id, post_id),
        },
    )
    .await?;
    Ok(())
}

/// Inserts a comment and returns its id. `NotFound` when the post is gone.
///
/// The post's author gets a `comment` notification, title
/// "<username> commented on your post" and content the comment, in this same
/// transaction. Metadata is `{"post_id"}`.
/// The author commenting on their own post gets none. A failed notification
/// rolls the comment back.
pub async fn insert_comment(
    db: &DatabaseConnection,
    user_id: Uuid,
    post_id: i64,
    content: &str,
) -> Result<i64, CadenzaError> {
    // `likes` and `created_at` stay unset so the database stamps them.
    // A missing post fails `comments_post_id_fkey`, which becomes `NotFound`.
    // `posts.comments` moves in the same transaction, so a failed insert
    // never bumps the count.
    let txn = db.begin().await?;
    let inserted = comments::Entity::insert(comments::ActiveModel {
        user_id: Set(user_id),
        post_id: Set(post_id),
        content: Set(content.to_owned()),
        likes: NotSet,
        created_at: NotSet,
        comment_id: NotSet,
        edited_at: NotSet,
    })
    .exec(&txn)
    .await;
    let comment_id = match inserted {
        Ok(row) => row.last_insert_id,
        Err(err) if is_missing_post(&err) => {
            txn.rollback().await?;
            return Err(CadenzaError::NotFound);
        }
        Err(err) => return Err(err.into()),
    };
    posts::Entity::update_many()
        .col_expr(
            posts::Column::Comments,
            Expr::col(posts::Column::Comments).add(1),
        )
        .filter(posts::Column::PostId.eq(post_id))
        .exec(&txn)
        .await?;
    let author = txn
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT user_id FROM posts WHERE post_id = $1",
            vec![post_id.into()],
        ))
        .await?;
    let Some(author) = author else {
        txn.rollback().await?;
        return Err(CadenzaError::NotFound);
    };
    let author_id: Uuid = author.try_get_by_index(0)?;
    if let Err(err) = notify_user(
        &txn,
        author_id,
        user_id,
        content,
        NotificationType::Comment,
        Some(post_id),
    )
    .await
    {
        txn.rollback().await?;
        return Err(err);
    }
    txn.commit().await?;
    Ok(comment_id)
}

/// Deletes the author's comment and drops `posts.comments`. `NotFound` when
/// no row matches, including a comment owned by someone else. Comment likes
/// cascade from `comments`.
pub async fn delete_comment(
    db: &DatabaseConnection,
    user_id: Uuid,
    comment_id: i64,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;
    let deleted = comments::Entity::delete_many()
        .filter(comments::Column::CommentId.eq(comment_id))
        .filter(comments::Column::UserId.eq(user_id))
        .exec_with_returning(&txn)
        .await?;
    let Some(comment) = deleted.first() else {
        txn.rollback().await?;
        return Err(CadenzaError::NotFound);
    };
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE posts
         SET comments = GREATEST(comments - 1, 0)
         WHERE post_id = $1",
        vec![comment.post_id.into()],
    ))
    .await?;
    txn.commit().await?;
    Ok(())
}

/// Replaces the author's comment text. `edited_at` is `now()`. `client_time`
/// older than the stored `edited_at` leaves the row alone. `NotFound` when
/// the comment is missing or owned by someone else.
pub async fn update_comment_text(
    db: &DatabaseConnection,
    user_id: Uuid,
    comment_id: i64,
    content: &str,
    client_time: DateTime<Utc>,
) -> Result<(), CadenzaError> {
    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE comments
             SET content = $3,
                 edited_at = now()
             WHERE comment_id = $1 AND user_id = $2
               AND (edited_at IS NULL OR edited_at <= $4)
             RETURNING comment_id",
            vec![
                comment_id.into(),
                user_id.into(),
                content.to_owned().into(),
                client_time.into(),
            ],
        ))
        .await?;
    if row.is_some() {
        return Ok(());
    }
    finish_stale_edit(
        db,
        "SELECT comment_id FROM comments WHERE comment_id = $1 AND user_id = $2",
        vec![comment_id.into(), user_id.into()],
    )
    .await
}

/// The update matched nothing. The row is still there when a newer edit won,
/// which is success. A missing row is `NotFound`.
async fn finish_stale_edit(
    db: &DatabaseConnection,
    sql: &str,
    values: Vec<Value>,
) -> Result<(), CadenzaError> {
    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            values,
        ))
        .await?;
    if row.is_none() {
        return Err(CadenzaError::NotFound);
    }
    Ok(())
}

/// Where the next comments page starts. The columns are the sort key, in order.
#[derive(Clone, Debug)]
pub struct CommentsCursor {
    pub likes: i64,
    pub created_at: DateTime<Utc>,
    pub comment_id: i64,
}

/// One page of comments, plus the cursor for the following page when this one is full.
pub struct CommentPage {
    pub comments: Vec<SocialComment>,
    pub next: Option<CommentsCursor>,
}

/// Comments on `post_id`, at most [`COMMENT_PAGE_LIMIT`], most liked first.
///
/// Order is `likes` desc, `created_at` desc, `comment_id` desc. `created_at` is
/// not unique, so `comment_id` finishes the order and the cursor. `cursor` is
/// `None` for the first page. Later pages pass the previous `next`.
pub async fn get_post_comments(
    db: &DatabaseConnection,
    viewer_id: Uuid,
    post_id: i64,
    cursor: Option<CommentsCursor>,
) -> Result<CommentPage, CadenzaError> {
    let rows = comments_page(viewer_id, post_id, cursor)
        .into_model::<CommentRow>()
        .all(db)
        .await?;
    let next = (rows.len() as u64 == COMMENT_PAGE_LIMIT)
        .then(|| rows.last())
        .flatten()
        .map(|row| CommentsCursor {
            likes: row.likes,
            created_at: row.created_at.with_timezone(&Utc),
            comment_id: row.comment_id,
        });
    Ok(CommentPage {
        comments: rows.iter().map(CommentRow::to_comment).collect(),
        next,
    })
}

/// [`comments_on_post`] plus the page size, and the cursor filter when there is one.
fn comments_page(
    viewer_id: Uuid,
    post_id: i64,
    cursor: Option<CommentsCursor>,
) -> sea_orm::Select<comments::Entity> {
    let mut query = comments_on_post(viewer_id, post_id);
    if let Some(cursor) = cursor {
        let created_at = cursor.created_at.fixed_offset();
        query = query.filter(
            Condition::any()
                .add(comments::Column::Likes.lt(cursor.likes))
                .add(
                    Condition::all()
                        .add(comments::Column::Likes.eq(cursor.likes))
                        .add(comments::Column::CreatedAt.lt(created_at)),
                )
                .add(
                    Condition::all()
                        .add(comments::Column::Likes.eq(cursor.likes))
                        .add(comments::Column::CreatedAt.eq(created_at))
                        .add(comments::Column::CommentId.lt(cursor.comment_id)),
                ),
        );
    }
    query.limit(COMMENT_PAGE_LIMIT)
}

/// The select behind [`get_post_comments`]. A missing profile becomes
/// `"unknown"`. `liked` is whether `viewer_id` has a `comment_likes` row.
fn comments_on_post(viewer_id: Uuid, post_id: i64) -> sea_orm::Select<comments::Entity> {
    let liked = comment_likes::Entity::find()
        .select_only()
        .column(comment_likes::Column::CommentId)
        .filter(
            Expr::col((comment_likes::Entity, comment_likes::Column::CommentId))
                .eq(Expr::col((comments::Entity, comments::Column::CommentId))),
        )
        .filter(comment_likes::Column::UserId.eq(viewer_id))
        .into_query();

    comments::Entity::find()
        .select_only()
        .column(comments::Column::CommentId)
        .column(comments::Column::PostId)
        .column_as(comments::Column::UserId, "author_id")
        .column(comments::Column::Content)
        .column(comments::Column::Likes)
        .column(comments::Column::CreatedAt)
        .column(comments::Column::EditedAt)
        .expr_as(
            Func::coalesce([
                Expr::col((profile::Entity, profile::Column::Username)),
                Expr::val("unknown"),
            ]),
            "username",
        )
        .expr_as(Expr::exists(liked), "liked")
        .filter(comments::Column::PostId.eq(post_id))
        .join(
            JoinType::LeftJoin,
            comments::Entity::belongs_to(profile::Entity)
                .from(comments::Column::UserId)
                .to(profile::Column::Uid)
                .into(),
        )
        .order_by_desc(comments::Column::Likes)
        .order_by_desc(comments::Column::CreatedAt)
        // ties, like two comments posted together, still come back in one order
        .order_by_desc(comments::Column::CommentId)
}

/// Records a comment like and bumps `likes` only when the row is new.
pub async fn like_comment(
    db: &DatabaseConnection,
    user_id: Uuid,
    comment_id: i64,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;
    let inserted = comment_likes::Entity::insert(comment_likes::ActiveModel {
        comment_id: Set(comment_id),
        user_id: Set(user_id),
        date: NotSet,
    })
    .on_conflict(
        OnConflict::columns([
            comment_likes::Column::CommentId,
            comment_likes::Column::UserId,
        ])
        .do_nothing()
        .to_owned(),
    )
    .exec_with_returning(&txn)
    .await;
    match inserted {
        Ok(_) => {}
        Err(DbErr::RecordNotInserted) => {
            txn.commit().await?;
            return Ok(());
        }
        Err(err) => return Err(err.into()),
    }
    comments::Entity::update_many()
        .col_expr(
            comments::Column::Likes,
            Expr::col(comments::Column::Likes).add(1),
        )
        .filter(comments::Column::CommentId.eq(comment_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

/// Removes a comment like and drops `likes` only when a row was deleted.
pub async fn unlike_comment(
    db: &DatabaseConnection,
    user_id: Uuid,
    comment_id: i64,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;
    let deleted = comment_likes::Entity::delete_many()
        .filter(comment_likes::Column::CommentId.eq(comment_id))
        .filter(comment_likes::Column::UserId.eq(user_id))
        .exec_with_returning(&txn)
        .await?;
    if deleted.is_empty() {
        txn.commit().await?;
        return Ok(());
    }
    comments::Entity::update_many()
        .col_expr(
            comments::Column::Likes,
            Func::greatest([Expr::col(comments::Column::Likes).sub(1), Expr::value(0)]).into(),
        )
        .filter(comments::Column::CommentId.eq(comment_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

/// Inserts `loaded` for ids that have no row yet. Never downgrades `viewed`.
pub async fn mark_posts_loaded(
    db: &DatabaseConnection,
    user_id: Uuid,
    post_ids: &[i64],
) -> Result<(), CadenzaError> {
    if post_ids.is_empty() {
        return Ok(());
    }
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO post_view_status (post_id, user_id, status)
         SELECT post_id, $1, 'loaded'
         FROM unnest($2::bigint[]) AS post_id
         ON CONFLICT (post_id, user_id) DO NOTHING",
        vec![user_id.into(), bigint_array(post_ids)],
    ))
    .await?;
    Ok(())
}

/// Sets `viewed`, inserting or upgrading from `loaded`.
pub async fn mark_posts_viewed(
    db: &DatabaseConnection,
    user_id: Uuid,
    post_ids: &[i64],
) -> Result<(), CadenzaError> {
    if post_ids.is_empty() {
        return Ok(());
    }
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO post_view_status (post_id, user_id, status)
         SELECT post_id, $1, 'viewed'
         FROM unnest($2::bigint[]) AS post_id
         ON CONFLICT (post_id, user_id) DO UPDATE
         SET status = 'viewed',
             date = now()",
        vec![user_id.into(), bigint_array(post_ids)],
    ))
    .await?;
    Ok(())
}

/// Display fields for `post_ids`, in that order. Missing ids are skipped.
pub async fn get_posts(
    db: &DatabaseConnection,
    viewer_id: Uuid,
    post_ids: &[i64],
) -> Result<Vec<SocialPost>, CadenzaError> {
    if post_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = PostRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        format!(
            "SELECT
             p.post_id,
             p.user_id AS author_id,
             p.content,
             p.likes,
             p.created_at,
             p.edited_at,
             p.topic_mk_id,
             COALESCE(pr.username, 'unknown') AS username,
             EXISTS (
                 SELECT 1 FROM post_likes
                 WHERE post_likes.post_id = p.post_id
                   AND post_likes.user_id = $1
             ) AS liked,
             p.comments AS comment_count
         FROM posts p
         LEFT JOIN profile pr ON pr.uid = p.user_id
         WHERE p.post_id = ANY($2::bigint[])
           AND {NOT_BLOCKED_AUTHOR}"
        ),
        vec![viewer_id.into(), bigint_array(post_ids)],
    ))
    .all(db)
    .await?;

    let by_id: HashMap<i64, PostRow> = rows.into_iter().map(|row| (row.post_id, row)).collect();
    let mut posts = Vec::new();
    for post_id in post_ids {
        if let Some(row) = by_id.get(post_id) {
            posts.push(row.to_post());
        }
    }
    Ok(posts)
}

/// The author's profile row, when they have one.
///
/// `friend_count` is completed friendships only. In `friendships`, `user1` is
/// always the lexicographically smaller uuid, so the same person can be stored
/// in either column.
pub async fn find_public_profile(
    db: &DatabaseConnection,
    author_id: Uuid,
) -> Result<Option<PublicProfile>, CadenzaError> {
    let row = ProfileRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT
             uid,
             username,
             bio,
             (
                 SELECT COUNT(*)::bigint
                 FROM friendships
                 WHERE status = 'complete'
                   AND (user1 = profile.uid OR user2 = profile.uid)
             ) AS friend_count
         FROM profile
         WHERE uid = $1",
        vec![author_id.into()],
    ))
    .one(db)
    .await?;

    Ok(row.map(|row| PublicProfile {
        user_id: row.uid,
        username: row.username,
        bio: row.bio,
        friend_count: row.friend_count,
        friend_request_sent: false,
        friend_request_received: false,
        is_friend: false,
        is_favorite: false,
        blocked: false,
    }))
}

/// `user1` is the lexicographically smaller uuid.
fn ordered_friend_users(a: Uuid, b: Uuid) -> (Uuid, Uuid) {
    if a < b { (a, b) } else { (b, a) }
}

/// Pending status for a request whose recipient is `recipient_id`.
/// `to_user1` and `to_user2` name the recipient. `user1` is the smaller uuid.
fn friend_request_status(recipient_id: Uuid, user1: Uuid) -> &'static str {
    if recipient_id == user1 {
        "to_user1"
    } else {
        "to_user2"
    }
}

/// Whether `sender_id` has a pending request to `recipient_id`.
pub async fn friend_request_sent(
    db: &DatabaseConnection,
    sender_id: Uuid,
    recipient_id: Uuid,
) -> Result<bool, CadenzaError> {
    if sender_id == recipient_id {
        return Ok(false);
    }
    let (user1, user2) = ordered_friend_users(sender_id, recipient_id);
    let status = friend_request_status(recipient_id, user1);
    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT EXISTS (
                 SELECT 1 FROM friendships
                 WHERE user1 = $1 AND user2 = $2 AND status = $3::friendship_status
             )",
            vec![user1.into(), user2.into(), status.into()],
        ))
        .await?;
    let Some(row) = row else {
        return Ok(false);
    };
    Ok(row.try_get_by_index(0)?)
}

/// Whether `viewer_id` and `other_id` have a completed friendship.
/// The same user is never their own friend.
pub async fn is_friend(
    db: &impl ConnectionTrait,
    viewer_id: Uuid,
    other_id: Uuid,
) -> Result<bool, CadenzaError> {
    if viewer_id == other_id {
        return Ok(false);
    }
    let (user1, user2) = ordered_friend_users(viewer_id, other_id);
    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT EXISTS (
                 SELECT 1 FROM friendships
                 WHERE user1 = $1 AND user2 = $2 AND status = 'complete'
             )",
            vec![user1.into(), user2.into()],
        ))
        .await?;
    let Some(row) = row else {
        return Ok(false);
    };
    Ok(row.try_get_by_index(0)?)
}

/// Inserts a pending request from `sender_id` to `recipient_id`.
///
/// `user1` is the lexicographically smaller uuid. Status is `to_user1` when
/// the recipient is `user1`, and `to_user2` when they are `user2`. Sending the
/// same request again is a no-op and sends nothing. A new request notifies
/// `recipient_id`: `friend_req_received`, title the sender's username, content
/// "sent you a friend request", in the same transaction as the insert. If the other
/// person already sent a request, this accepts it and the row becomes
/// `complete`, which notifies them that it was accepted. A completed
/// friendship is [`CadenzaError::FriendshipAlreadyExists`], and a block
/// either way is [`CadenzaError::UserBlocked`].
pub async fn request_friendship(
    db: &DatabaseConnection,
    sender_id: Uuid,
    recipient_id: Uuid,
) -> Result<(), CadenzaError> {
    if sender_id == recipient_id {
        return Err(CadenzaError::InvalidRequestBody(
            "you cannot send yourself a friend request".into(),
        ));
    }
    if blocked_either_way(db, sender_id, recipient_id).await? {
        return Err(CadenzaError::UserBlocked);
    }
    let (user1, user2) = ordered_friend_users(sender_id, recipient_id);
    let status = friend_request_status(recipient_id, user1);
    let incoming = friend_request_status(sender_id, user1);
    let txn = db.begin().await?;
    let inserted = txn
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO friendships (created_at, user1, user2, status)
             VALUES (NOW(), $1, $2, $3::friendship_status)
             ON CONFLICT (user1, user2) DO NOTHING
             RETURNING user1",
            vec![user1.into(), user2.into(), status.into()],
        ))
        .await?;
    if inserted.is_some() {
        if let Err(err) = notify_user(
            &txn,
            recipient_id,
            sender_id,
            FRIEND_REQUEST_RECEIVED,
            NotificationType::FriendReqReceived,
            None,
        )
        .await
        {
            txn.rollback().await?;
            return Err(err);
        }
        txn.commit().await?;
        return Ok(());
    }
    // The conflicting row is locked until this transaction ends. Release it
    // before the follow-up read, and before accept, which updates that row.
    txn.rollback().await?;
    let existing = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT status::text FROM friendships WHERE user1 = $1 AND user2 = $2",
            vec![user1.into(), user2.into()],
        ))
        .await?;
    let Some(existing) = existing else {
        return Err(CadenzaError::DatabaseError(
            "friendship conflict left no row".into(),
        ));
    };
    let current: String = existing.try_get_by_index(0)?;
    if current == status {
        Ok(())
    } else if current == incoming {
        accept_friendship(db, sender_id, recipient_id).await
    } else {
        Err(CadenzaError::FriendshipAlreadyExists)
    }
}

/// Deletes the friendship row for this pair, whatever its status is, and
/// both favorites. A missing row is a no-op. `user1` is the lexicographically smaller uuid.
///
/// Ignoring an incoming request also marks that person's "sent you a friend
/// request" notification `ignored`.
pub async fn delete_friendship(
    db: &DatabaseConnection,
    user_id: Uuid,
    other_id: Uuid,
) -> Result<(), CadenzaError> {
    if user_id == other_id {
        return Err(CadenzaError::InvalidRequestBody(
            "you cannot cancel a friend request with yourself".into(),
        ));
    }
    let (user1, user2) = ordered_friend_users(user_id, other_id);
    let incoming = friend_request_status(user_id, user1);
    let txn = db.begin().await?;
    let existing = txn
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT status::text FROM friendships WHERE user1 = $1 AND user2 = $2",
            vec![user1.into(), user2.into()],
        ))
        .await?;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "DELETE FROM friendships WHERE user1 = $1 AND user2 = $2",
        vec![user1.into(), user2.into()],
    ))
    .await?;
    if let Some(existing) = existing {
        let status: String = existing.try_get_by_index(0)?;
        if status == incoming {
            resolve_friend_request_notification(&txn, user_id, other_id, "ignored").await?;
        }
    }
    clear_favorites_between(&txn, user_id, other_id).await?;
    txn.commit().await?;
    Ok(())
}

/// Marks unanswered "sent you a friend request" rows from `actor_id` to
/// `recipient_id`. Rows that already have a resolution stay as they are.
async fn resolve_friend_request_notification(
    db: &impl ConnectionTrait,
    recipient_id: Uuid,
    actor_id: Uuid,
    resolution: &str,
) -> Result<(), CadenzaError> {
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE notifications
         SET metadata = jsonb_set(metadata, '{resolution}', to_jsonb($3::text), true)
         WHERE user_id = $1
           AND \"type\" = 'friend_req_received'
           AND metadata->>'sender_id' = $2::text
           AND metadata->>'resolution' IS NULL",
        vec![recipient_id.into(), actor_id.into(), resolution.into()],
    ))
    .await?;
    Ok(())
}

/// Turns an incoming request into a completed friendship.
///
/// The caller has to be the recipient: `to_user1` when they are `user1`, or
/// `to_user2` when they are `user2`. `user1` is the lexicographically smaller
/// uuid. Anything else, including a missing row, is [`CadenzaError::NotFound`].
///
/// The original sender gets a `friend_req_accepted` notification, title the accepter's
/// username and content "accepted your friend request", in the same
/// transaction as the update. Their "sent you a friend request" notification
/// is marked `accepted` in that transaction too.
pub async fn accept_friendship(
    db: &DatabaseConnection,
    user_id: Uuid,
    other_id: Uuid,
) -> Result<(), CadenzaError> {
    if user_id == other_id {
        return Err(CadenzaError::InvalidRequestBody(
            "you cannot accept a friend request from yourself".into(),
        ));
    }
    let (user1, user2) = ordered_friend_users(user_id, other_id);
    let status = friend_request_status(user_id, user1);
    let txn = db.begin().await?;
    let updated = txn
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE friendships
             SET status = 'complete'
             WHERE user1 = $1 AND user2 = $2 AND status = $3::friendship_status
             RETURNING user1",
            vec![user1.into(), user2.into(), status.into()],
        ))
        .await?;
    if updated.is_none() {
        txn.rollback().await?;
        return Err(CadenzaError::NotFound);
    }
    if let Err(err) = notify_user(
        &txn,
        other_id,
        user_id,
        "accepted your friend request",
        NotificationType::FriendReqAccepted,
        None,
    )
    .await
    {
        txn.rollback().await?;
        return Err(err);
    }
    resolve_friend_request_notification(&txn, user_id, other_id, "accepted").await?;
    txn.commit().await?;
    Ok(())
}

/// One other person on a friendship row.
#[derive(Clone, Debug)]
pub struct FriendPerson {
    pub user_id: Uuid,
    pub username: String,
}

/// The signed-in user's completed friends and both directions of pending
/// requests.
///
/// `user1` is the lexicographically smaller uuid. `to_user2` on a row where
/// the caller is `user1`, or `to_user1` where they are `user2`, is a request
/// they sent. The other pending status is incoming. All three lists are
/// username order.
pub struct FriendLists {
    pub incoming: Vec<FriendPerson>,
    pub outgoing: Vec<FriendPerson>,
    pub friends: Vec<FriendPerson>,
}

/// Completed friends and pending requests for `user_id`.
pub async fn list_friendships(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> Result<FriendLists, CadenzaError> {
    let rows = FriendshipListRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT
             CASE WHEN f.user1 = $1 THEN f.user2 ELSE f.user1 END AS user_id,
             COALESCE(pr.username, 'unknown') AS username,
             CASE
                 WHEN f.status = 'complete' THEN 'friend'
                 WHEN (f.user1 = $1 AND f.status = 'to_user2')
                   OR (f.user2 = $1 AND f.status = 'to_user1') THEN 'outgoing'
                 ELSE 'incoming'
             END AS kind
         FROM friendships f
         LEFT JOIN profile pr
           ON pr.uid = CASE WHEN f.user1 = $1 THEN f.user2 ELSE f.user1 END
         WHERE f.user1 = $1 OR f.user2 = $1
         ORDER BY username, user_id",
        vec![user_id.into()],
    ))
    .all(db)
    .await?;

    let mut lists = FriendLists {
        incoming: Vec::new(),
        outgoing: Vec::new(),
        friends: Vec::new(),
    };
    for row in rows {
        let person = FriendPerson {
            user_id: row.user_id,
            username: row.username,
        };
        match row.kind.as_str() {
            "outgoing" => lists.outgoing.push(person),
            "friend" => lists.friends.push(person),
            "incoming" => lists.incoming.push(person),
            _ => {}
        }
    }
    Ok(lists)
}

/// `%term%` for a case-insensitive contains match. `%`, `_`, and `\` in the
/// term are escaped so they match themselves.
fn like_contains_pattern(term: &str) -> String {
    let mut pattern = String::with_capacity(term.len() + 2);
    pattern.push('%');
    for ch in term.chars() {
        if matches!(ch, '%' | '_' | '\\') {
            pattern.push('\\');
        }
        pattern.push(ch);
    }
    pattern.push('%');
    pattern
}

const USER_SEARCH_SQL: &str = "\
SELECT
    pr.uid AS user_id,
    pr.username,
    EXISTS (
        SELECT 1 FROM friendships f
        WHERE f.status = 'complete'
          AND f.user1 = LEAST($1, pr.uid)
          AND f.user2 = GREATEST($1, pr.uid)
    ) AS is_friend
FROM profile pr
WHERE pr.uid <> $1
  AND lower(pr.username) LIKE lower($2) ESCAPE '\\'
ORDER BY pr.username, pr.uid
LIMIT $3";

/// The statement [`search_users`] runs. `None` when the trimmed search is
/// empty, so a blank box does not hit the database.
fn user_search_statement(viewer_id: Uuid, search: &str, limit: u64) -> Option<Statement> {
    let term = search.trim();
    if term.is_empty() {
        return None;
    }
    Some(Statement::from_sql_and_values(
        DbBackend::Postgres,
        USER_SEARCH_SQL,
        vec![
            viewer_id.into(),
            like_contains_pattern(term).into(),
            (limit as i64).into(),
        ],
    ))
}

/// One person from a username search.
pub struct UserSearchHit {
    pub user_id: Uuid,
    pub username: String,
    /// The caller and this person have a completed friendship.
    pub is_friend: bool,
}

/// People whose username contains `search`, other than `viewer_id`.
///
/// Case insensitive. A blank or whitespace-only search returns no one.
/// `limit` is the caller's cap. Username order, then user id.
/// `is_friend` is true only for a `complete` friendship, not a pending request.
/// `sql/profile_username_search.sql` is the index this uses.
pub async fn search_users(
    db: &DatabaseConnection,
    viewer_id: Uuid,
    search: &str,
    limit: u64,
) -> Result<Vec<UserSearchHit>, CadenzaError> {
    let Some(statement) = user_search_statement(viewer_id, search, limit) else {
        return Ok(Vec::new());
    };
    let rows = UserSearchRow::find_by_statement(statement).all(db).await?;
    Ok(rows
        .into_iter()
        .map(|row| UserSearchHit {
            user_id: row.user_id,
            username: row.username,
            is_friend: row.is_friend,
        })
        .collect())
}

/// Where the next topic-posts page starts. The columns are the sort key, in order.
#[derive(Clone, Debug)]
pub struct TopicPostsCursor {
    pub likes: i64,
    pub created_at: DateTime<Utc>,
    pub post_id: i64,
}

/// One page of topic posts, plus the cursor for the following page when this one is full.
pub struct TopicPostPage {
    pub posts: Vec<SocialPost>,
    pub next: Option<TopicPostsCursor>,
}

/// Posts whose topic is this Apple Music catalog id, at most [`TOPIC_POST_LIMIT`].
///
/// Order is `likes` desc, `created_at` desc, `post_id` desc. `created_at` is
/// not unique, so `post_id` finishes the order and the cursor. `cursor` is
/// `None` for the first page. Later pages pass the previous `next`.
pub async fn get_topic_posts(
    db: &DatabaseConnection,
    viewer_id: Uuid,
    topic_mk_id: &str,
    cursor: Option<TopicPostsCursor>,
) -> Result<TopicPostPage, CadenzaError> {
    let rows = PostRow::find_by_statement(topic_posts_statement(viewer_id, topic_mk_id, cursor))
        .all(db)
        .await?;
    let next = (rows.len() as i64 == TOPIC_POST_LIMIT)
        .then(|| rows.last())
        .flatten()
        .map(|row| TopicPostsCursor {
            likes: row.likes,
            created_at: row.created_at.with_timezone(&Utc),
            post_id: row.post_id,
        });
    Ok(TopicPostPage {
        posts: rows.iter().map(PostRow::to_post).collect(),
        next,
    })
}

const TOPIC_POSTS_SELECT: &str = "SELECT
             p.post_id,
             p.user_id AS author_id,
             p.content,
             p.likes,
             p.created_at,
             p.edited_at,
             p.topic_mk_id,
             COALESCE(pr.username, 'unknown') AS username,
             EXISTS (
                 SELECT 1 FROM post_likes
                 WHERE post_likes.post_id = p.post_id
                   AND post_likes.user_id = $1
             ) AS liked,
             p.comments AS comment_count
         FROM posts p
         LEFT JOIN profile pr ON pr.uid = p.user_id";

/// The statement behind [`get_topic_posts`]. All three sort columns are descending,
/// so a row comparison `<` is the rows that sort after the cursor.
fn topic_posts_statement(
    viewer_id: Uuid,
    topic_mk_id: &str,
    cursor: Option<TopicPostsCursor>,
) -> Statement {
    match cursor {
        None => Statement::from_sql_and_values(
            DbBackend::Postgres,
            format!(
                "{TOPIC_POSTS_SELECT}
                 WHERE p.topic_mk_id = $2
                   AND {NOT_BLOCKED_AUTHOR}
                 ORDER BY p.likes DESC, p.created_at DESC, p.post_id DESC
                 LIMIT $3"
            ),
            vec![
                viewer_id.into(),
                topic_mk_id.into(),
                TOPIC_POST_LIMIT.into(),
            ],
        ),
        Some(cursor) => Statement::from_sql_and_values(
            DbBackend::Postgres,
            format!(
                "{TOPIC_POSTS_SELECT}
                 WHERE p.topic_mk_id = $2
                   AND {NOT_BLOCKED_AUTHOR}
                   AND (p.likes, p.created_at, p.post_id) < ($3, $4, $5)
                 ORDER BY p.likes DESC, p.created_at DESC, p.post_id DESC
                 LIMIT $6"
            ),
            vec![
                viewer_id.into(),
                topic_mk_id.into(),
                cursor.likes.into(),
                cursor.created_at.into(),
                cursor.post_id.into(),
                TOPIC_POST_LIMIT.into(),
            ],
        ),
    }
}

/// Posts in the friends feed per page.
pub const FRIENDS_FEED_SIZE: i64 = 20;

/// Posts by `viewer_id`'s completed friends and their own, newest first,
/// older than `before` when given. A page of [`FRIENDS_FEED_SIZE`]; a shorter
/// page is the end. Read only: nothing is marked loaded or viewed.
pub async fn get_friends_feed(
    db: &DatabaseConnection,
    viewer_id: Uuid,
    before: Option<DateTime<Utc>>,
) -> Result<Vec<SocialPost>, CadenzaError> {
    let rows = PostRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        format!(
            "SELECT
             p.post_id,
             p.user_id AS author_id,
             p.content,
             p.likes,
             p.created_at,
             p.edited_at,
             p.topic_mk_id,
             COALESCE(pr.username, 'unknown') AS username,
             EXISTS (
                 SELECT 1 FROM post_likes
                 WHERE post_likes.post_id = p.post_id
                   AND post_likes.user_id = $1
             ) AS liked,
             p.comments AS comment_count
         FROM posts p
         LEFT JOIN profile pr ON pr.uid = p.user_id
         WHERE (
             p.user_id = $1
             OR EXISTS (
                 SELECT 1 FROM friendships f
                 WHERE f.status = 'complete'
                   AND f.user1 = LEAST(p.user_id, $1)
                   AND f.user2 = GREATEST(p.user_id, $1)
             )
         )
           AND ($2::timestamptz IS NULL OR p.created_at < $2)
           AND {NOT_BLOCKED_AUTHOR}
         ORDER BY p.created_at DESC, p.post_id DESC
         LIMIT $3"
        ),
        vec![
            viewer_id.into(),
            before.map(|at| at.fixed_offset()).into(),
            FRIENDS_FEED_SIZE.into(),
        ],
    ))
    .all(db)
    .await?;
    Ok(rows.iter().map(PostRow::to_post).collect())
}

/// One author's posts, newest first.
pub async fn get_author_posts(
    db: &DatabaseConnection,
    viewer_id: Uuid,
    author_id: Uuid,
) -> Result<Vec<SocialPost>, CadenzaError> {
    let rows = PostRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        format!(
            "SELECT
             p.post_id,
             p.user_id AS author_id,
             p.content,
             p.likes,
             p.created_at,
             p.edited_at,
             p.topic_mk_id,
             COALESCE(pr.username, 'unknown') AS username,
             EXISTS (
                 SELECT 1 FROM post_likes
                 WHERE post_likes.post_id = p.post_id
                   AND post_likes.user_id = $1
             ) AS liked,
             p.comments AS comment_count
         FROM posts p
         LEFT JOIN profile pr ON pr.uid = p.user_id
         WHERE p.user_id = $2
           AND {NOT_BLOCKED_AUTHOR}
         ORDER BY p.created_at DESC"
        ),
        vec![viewer_id.into(), author_id.into()],
    ))
    .all(db)
    .await?;
    Ok(rows.iter().map(PostRow::to_post).collect())
}

/// Normalized weighted sum of the top 10 genres and top 10 artists.
/// `Ok(None)` when the user has nothing to sum.
pub async fn user_vector(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> Result<Option<Vec<f64>>, CadenzaError> {
    let rows = InterestRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "(
             SELECT i.embedding::text AS embedding, s.score
             FROM interests i
             JOIN interest_scores s ON s.interest_id = i.interest_id
             WHERE s.user_id = $1
               AND i.embedding IS NOT NULL
               AND i.interest_type = 'genre'
               AND s.score != 0
             ORDER BY s.score DESC
             LIMIT 10
         )
         UNION ALL
         (
             SELECT i.embedding::text AS embedding, s.score
             FROM interests i
             JOIN interest_scores s ON s.interest_id = i.interest_id
             WHERE s.user_id = $1
               AND i.embedding IS NOT NULL
               AND i.interest_type = 'artist'
               AND s.score != 0
             ORDER BY s.score DESC
             LIMIT 10
         )",
        vec![user_id.into()],
    ))
    .all(db)
    .await?;

    let mut interests = Vec::with_capacity(rows.len());
    for row in &rows {
        interests.push((parse_vector(&row.embedding)?, row.score));
    }
    Ok(combine_interest_vectors(&interests))
}

/// Posts nearest the age-adjusted user vector, after `exclude`.
pub async fn similar_and_recent_posts(
    db: &DatabaseConnection,
    user_id: Uuid,
    exclude: FeedExclude,
    user_vector: Option<&[f64]>,
) -> Result<Vec<FeedCandidate>, CadenzaError> {
    let Some(user_vector) = user_vector else {
        return Ok(Vec::new());
    };
    let mut aged = Vec::with_capacity(user_vector.len() + 1);
    aged.push(AGE_MULTIPLIER);
    aged.extend_from_slice(user_vector);
    candidate_posts(
        db,
        user_id,
        exclude,
        "ORDER BY embedding_w_bday <#> $VEC::vector",
        Some(vector_literal(&aged)),
    )
    .await
}

/// Globally hot posts, after `exclude`.
pub async fn hot_posts(
    db: &DatabaseConnection,
    user_id: Uuid,
    exclude: FeedExclude,
) -> Result<Vec<FeedCandidate>, CadenzaError> {
    candidate_posts(db, user_id, exclude, "ORDER BY hot_score DESC", None).await
}

/// `FEED_SIZE` posts by completed friends, after `exclude`. Newest first.
pub async fn friend_posts(
    db: &DatabaseConnection,
    user_id: Uuid,
    exclude: FeedExclude,
) -> Result<Vec<FeedCandidate>, CadenzaError> {
    let exclude_and = match exclude {
        FeedExclude::None => "",
        FeedExclude::Viewed => {
            "AND NOT EXISTS (
                 SELECT 1 FROM post_view_status
                 WHERE post_view_status.post_id = posts.post_id
                   AND post_view_status.user_id = $1
                   AND post_view_status.status = 'viewed'
             )"
        }
        FeedExclude::Loaded => {
            "AND NOT EXISTS (
                 SELECT 1 FROM post_view_status
                 WHERE post_view_status.post_id = posts.post_id
                   AND post_view_status.user_id = $1
             )"
        }
    };
    let sql = format!(
        "SELECT post_id, embedding::text AS embedding, likes, created_at
         FROM posts
         WHERE user_id IN (
             SELECT CASE WHEN f.user1 = $1 THEN f.user2 ELSE f.user1 END
             FROM friendships f
             WHERE f.status = 'complete'
               AND (f.user1 = $1 OR f.user2 = $1)
         )
         {exclude_and}
         ORDER BY created_at DESC
         LIMIT $2"
    );
    let rows = CandidateRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        vec![user_id.into(), FEED_SIZE.into()],
    ))
    .all(db)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(FeedCandidate {
                post_id: row.post_id,
                embedding: parse_vector(&row.embedding)?,
                likes: row.likes,
                created_at: row.created_at.with_timezone(&Utc),
                sent_by_friend: true,
            })
        })
        .collect()
}

/// Dedupes by `post_id`. A friend-sourced copy keeps `sent_by_friend`.
pub fn merge_feed_candidates(
    sources: impl IntoIterator<Item = FeedCandidate>,
) -> Vec<FeedCandidate> {
    let mut by_id: HashMap<i64, FeedCandidate> = HashMap::new();
    for post in sources {
        match by_id.get_mut(&post.post_id) {
            Some(existing) => {
                if post.sent_by_friend {
                    existing.sent_by_friend = true;
                }
            }
            None => {
                by_id.insert(post.post_id, post);
            }
        }
    }
    by_id.into_values().collect()
}

/// Ensures each interest exists. Returns whether it already had an embedding.
pub async fn upsert_interests(
    db: &DatabaseConnection,
    deltas: &[InterestDelta],
) -> Result<Vec<UpsertedInterest>, CadenzaError> {
    if deltas.is_empty() {
        return Ok(Vec::new());
    }
    let names: Vec<String> = deltas.iter().map(|d| d.name.clone()).collect();
    let types: Vec<String> = deltas.iter().map(|d| d.interest_type.clone()).collect();
    Ok(
        UpsertedInterest::find_by_statement(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO interests (name, interest_type)
         SELECT name, itype::interest
         FROM unnest($1::text[], $2::text[]) AS t(name, itype)
         ON CONFLICT (name, interest_type) DO UPDATE SET name = EXCLUDED.name
         RETURNING interest_id, name, interest_type::text AS interest_type,
                   (embedding IS NOT NULL) AS embedding_exists",
            vec![text_array(&names), text_array(&types)],
        ))
        .all(db)
        .await?,
    )
}

/// Writes model vectors onto interests that did not have one.
pub async fn set_interest_embeddings(
    db: &DatabaseConnection,
    interest_ids: &[i64],
    embeddings: &[Vec<f64>],
) -> Result<(), CadenzaError> {
    if interest_ids.len() != embeddings.len() {
        return Err(CadenzaError::SocialFeedErr(
            "interest embedding count did not match".into(),
        ));
    }
    if interest_ids.is_empty() {
        return Ok(());
    }
    let literals: Vec<String> = embeddings.iter().map(|v| vector_literal(v)).collect();
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE interests AS i
         SET embedding = v.embedding::vector
         FROM unnest($1::bigint[], $2::text[]) AS v(interest_id, embedding)
         WHERE i.interest_id = v.interest_id",
        vec![bigint_array(interest_ids), text_array(&literals)],
    ))
    .await?;
    Ok(())
}

/// Adds each delta onto the user's score for that interest. `NotFound` when
/// the user has no auth row for the score's foreign key to point at.
pub async fn add_interest_scores(
    db: &DatabaseConnection,
    user_id: Uuid,
    interest_ids: &[i64],
    deltas: &[f64],
) -> Result<(), CadenzaError> {
    if interest_ids.is_empty() {
        return Ok(());
    }
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO interest_scores (user_id, interest_id, score)
         SELECT $1, interest_id, delta
         FROM unnest($2::bigint[], $3::float8[]) AS t(interest_id, delta)
         ON CONFLICT (user_id, interest_id) DO UPDATE
         SET score = interest_scores.score + EXCLUDED.score",
        vec![
            user_id.into(),
            bigint_array(interest_ids),
            double_array(deltas),
        ],
    ))
    .await
    .map_err(|err| {
        if is_missing_user(&err) {
            CadenzaError::NotFound
        } else {
            CadenzaError::from(err)
        }
    })?;
    Ok(())
}

/// Multiplies every score by 0.6 unless the user decayed in the last 6 hours
/// or their top score is under 5. A no-op in those cases, so the client can
/// call it on every launch.
pub async fn decay_interests(db: &DatabaseConnection, user_id: Uuid) -> Result<(), CadenzaError> {
    let recent = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT decayed_at FROM interest_scores_metadata WHERE user_id = $1",
            vec![user_id.into()],
        ))
        .await?;
    if let Some(row) = recent {
        let decayed_at: DateTime<chrono::FixedOffset> = row.try_get_by_index(0)?;
        if Utc::now().signed_duration_since(decayed_at) <= chrono::Duration::hours(6) {
            return Ok(());
        }
    }

    let max_row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT MAX(score) AS max_score FROM interest_scores WHERE user_id = $1",
            vec![user_id.into()],
        ))
        .await?;
    let max_score: Option<f64> = max_row.and_then(|row| row.try_get_by_index(0).ok());
    if max_score.unwrap_or(0.0) < 5.0 {
        return Ok(());
    }

    let txn = db.begin().await?;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE interest_scores SET score = score * 0.6 WHERE user_id = $1",
        vec![user_id.into()],
    ))
    .await?;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO interest_scores_metadata (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET decayed_at = now()",
        vec![user_id.into()],
    ))
    .await?;
    txn.commit().await?;
    Ok(())
}

/// Days since [`posts_epoch`], the same whole-day count the stored vector uses.
pub fn days_since_posts_epoch(now: DateTime<Utc>) -> i64 {
    (now - posts_epoch()).num_days()
}

/// Whole days from `created_at` to `now`.
pub fn age_days(created_at: DateTime<Utc>, now: DateTime<Utc>) -> i64 {
    (now - created_at).num_days()
}

/// `3 log2(likes+1) - log2(age_days+1) + 100 * similarity`, plus
/// [`FRIEND_SCORE_BOOST`] when `sent_by_friend`.
pub fn score_post(likes: i64, age_days: i64, similarity: f64, sent_by_friend: bool) -> f64 {
    let likes_score = 3.0 * ((likes + 1) as f64).log2();
    let age_score = -((age_days + 1) as f64).log2();
    let friend_boost = if sent_by_friend {
        FRIEND_SCORE_BOOST
    } else {
        0.0
    };
    likes_score + age_score + 100.0 * similarity + friend_boost
}

/// Normalized weighted sum of interest vectors. `None` when there is nothing
/// to sum or the result has length zero.
fn combine_interest_vectors(interests: &[(Vec<f64>, f64)]) -> Option<Vec<f64>> {
    let mut total: Option<Vec<f64>> = None;
    for (embedding, score) in interests {
        if *score == 0.0 || embedding.is_empty() {
            continue;
        }
        match &mut total {
            None => total = Some(embedding.iter().map(|x| x * score).collect()),
            Some(acc) if acc.len() == embedding.len() => {
                for (slot, value) in acc.iter_mut().zip(embedding) {
                    *slot += value * score;
                }
            }
            Some(_) => {}
        }
    }
    let total = total?;
    let norm = total.iter().map(|x| x * x).sum::<f64>().sqrt();
    if norm == 0.0 {
        return None;
    }
    Some(total.into_iter().map(|x| x / norm).collect())
}

/// pgvector text form, `[1,2,3]`.
pub fn vector_literal(values: &[f64]) -> String {
    let mut out = String::from("[");
    for (i, value) in values.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&value.to_string());
    }
    out.push(']');
    out
}

/// Parses a pgvector or JSON-array vector. Rejects anything that is not a
/// flat list of numbers.
pub fn parse_vector(text: &str) -> Result<Vec<f64>, CadenzaError> {
    let text = text.trim();
    let inner = text
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .ok_or_else(|| CadenzaError::DatabaseError(format!("vector was not a list: {text}")))?;
    if inner.trim().is_empty() {
        return Ok(Vec::new());
    }
    inner
        .split(',')
        .map(|part| {
            part.trim().parse::<f64>().map_err(|_| {
                CadenzaError::DatabaseError(format!("vector component was not a number: {part}"))
            })
        })
        .collect()
}

async fn candidate_posts(
    db: &DatabaseConnection,
    user_id: Uuid,
    exclude: FeedExclude,
    order_sql: &str,
    vector: Option<String>,
) -> Result<Vec<FeedCandidate>, CadenzaError> {
    let (where_sql, mut values) = exclude_clause(exclude, user_id);
    let mut order_sql = order_sql.to_owned();
    if let Some(vector) = vector {
        let index = values.len() + 1;
        order_sql = order_sql.replace("$VEC", &format!("${index}"));
        values.push(vector.into());
    }
    let limit_index = values.len() + 1;
    values.push(FEED_SIZE.into());

    let sql = format!(
        "SELECT post_id, embedding::text AS embedding, likes, created_at
         FROM posts
         {where_sql}
         {order_sql}
         LIMIT ${limit_index}"
    );
    let rows = CandidateRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        values,
    ))
    .all(db)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(FeedCandidate {
                post_id: row.post_id,
                embedding: parse_vector(&row.embedding)?,
                likes: row.likes,
                created_at: row.created_at.with_timezone(&Utc),
                sent_by_friend: false,
            })
        })
        .collect()
}

fn exclude_clause(exclude: FeedExclude, user_id: Uuid) -> (&'static str, Vec<Value>) {
    match exclude {
        FeedExclude::None => ("", Vec::new()),
        FeedExclude::Viewed => (
            "WHERE NOT EXISTS (
                 SELECT 1 FROM post_view_status
                 WHERE post_view_status.post_id = posts.post_id
                   AND post_view_status.user_id = $1
                   AND post_view_status.status = 'viewed'
             )",
            vec![user_id.into()],
        ),
        FeedExclude::Loaded => (
            "WHERE NOT EXISTS (
                 SELECT 1 FROM post_view_status
                 WHERE post_view_status.post_id = posts.post_id
                   AND post_view_status.user_id = $1
             )",
            vec![user_id.into()],
        ),
    }
}

fn bigint_array(ids: &[i64]) -> Value {
    Value::Array(
        ArrayType::BigInt,
        Some(Box::new(
            ids.iter()
                .copied()
                .map(|id| Value::BigInt(Some(id)))
                .collect(),
        )),
    )
}

fn text_array(items: &[String]) -> Value {
    Value::Array(
        ArrayType::String,
        Some(Box::new(
            items
                .iter()
                .map(|item| Value::String(Some(item.clone())))
                .collect(),
        )),
    )
}

fn double_array(items: &[f64]) -> Value {
    Value::Array(
        ArrayType::Double,
        Some(Box::new(
            items
                .iter()
                .copied()
                .map(|n| Value::Double(Some(n)))
                .collect(),
        )),
    )
}

fn is_missing_user(err: &DbErr) -> bool {
    let text = err.to_string();
    text.contains("23503") && text.contains("interest_scores")
}

/// True when inserting a comment failed because `post_id` is not in `posts`.
fn is_missing_post(err: &DbErr) -> bool {
    let DbErr::Query(RuntimeErr::SqlxError(sqlx_err)) = err else {
        return false;
    };
    let Some(db_err) = sqlx_err.as_database_error() else {
        return false;
    };
    db_err.code().as_deref() == Some("23503")
        && db_err.constraint() == Some("comments_post_id_fkey")
}

#[derive(Debug, FromQueryResult)]
struct PostRow {
    post_id: i64,
    author_id: Uuid,
    content: String,
    likes: i64,
    created_at: DateTime<chrono::FixedOffset>,
    edited_at: Option<DateTime<chrono::FixedOffset>>,
    username: String,
    liked: bool,
    topic_mk_id: Option<String>,
    comment_count: i64,
}

impl PostRow {
    fn to_post(&self) -> SocialPost {
        SocialPost {
            post_id: self.post_id,
            content: self.content.clone(),
            likes: self.likes,
            liked: self.liked,
            created_at: self.created_at.with_timezone(&Utc),
            edited_at: self
                .edited_at
                .map(|edited_at| edited_at.with_timezone(&Utc)),
            author_id: self.author_id,
            author_username: self.username.clone(),
            topic_mk_id: self.topic_mk_id.clone(),
            comment_count: self.comment_count,
        }
    }
}

#[derive(Debug, FromQueryResult)]
struct CommentRow {
    comment_id: i64,
    post_id: i64,
    author_id: Uuid,
    content: String,
    likes: i64,
    created_at: DateTime<chrono::FixedOffset>,
    edited_at: Option<DateTime<chrono::FixedOffset>>,
    username: String,
    liked: bool,
}

impl CommentRow {
    fn to_comment(&self) -> SocialComment {
        SocialComment {
            comment_id: self.comment_id,
            post_id: self.post_id,
            content: self.content.clone(),
            likes: self.likes,
            liked: self.liked,
            created_at: self.created_at.with_timezone(&Utc),
            edited_at: self
                .edited_at
                .map(|edited_at| edited_at.with_timezone(&Utc)),
            author_id: self.author_id,
            author_username: self.username.clone(),
        }
    }
}

#[derive(Debug, FromQueryResult)]
struct PostClockRow {
    created_at: DateTime<chrono::FixedOffset>,
    edited_at: Option<DateTime<chrono::FixedOffset>>,
    topic_mk_id: Option<String>,
}

#[derive(Debug, FromQueryResult)]
struct FriendshipListRow {
    user_id: Uuid,
    username: String,
    kind: String,
}

#[derive(Debug, FromQueryResult)]
struct UserSearchRow {
    user_id: Uuid,
    username: String,
    is_friend: bool,
}

#[derive(Debug, FromQueryResult)]
struct ProfileRow {
    uid: Uuid,
    username: String,
    bio: String,
    friend_count: i64,
}

#[derive(Debug, FromQueryResult)]
struct InterestRow {
    embedding: String,
    score: f64,
}

#[derive(Debug, FromQueryResult)]
struct CandidateRow {
    post_id: i64,
    embedding: String,
    likes: i64,
    created_at: DateTime<chrono::FixedOffset>,
}

/// An interest row just inserted or already present.
#[derive(Debug, Clone, FromQueryResult)]
pub struct UpsertedInterest {
    pub interest_id: i64,
    pub name: String,
    pub interest_type: String,
    pub embedding_exists: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_older_edit_does_not_replace_a_newer_one() {
        let older = Utc.with_ymd_and_hms(2026, 11, 2, 1, 0, 0).unwrap();
        let newer = Utc.with_ymd_and_hms(2026, 11, 2, 2, 0, 0).unwrap();
        assert!(edit_replaces(None, older));
        assert!(edit_replaces(Some(older), newer));
        assert!(edit_replaces(Some(older), older));
        assert!(!edit_replaces(Some(newer), older));
    }

    #[test]
    fn user_vector_weights_and_normalizes() {
        let vector =
            combine_interest_vectors(&[(vec![1.0, 0.0], 1.0), (vec![0.0, 1.0], 1.0)]).unwrap();
        let norm = vector.iter().map(|x| x * x).sum::<f64>().sqrt();
        assert!((norm - 1.0).abs() < 1e-9);
        assert!((vector[0] - vector[1]).abs() < 1e-9);
    }

    #[test]
    fn user_vector_is_none_without_scores() {
        assert!(combine_interest_vectors(&[(vec![1.0, 0.0], 0.0)]).is_none());
        assert!(combine_interest_vectors(&[]).is_none());
    }

    #[test]
    fn score_prefers_a_closer_newer_post() {
        let fresh = score_post(0, 0, 1.0, false);
        let old = score_post(0, 10, 0.0, false);
        assert!(fresh > old);
    }

    #[test]
    fn score_boosts_a_friend_post() {
        let other = score_post(100, 0, 1.0, false);
        let friend = score_post(0, 100, 0.0, true);
        assert!(friend > other);
        assert!(
            (score_post(0, 0, 0.0, true) - score_post(0, 0, 0.0, false) - FRIEND_SCORE_BOOST).abs()
                < 1e-9
        );
    }

    fn candidate(post_id: i64, sent_by_friend: bool) -> FeedCandidate {
        FeedCandidate {
            post_id,
            embedding: Vec::new(),
            likes: 0,
            created_at: Utc::now(),
            sent_by_friend,
        }
    }

    #[test]
    fn merge_keeps_sent_by_friend_across_sources() {
        let posts = merge_feed_candidates([
            candidate(1, false),
            candidate(2, false),
            candidate(1, true),
            candidate(2, false),
            candidate(3, true),
        ]);
        let by_id: HashMap<_, _> = posts
            .into_iter()
            .map(|post| (post.post_id, post.sent_by_friend))
            .collect();
        assert_eq!(by_id.get(&1), Some(&true));
        assert_eq!(by_id.get(&2), Some(&false));
        assert_eq!(by_id.get(&3), Some(&true));
        assert_eq!(by_id.len(), 3);
    }

    #[test]
    fn vector_literal_round_trips() {
        let text = vector_literal(&[0.5, -1.0, 2.0]);
        assert_eq!(parse_vector(&text).unwrap(), vec![0.5, -1.0, 2.0]);
    }

    #[test]
    fn user_search_pattern_escapes_like_wildcards() {
        assert_eq!(like_contains_pattern("ada"), "%ada%");
        assert_eq!(like_contains_pattern("o'brien"), "%o'brien%");
        assert_eq!(like_contains_pattern("100%"), "%100\\%%");
        assert_eq!(like_contains_pattern("a_b"), "%a\\_b%");
        assert_eq!(like_contains_pattern("a\\b"), "%a\\\\b%");
    }

    #[test]
    fn user_search_skips_a_blank_term() {
        let viewer = Uuid::nil();
        assert!(user_search_statement(viewer, "", 20).is_none());
        assert!(user_search_statement(viewer, "   ", 20).is_none());
        assert!(user_search_statement(viewer, "\n\t", 20).is_none());
    }

    #[test]
    fn user_search_binds_the_caller_the_pattern_and_the_limit() {
        let viewer = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let statement = user_search_statement(viewer, "  Ada_x  ", 20).unwrap();

        assert!(statement.sql.contains("pr.uid <> $1"), "{}", statement.sql);
        assert!(
            statement
                .sql
                .contains("lower(pr.username) LIKE lower($2) ESCAPE '\\'"),
            "{}",
            statement.sql
        );
        assert!(
            statement.sql.contains("f.status = 'complete'"),
            "{}",
            statement.sql
        );
        assert!(
            statement.sql.contains("f.user1 = LEAST($1, pr.uid)"),
            "{}",
            statement.sql
        );
        assert!(
            statement.sql.contains("f.user2 = GREATEST($1, pr.uid)"),
            "{}",
            statement.sql
        );
        assert!(statement.sql.contains("AS is_friend"), "{}", statement.sql);
        assert!(
            statement.sql.contains("ORDER BY pr.username, pr.uid"),
            "{}",
            statement.sql
        );
        assert!(statement.sql.contains("LIMIT $3"), "{}", statement.sql);
        assert!(!statement.sql.contains("Ada_x"), "{}", statement.sql);

        let values = &statement.values.as_ref().unwrap().0;
        assert_eq!(values[0], Value::from(viewer));
        assert_eq!(values[1], Value::from("%Ada\\_x%"));
        assert_eq!(values[2], Value::from(20_i64));
    }

    #[test]
    fn friend_request_status_names_the_recipient() {
        let smaller = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let larger = Uuid::parse_str("ffffffff-ffff-ffff-ffff-ffffffffffff").unwrap();
        let (user1, user2) = ordered_friend_users(smaller, larger);
        assert_eq!((user1, user2), (smaller, larger));
        let (user1, _) = ordered_friend_users(larger, smaller);
        assert_eq!(user1, smaller);
        assert_eq!(friend_request_status(smaller, user1), "to_user1");
        assert_eq!(friend_request_status(larger, user1), "to_user2");
    }

    #[test]
    fn comments_on_post_orders_by_likes_and_marks_the_viewer() {
        let sql = comments_on_post(Uuid::nil(), 4)
            .build(DbBackend::Postgres)
            .to_string();
        assert!(
            sql.contains(r#"LEFT JOIN "profile" ON "comments"."user_id" = "profile"."uid""#),
            "{sql}"
        );
        assert!(
            sql.contains(r#"COALESCE("profile"."username", 'unknown') AS "username""#),
            "{sql}"
        );
        assert!(sql.contains("EXISTS"), "{sql}");
        assert!(
            sql.contains(
                r#"WHERE "comments"."post_id" = 4 ORDER BY "comments"."likes" DESC, "comments"."created_at" DESC, "comments"."comment_id" DESC"#
            ),
            "{sql}"
        );
        assert!(sql.contains(r#""comments"."edited_at""#), "{sql}");
    }

    #[test]
    fn comments_page_limits_and_seeks_past_the_cursor() {
        let first = comments_page(Uuid::nil(), 4, None)
            .build(DbBackend::Postgres)
            .to_string();
        assert!(first.contains("LIMIT 20"), "{first}");
        assert!(!first.contains(r#""comments"."likes" <"#), "{first}");

        let cursor = CommentsCursor {
            likes: 3,
            created_at: Utc.with_ymd_and_hms(2026, 10, 16, 18, 0, 0).unwrap(),
            comment_id: 9,
        };
        let next = comments_page(Uuid::nil(), 4, Some(cursor))
            .build(DbBackend::Postgres)
            .to_string();
        assert!(next.contains("LIMIT 20"), "{next}");
        assert!(next.contains(r#""comments"."likes" < 3"#), "{next}");
        assert!(next.contains(r#""comments"."likes" = 3"#), "{next}");
        assert!(next.contains(r#""comments"."comment_id" < 9"#), "{next}");
    }

    #[test]
    fn topic_posts_statement_pages_by_likes() {
        let viewer = Uuid::nil();
        let first = topic_posts_statement(viewer, "1615585008", None);
        assert!(
            first.sql.contains("WHERE p.topic_mk_id = $2"),
            "{}",
            first.sql
        );
        assert!(
            first
                .sql
                .contains("ORDER BY p.likes DESC, p.created_at DESC, p.post_id DESC"),
            "{}",
            first.sql
        );
        assert!(first.sql.contains("LIMIT $3"), "{}", first.sql);
        assert!(!first.sql.contains(" < "), "{}", first.sql);
        let values = &first.values.as_ref().unwrap().0;
        assert_eq!(values[2], Value::from(TOPIC_POST_LIMIT));

        let created_at = Utc.with_ymd_and_hms(2026, 10, 16, 18, 0, 0).unwrap();
        let next = topic_posts_statement(
            viewer,
            "1615585008",
            Some(TopicPostsCursor {
                likes: 4,
                created_at,
                post_id: 12,
            }),
        );
        assert!(
            next.sql
                .contains("(p.likes, p.created_at, p.post_id) < ($3, $4, $5)"),
            "{}",
            next.sql
        );
        assert!(next.sql.contains("LIMIT $6"), "{}", next.sql);
        let values = &next.values.as_ref().unwrap().0;
        assert_eq!(values[2], Value::from(4_i64));
        assert_eq!(values[3], Value::from(created_at));
        assert_eq!(values[4], Value::from(12_i64));
        assert_eq!(values[5], Value::from(TOPIC_POST_LIMIT));
    }
}
