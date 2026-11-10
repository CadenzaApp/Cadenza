//! The signed-in user's notifications. The table is not in the generated
//! entities yet, so the SeaORM model lives here until the next codegen.

use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use sea_orm::{Condition, ConnectionTrait, QueryOrder, QuerySelect};

use crate::err::CadenzaError;

/// How many notifications one `GET /social/notifications` call returns.
pub const NOTIFICATION_LIMIT: u64 = 20;

#[derive(Debug, Clone, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "Enum", enum_name = "notification_icon")]
pub enum NotificationIcon {
    #[sea_orm(string_value = "heart")]
    Heart,
    #[sea_orm(string_value = "chatbubble")]
    Chatbubble,
    #[sea_orm(string_value = "person-add")]
    PersonAdd,
}

impl NotificationIcon {
    fn as_str(self) -> &'static str {
        match self {
            Self::Heart => "heart",
            Self::Chatbubble => "chatbubble",
            Self::PersonAdd => "person-add",
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
    pub icon: NotificationIcon,
    pub created_at: DateTimeWithTimeZone,
    pub unread: bool,
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
    pub icon: String,
    pub created_at: DateTime<Utc>,
    pub unread: bool,
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
            icon: row.icon.as_str().to_owned(),
            created_at: row.created_at.with_timezone(&Utc),
            unread: row.unread,
        })
        .collect();
    Ok(NotificationPage {
        notifications,
        next,
    })
}
