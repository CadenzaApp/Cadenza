//! Push notifications to phones, through Expo's push service. Phones register
//! their Expo push token with `POST /push-tokens` (see `db::push_tokens`).
//!
//! What sends a push is in `push_triggers.rs`: a comment, a like, a friend's
//! post, and a friend going live. Each runs on a background task, so the
//! request does not wait on Expo. [`PushService::send_to_users`] sends one
//! message to every token those users have, in one batch. A token Expo calls `DeviceNotRegistered` is deleted,
//! whether the send ticket says so straight away or the push receipt says so
//! later. [`spawn_receipt_check`] reads those receipts. Receipts wait in memory,
//! so a restart forgets the ones not read yet; the token is then caught on a
//! later push instead.
//!
//! `EXPO_ACCESS_TOKEN` is optional. It is only needed once push security is on
//! for the Expo project.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use expo_push_notification_client::{
    DetailsErrorType, Expo, ExpoClientOptions, ExpoPushErrorReceipt, ExpoPushMessage,
    ExpoPushReceipt, ExpoPushReceiptId, ExpoPushTicket, Sound,
};
use sea_orm::{DatabaseConnection, prelude::Uuid};
use serde_json::Value;
use tokio::time::{Instant, MissedTickBehavior, interval};

use crate::db::push_tokens;
use crate::lifecycle::BackgroundTasks;

/// Prefix on every line this module logs.
const LOG_TAG: &str = "[push]";

/// The Android channel the app makes on sign in. See
/// `client-app/src/lib/push-notifications.tsx`.
const ANDROID_CHANNEL: &str = "default";

/// Expo suggests reading a receipt about 15 minutes after the send.
const RECEIPT_DELAY: Duration = Duration::from_secs(15 * 60);

/// Expo keeps a receipt for a day. One still missing after that is dropped.
const RECEIPT_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// How often [`spawn_receipt_check`] looks for receipts that are due.
const RECEIPT_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// Expo takes at most 1000 receipt ids per request.
const RECEIPT_CHUNK: usize = 1000;

/// Receipts kept in memory at most. Past this the oldest are dropped.
const MAX_PENDING_RECEIPTS: usize = 10_000;

/// Keys [`PushService::first_in`] remembers at most before it drops expired ones.
const MAX_RECENT_KEYS: usize = 10_000;

/// One notification for every phone a user is signed in on.
pub struct PushMessage {
    pub title: String,
    pub body: String,
    /// Handed to the app with the notification. `{"type", ...}`.
    pub data: Value,
}

/// A receipt to read once [`RECEIPT_DELAY`] has passed.
struct PendingReceipt {
    id: ExpoPushReceiptId,
    token: String,
    sent_at: Instant,
}

/// Cheap to clone. Every clone shares the Expo client, the receipt queue, and
/// the recent push memory.
#[derive(Clone)]
pub struct PushService {
    expo: Arc<Expo>,
    pending: Arc<Mutex<VecDeque<PendingReceipt>>>,
    /// When each key last passed [`Self::first_in`].
    recent: Arc<Mutex<HashMap<String, Instant>>>,
}

impl PushService {
    pub fn new() -> Self {
        let access_token = std::env::var("EXPO_ACCESS_TOKEN")
            .ok()
            .filter(|token| !token.trim().is_empty());
        Self {
            expo: Arc::new(Expo::new(ExpoClientOptions { access_token })),
            pending: Arc::default(),
            recent: Arc::default(),
        }
    }

    /// True the first time `key` is seen in `window`, and records it. Used so
    /// a repeated action, like liking the same post again, does not push
    /// twice. Kept in memory, so a restart forgets it.
    pub(super) fn first_in(&self, key: String, window: Duration) -> bool {
        let now = Instant::now();
        let mut recent = self.recent.lock().expect("recent push memory");
        if recent
            .get(&key)
            .is_some_and(|at| now.duration_since(*at) < window)
        {
            return false;
        }
        if recent.len() >= MAX_RECENT_KEYS {
            recent.retain(|_, at| now.duration_since(*at) < window);
        }
        recent.insert(key, now);
        true
    }

    /// True when `token` looks like an Expo push token.
    pub fn is_push_token(token: &str) -> bool {
        Expo::is_expo_push_token(token)
    }

    /// Sends `message` to every token any of `user_ids` has. Users with none
    /// get nothing. Tokens the send tickets call dead are deleted. The rest
    /// wait for their receipt. Failures are logged, never returned.
    pub(super) async fn send_to_users(
        &self,
        db: &DatabaseConnection,
        user_ids: &[Uuid],
        message: &PushMessage,
    ) {
        if user_ids.is_empty() {
            return;
        }
        let tokens = match push_tokens::users_push_tokens(db, user_ids).await {
            Ok(tokens) => tokens,
            Err(err) => {
                eprintln!("{LOG_TAG}: could not read tokens: {err}");
                return;
            }
        };
        // one message per token, so ticket i is for tokens[i]
        let mut sent = Vec::with_capacity(tokens.len());
        let mut messages = Vec::with_capacity(tokens.len());
        for token in tokens {
            match build_message(&token, message) {
                Ok(built) => {
                    messages.push(built);
                    sent.push(token);
                }
                Err(err) => eprintln!("{LOG_TAG}: skipped a token: {err}"),
            }
        }
        if messages.is_empty() {
            return;
        }
        let tickets = match self.expo.send_push_notifications(messages).await {
            Ok(tickets) => tickets,
            Err(err) => {
                eprintln!("{LOG_TAG}: send failed: {err}");
                return;
            }
        };

        let mut dead = Vec::new();
        let now = Instant::now();
        let mut pending = Vec::new();
        for (token, ticket) in sent.into_iter().zip(tickets) {
            match ticket {
                ExpoPushTicket::Ok(ok) => pending.push(PendingReceipt {
                    id: ok.id,
                    token,
                    sent_at: now,
                }),
                ExpoPushTicket::Error(err) if is_device_not_registered(&err) => dead.push(token),
                ExpoPushTicket::Error(err) => {
                    eprintln!("{LOG_TAG}: Expo refused a push: {}", err.message)
                }
            }
        }
        self.queue_receipts(pending);
        delete_dead_tokens(db, &dead).await;
    }

    fn queue_receipts(&self, receipts: Vec<PendingReceipt>) {
        if receipts.is_empty() {
            return;
        }
        let mut pending = self.pending.lock().expect("push receipt queue");
        pending.extend(receipts);
        while pending.len() > MAX_PENDING_RECEIPTS {
            pending.pop_front();
        }
    }

    /// Takes every queued receipt sent at least [`RECEIPT_DELAY`] ago.
    fn take_due_receipts(&self, now: Instant) -> Vec<PendingReceipt> {
        let mut pending = self.pending.lock().expect("push receipt queue");
        // queued in send order, so the due ones are at the front
        let due = pending
            .iter()
            .take_while(|receipt| now.duration_since(receipt.sent_at) >= RECEIPT_DELAY)
            .count();
        pending.drain(..due).collect()
    }

    /// Reads the receipts that are due and deletes the tokens they call dead.
    /// A receipt Expo has not written yet goes back in the queue until it is a
    /// day old. So does a chunk whose request failed.
    async fn check_receipts(&self, db: &DatabaseConnection) {
        let now = Instant::now();
        let due = self.take_due_receipts(now);
        if due.is_empty() {
            return;
        }
        let mut dead = Vec::new();
        let mut retry = Vec::new();
        let mut due = due.into_iter().peekable();
        while due.peek().is_some() {
            let chunk: Vec<PendingReceipt> = due.by_ref().take(RECEIPT_CHUNK).collect();
            let receipts = match self
                .expo
                .get_push_notification_receipts(chunk.iter().map(|r| r.id.clone()))
                .await
            {
                Ok(receipts) => receipts,
                Err(err) => {
                    eprintln!("{LOG_TAG}: reading receipts failed: {err}");
                    HashMap::new()
                }
            };
            for receipt in chunk {
                match receipts.get(&receipt.id) {
                    Some(ExpoPushReceipt::Ok) => {}
                    Some(ExpoPushReceipt::Error(err)) if is_device_not_registered(err) => {
                        dead.push(receipt.token)
                    }
                    Some(ExpoPushReceipt::Error(err)) => {
                        eprintln!("{LOG_TAG}: a push failed: {}", err.message)
                    }
                    None if now.duration_since(receipt.sent_at) < RECEIPT_MAX_AGE => {
                        retry.push(receipt)
                    }
                    None => {}
                }
            }
        }
        // put back at the front, oldest first, ahead of anything sent since
        {
            let mut pending = self.pending.lock().expect("push receipt queue");
            for receipt in retry.into_iter().rev() {
                pending.push_front(receipt);
            }
            while pending.len() > MAX_PENDING_RECEIPTS {
                pending.pop_front();
            }
        }
        delete_dead_tokens(db, &dead).await;
    }
}

impl Default for PushService {
    fn default() -> Self {
        Self::new()
    }
}

/// Runs [`PushService::check_receipts`] every [`RECEIPT_INTERVAL`] for as long
/// as the server lives.
pub fn spawn_receipt_check(push: PushService, db: DatabaseConnection, work: BackgroundTasks) {
    println!(
        "{LOG_TAG}: reading push receipts every {}s",
        RECEIPT_INTERVAL.as_secs()
    );
    work.clone().spawn(async move {
        let mut ticker = interval(RECEIPT_INTERVAL);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                biased;
                _ = work.cancelled() => break,
                _ = ticker.tick() => {},
            }
            if work.is_stopping() {
                break;
            }
            push.check_receipts(&db).await;
        }
    });
}

fn build_message(
    token: &str,
    message: &PushMessage,
) -> Result<ExpoPushMessage, expo_push_notification_client::ValidationError> {
    ExpoPushMessage::builder([token])
        .title(message.title.clone())
        .body(message.body.clone())
        .data(&message.data)?
        .sound(Sound::Default)
        .channel_id(ANDROID_CHANNEL)
        .build()
}

fn is_device_not_registered(err: &ExpoPushErrorReceipt) -> bool {
    matches!(
        err.details
            .as_ref()
            .and_then(|details| details.error.as_ref()),
        Some(DetailsErrorType::DeviceNotRegistered)
    )
}

async fn delete_dead_tokens(db: &DatabaseConnection, dead: &[String]) {
    match push_tokens::delete_push_tokens(db, dead).await {
        Ok(0) => {}
        Ok(count) => println!("{LOG_TAG}: deleted {count} tokens Expo no longer delivers to"),
        Err(err) => eprintln!("{LOG_TAG}: could not delete dead tokens: {err}"),
    }
}

#[cfg(test)]
mod tests {
    use expo_push_notification_client::Details;

    use super::*;

    fn error(kind: Option<DetailsErrorType>) -> ExpoPushErrorReceipt {
        ExpoPushErrorReceipt {
            message: "x".into(),
            details: Some(Details {
                error: kind,
                expo_push_token: None,
            }),
        }
    }

    #[test]
    fn only_device_not_registered_is_dead() {
        assert!(is_device_not_registered(&error(Some(
            DetailsErrorType::DeviceNotRegistered
        ))));
        assert!(!is_device_not_registered(&error(Some(
            DetailsErrorType::MessageRateExceeded
        ))));
        assert!(!is_device_not_registered(&error(None)));
        assert!(!is_device_not_registered(&ExpoPushErrorReceipt {
            message: "x".into(),
            details: None,
        }));
    }

    #[test]
    fn only_receipts_past_the_delay_are_due() {
        let push = PushService::new();
        let sent_at = Instant::now();
        push.queue_receipts(vec![PendingReceipt {
            id: "a".try_into().unwrap(),
            token: "ExponentPushToken[a]".into(),
            sent_at,
        }]);
        assert!(
            push.take_due_receipts(sent_at + RECEIPT_DELAY / 2)
                .is_empty()
        );
        let due = push.take_due_receipts(sent_at + RECEIPT_DELAY);
        assert_eq!(due.len(), 1);
        assert!(push.take_due_receipts(sent_at + RECEIPT_MAX_AGE).is_empty());
    }
}
