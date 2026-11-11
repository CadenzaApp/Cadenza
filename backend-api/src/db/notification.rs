//! The signed-in user's notifications. The table is not in the generated
//! entities yet, so the SeaORM model lives here until the next codegen.
//! [`list_notifications`] is the page read. [`insert_notification`] is the
//! write, called by [`crate::services::notification::push_notification`].
//! [`delete_notifications_before`] is the daily cleanup.

use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    Condition, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    prelude::Expr,
};
use serde_json::Value as JsonValue;

use crate::err::CadenzaError;

/// How many notifications one `GET /social/notifications` call returns.
pub const NOTIFICATION_LIMIT: u64 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "Enum", enum_name = "notification_type")]
pub enum NotificationType {
    #[sea_orm(string_value = "friend_req_received")]
    FriendReqReceived,
    #[sea_orm(string_value = "friend_req_accepted")]
    FriendReqAccepted,
    #[sea_orm(string_value = "comment")]
    Comment,
}

impl NotificationType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FriendReqReceived => "friend_req_received",
            Self::FriendReqAccepted => "friend_req_accepted",
            Self::Comment => "comment",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "notifications")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub notif_id: i64,
    pub user_id: Uuid,
    #[sea_orm(column_type = "Text")]
    pub title: String,
    #[sea_orm(column_type = "Text")]
    pub content: String,
    #[sea_orm(column_name = "type")]
    pub notif_type: NotificationType,
    pub created_at: DateTimeWithTimeZone,
    pub unread: bool,
    /// `{"post_id"}` for a comment, or `{"sender_id", "resolution"}` for a friend request.
    #[sea_orm(column_type = "JsonBinary")]
    pub metadata: Json,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// One notification for the signed-in user.
#[derive(Clone, Debug)]
pub struct Notification {
    pub notif_id: i64,
    pub title: String,
    pub content: String,
    /// `friend_req_received`, `friend_req_accepted`, or `comment`.
    pub notif_type: String,
    pub created_at: DateTime<Utc>,
    pub unread: bool,
    pub metadata: JsonValue,
}

/// Where the next page starts. The columns are the sort key, in order.
#[derive(Clone, Debug)]
pub struct NotificationCursor {
    pub unread: bool,
    pub created_at: DateTime<Utc>,
    pub notif_id: i64,
}

/// One page, plus the cursor for the following page when this one is full.
pub struct NotificationPage {
    pub notifications: Vec<Notification>,
    pub next: Option<NotificationCursor>,
}

/// Inserts one notification and returns its `notif_id`.
///
/// `created_at` and `unread` stay unset so the table defaults apply (`now()`,
/// unread). Text and `metadata` are stored as given.
pub async fn insert_notification(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    title: &str,
    content: &str,
    notif_type: NotificationType,
    metadata: JsonValue,
) -> Result<i64, CadenzaError> {
    let row = ActiveModel {
        notif_id: NotSet,
        user_id: Set(user_id),
        title: Set(title.to_owned()),
        content: Set(content.to_owned()),
        notif_type: Set(notif_type),
        created_at: NotSet,
        unread: NotSet,
        metadata: Set(metadata),
    };
    Ok(row.insert(db).await?.notif_id)
}

/// The caller's notifications, at most [`NOTIFICATION_LIMIT`], unread first.
///
/// Order is `unread` desc, `created_at` desc, `notif_id` desc, which is
/// `notifications_user_unread_idx`. `created_at` is not unique, so `notif_id`
/// finishes the order and the cursor. `unread` is the first key, so a cursor
/// of only `(created_at, notif_id)` would skip a newer read row that sorts
/// after an older unread one.
///
/// `cursor` is `None` for the first page. Later pages pass the previous
/// `next`.
pub async fn list_notifications(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    cursor: Option<NotificationCursor>,
) -> Result<NotificationPage, CadenzaError> {
    let mut query = Entity::find().filter(Column::UserId.eq(user_id));
    if let Some(cursor) = cursor {
        let created_at = cursor.created_at.fixed_offset();
        query = query.filter(
            Condition::any()
                .add(Column::Unread.lt(cursor.unread))
                .add(
                    Condition::all()
                        .add(Column::Unread.eq(cursor.unread))
                        .add(Column::CreatedAt.lt(created_at)),
                )
                .add(
                    Condition::all()
                        .add(Column::Unread.eq(cursor.unread))
                        .add(Column::CreatedAt.eq(created_at))
                        .add(Column::NotifId.lt(cursor.notif_id)),
                ),
        );
    }
    let rows = query
        .order_by_desc(Column::Unread)
        .order_by_desc(Column::CreatedAt)
        .order_by_desc(Column::NotifId)
        .limit(NOTIFICATION_LIMIT)
        .all(db)
        .await?;

    let next = (rows.len() as u64 == NOTIFICATION_LIMIT)
        .then(|| rows.last())
        .flatten()
        .map(|row| NotificationCursor {
            unread: row.unread,
            created_at: row.created_at.with_timezone(&Utc),
            notif_id: row.notif_id,
        });
    let notifications = rows
        .into_iter()
        .map(|row| Notification {
            notif_id: row.notif_id,
            title: row.title,
            content: row.content,
            notif_type: row.notif_type.as_str().to_owned(),
            created_at: row.created_at.with_timezone(&Utc),
            unread: row.unread,
            metadata: row.metadata,
        })
        .collect();
    Ok(NotificationPage {
        notifications,
        next,
    })
}

/// Sets `unread` to false for the caller's rows in `notif_ids`. Ids that belong
/// to someone else, or that are already read, stay as they are. An empty list
/// does nothing.
pub async fn mark_notifications_read(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    notif_ids: &[i64],
) -> Result<(), CadenzaError> {
    if notif_ids.is_empty() {
        return Ok(());
    }
    Entity::update_many()
        .col_expr(Column::Unread, Expr::value(false))
        .filter(Column::UserId.eq(user_id))
        .filter(Column::NotifId.is_in(notif_ids.iter().copied()))
        .exec(db)
        .await?;
    Ok(())
}

/// Deletes every notification with `created_at` before `cutoff`.
///
/// Returns how many rows were deleted. `notifications_created_at_idx` is the
/// index this walks.
pub async fn delete_notifications_before(
    db: &impl ConnectionTrait,
    cutoff: DateTime<Utc>,
) -> Result<u64, CadenzaError> {
    let deleted = Entity::delete_many()
        .filter(Column::CreatedAt.lt(cutoff.fixed_offset()))
        .exec(db)
        .await?;
    Ok(deleted.rows_affected)
}
