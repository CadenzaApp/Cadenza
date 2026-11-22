//! The signed-in user's notifications, over the generated `notifications`
//! entity. [`list_notifications`] is the page read. [`insert_notification`] is the
//! write, called by [`crate::services::notification::push_notification`].
//! [`dismiss_notifications`] is the user clearing some or all.
//! [`delete_notifications_before`] is the daily cleanup.

use chrono::{DateTime, Utc};
use sea_orm::{
    ActiveEnum, ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    prelude::{Expr, Uuid},
};
use serde_json::Value as JsonValue;

use crate::db::entity::notifications::{ActiveModel, Column, Entity};
use crate::err::CadenzaError;

pub use crate::db::entity::sea_orm_active_enums::NotificationType;

/// How many notifications one `GET /social/notifications` call returns.
pub const NOTIFICATION_LIMIT: u64 = 20;

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
    /// `{"post_id"}` for a comment, `{"sender_id", "resolution"}` for a friend
    /// request, `{"sender_id", "session_id", "resolution"}` for a session join
    /// request, and `{"session_id"}` for being let into one.
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
        r#type: Set(notif_type),
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
            notif_type: row.r#type.to_value().value.into_owned(),
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

/// Deletes the caller's notifications in `notif_ids`, or all of them when
/// `None`. Ids that belong to someone else stay. Returns how many went.
pub async fn dismiss_notifications(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    notif_ids: Option<&[i64]>,
) -> Result<u64, CadenzaError> {
    let mut delete = Entity::delete_many().filter(Column::UserId.eq(user_id));
    if let Some(ids) = notif_ids {
        if ids.is_empty() {
            return Ok(0);
        }
        delete = delete.filter(Column::NotifId.is_in(ids.iter().copied()));
    }
    Ok(delete.exec(db).await?.rows_affected)
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
