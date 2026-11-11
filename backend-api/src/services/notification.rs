//! In-app notifications. Other backend code calls [`push_notification`] when a
//! user should see one. The phone reads them from `GET /social/notifications`.
//! [`spawn_notification_cleanup`] drops rows older than 30 days, once a day.

use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use sea_orm::{ConnectionTrait, DatabaseConnection, prelude::Uuid};
use serde_json::Value;
use tokio::time::{MissedTickBehavior, interval};

use crate::db::notification;
use crate::err::CadenzaError;

/// How long a notification is kept.
const NOTIFICATION_MAX_AGE: ChronoDuration = ChronoDuration::days(30);

/// How often the cleanup runs.
const CLEANUP_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// Prefix on every line the cleanup job logs.
const LOG_TAG: &str = "[notification-cleanup]";

pub use crate::db::notification::NotificationType;

/// One notification to store for `user_id`.
pub struct NewNotification {
    pub user_id: Uuid,
    pub title: String,
    pub content: String,
    pub notif_type: NotificationType,
    /// `{"post_id"}` for a comment, or `{"sender_id", "resolution"}` for a friend request.
    pub metadata: Value,
}

/// Writes one unread notification and returns its `notif_id`.
///
/// `created_at` is the database clock. The row shows up on the recipient's
/// next `GET /social/notifications`. `metadata` is stored as given.
///
/// A `user_id` that is not an auth user fails the foreign key and comes back
/// as `DatabaseError`.
pub async fn push_notification(
    db: &impl ConnectionTrait,
    notification: NewNotification,
) -> Result<i64, CadenzaError> {
    notification::insert_notification(
        db,
        notification.user_id,
        &notification.title,
        &notification.content,
        notification.notif_type,
        notification.metadata,
    )
    .await
}

/// Runs [`delete_old_notifications`] once a day for as long as the server lives.
/// The first pass runs at startup, since the first tick lands straight away.
///
/// A pass that fails is logged and the job carries on at the next day. Ticks
/// are delayed rather than burst, so a pass that outruns the interval is
/// followed by a full day of quiet.
pub fn spawn_notification_cleanup(db: DatabaseConnection) {
    println!("{LOG_TAG}: on, deleting notifications older than 30 days once a day");
    tokio::spawn(async move {
        let mut ticker = interval(CLEANUP_INTERVAL);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

        loop {
            ticker.tick().await;
            match delete_old_notifications(&db).await {
                Ok(0) => {}
                Ok(count) => println!("{LOG_TAG} deleted {count} notifications older than 30 days"),
                Err(err) => eprintln!("{LOG_TAG} pass failed: {err}"),
            }
        }
    });
}

/// Deletes notifications older than [`NOTIFICATION_MAX_AGE`] and returns how
/// many rows went. The cutoff is this process's clock.
async fn delete_old_notifications(db: &DatabaseConnection) -> Result<u64, CadenzaError> {
    let cutoff = Utc::now() - NOTIFICATION_MAX_AGE;
    notification::delete_notifications_before(db, cutoff).await
}
