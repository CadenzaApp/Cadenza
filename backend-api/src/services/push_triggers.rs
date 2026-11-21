//! The events that send a phone push, one method each on [`PushService`].
//! Every method returns at once and does its lookups and the send on a
//! background task, so the request that caused it never waits on them.
//! Failures are logged, never returned.
//!
//! | event                 | who gets it                | data                                        |
//! | --------------------- | -------------------------- | ------------------------------------------- |
//! | a comment on a post   | the post's author          | `{"type": "comment", "post_id"}`            |
//! | a like on a post      | the post's author          | `{"type": "post_like", "post_id"}`          |
//! | a new post            | the author's friends       | `{"type": "friend_post", "post_id"}`        |
//! | a new live session    | the host's friends         | `{"type": "live_session", "session_id"}`    |

use std::time::Duration;

use sea_orm::{DatabaseConnection, prelude::Uuid};
use serde_json::json;

use super::push::{PushMessage, PushService};
use crate::db::audience::{Audience, PrivacyField};
use crate::db::{friend_relations, privacy, profile, social};
use crate::err::CadenzaError;
use crate::lifecycle::BackgroundTasks;

const LOG_TAG: &str = "[push]";

/// A post's text in a push body is cut to this many characters.
const PREVIEW_CHARS: usize = 100;

/// The same person liking the same post again inside this window, after an
/// unlike, does not push again.
const LIKE_REPEAT_WINDOW: Duration = Duration::from_secs(60 * 60);

impl PushService {
    /// Tells the post's author about a new comment. For now that includes the
    /// author's own comments, for testing.
    // TODO: skip the author's own comments once push testing is done, the
    // same as the in-app notification
    pub fn notify_comment(
        &self,
        db: DatabaseConnection,
        work: &BackgroundTasks,
        post_author: Uuid,
        commenter: Uuid,
        post_id: i64,
        content: String,
    ) {
        let push = self.clone();
        spawn_trigger(work, "comment", async move {
            let username = profile::username_or_unknown(&db, commenter).await?;
            let message = PushMessage {
                title: format!("{username} commented on your post"),
                body: content,
                data: json!({ "type": "comment", "post_id": post_id }),
            };
            push.send_to_users(&db, &[post_author], &message).await;
            Ok(())
        });
    }

    /// Tells the post's author someone liked it. Only call it for a like that
    /// was just stored. Nothing for liking your own post or a spotlight, and
    /// nothing for a like-unlike-like inside [`LIKE_REPEAT_WINDOW`].
    pub fn notify_post_like(
        &self,
        db: DatabaseConnection,
        work: &BackgroundTasks,
        liker: Uuid,
        post_id: i64,
    ) {
        if !self.first_in(format!("like:{post_id}:{liker}"), LIKE_REPEAT_WINDOW) {
            return;
        }
        let push = self.clone();
        spawn_trigger(work, "like", async move {
            let Some((Some(author), content)) =
                social::post_author_and_content(&db, post_id).await?
            else {
                return Ok(());
            };
            if author == liker {
                return Ok(());
            }
            let username = profile::username_or_unknown(&db, liker).await?;
            let message = PushMessage {
                title: format!("{username} liked your post"),
                body: preview(&content),
                data: json!({ "type": "post_like", "post_id": post_id }),
            };
            push.send_to_users(&db, &[author], &message).await;
            Ok(())
        });
    }

    /// Tells the author's friends about their new post. Posts are public, so
    /// every completed friend gets it.
    pub fn notify_friend_post(
        &self,
        db: DatabaseConnection,
        work: &BackgroundTasks,
        author: Uuid,
        post_id: i64,
        content: String,
    ) {
        let push = self.clone();
        spawn_trigger(work, "friend post", async move {
            let friends = friend_relations::friend_ids(&db, author).await?;
            if friends.is_empty() {
                return Ok(());
            }
            let username = profile::username_or_unknown(&db, author).await?;
            let message = PushMessage {
                title: format!("new post from {username}"),
                body: preview(&content),
                data: json!({ "type": "friend_post", "post_id": post_id }),
            };
            push.send_to_users(&db, &friends, &message).await;
            Ok(())
        });
    }

    /// Tells the host's friends they went live. Only call it for a session
    /// that was just created, and not a listen along one. Friends see a live
    /// session through the host's `now_playing` audience, so a host who set
    /// it to `nobody` sends nothing.
    pub fn notify_live_start(
        &self,
        db: DatabaseConnection,
        work: &BackgroundTasks,
        host: Uuid,
        session_id: Uuid,
        name: String,
    ) {
        let push = self.clone();
        spawn_trigger(work, "live start", async move {
            let settings = privacy::get_privacy(&db, host).await?;
            if PrivacyField::NowPlaying.read(&settings) == Audience::Nobody {
                return Ok(());
            }
            let friends = friend_relations::friend_ids(&db, host).await?;
            if friends.is_empty() {
                return Ok(());
            }
            let username = profile::username_or_unknown(&db, host).await?;
            let message = PushMessage {
                title: format!("{username} started a live session"),
                body: name,
                data: json!({ "type": "live_session", "session_id": session_id }),
            };
            push.send_to_users(&db, &friends, &message).await;
            Ok(())
        });
    }
}

/// Runs `trigger` on a background task and logs its error, if any.
fn spawn_trigger<F>(work: &BackgroundTasks, label: &'static str, trigger: F)
where
    F: Future<Output = Result<(), CadenzaError>> + Send + 'static,
{
    work.spawn(async move {
        if let Err(err) = trigger.await {
            eprintln!("{LOG_TAG}: {label} push failed: {err}");
        }
    });
}

/// The first [`PREVIEW_CHARS`] characters of `text`, with `...` when cut.
fn preview(text: &str) -> String {
    let text = text.trim();
    let mut chars = text.chars();
    let cut: String = chars.by_ref().take(PREVIEW_CHARS).collect();
    if chars.next().is_some() {
        format!("{}...", cut.trim_end())
    } else {
        cut
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_cuts_long_text() {
        assert_eq!(preview("  short  "), "short");
        let long = "a".repeat(PREVIEW_CHARS + 5);
        assert_eq!(preview(&long), format!("{}...", "a".repeat(PREVIEW_CHARS)));
        assert_eq!(
            preview(&"a".repeat(PREVIEW_CHARS)),
            "a".repeat(PREVIEW_CHARS)
        );
    }

    #[test]
    fn a_repeated_like_pushes_once() {
        let push = PushService::new();
        assert!(push.first_in("like:1:a".into(), LIKE_REPEAT_WINDOW));
        assert!(!push.first_in("like:1:a".into(), LIKE_REPEAT_WINDOW));
        assert!(push.first_in("like:1:b".into(), LIKE_REPEAT_WINDOW));
    }
}
