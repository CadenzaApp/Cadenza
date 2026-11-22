//! Live session chat. Anyone in an open session, any role, posts and reads it,
//! including what was said before they joined. Chat is not part of the
//! session snapshot and never bumps `live_sessions.version`; the route
//! publishes each new message on the session topic instead.

use sea_orm::{
    ActiveValue::{NotSet, Set},
    ColumnTrait, EntityTrait, FromQueryResult, JoinType, QueryFilter, QueryOrder, QuerySelect,
    prelude::{DateTimeWithTimeZone, Uuid},
    sea_query::{Expr, Func},
};

use crate::db::{
    Db,
    entity::{live_session_messages as messages, profile},
    live_sessions::check_in_open_session,
};
use crate::err::CadenzaError;

/// Longest message, in characters. The table checks the same.
pub const MAX_BODY_CHARS: usize = 1000;

/// Page size when the caller names none.
const DEFAULT_PAGE: u64 = 50;
/// Largest page a caller can ask for.
const MAX_PAGE: u64 = 100;

/// One message with its sender's username, `"unknown"` once the profile is
/// gone.
#[derive(Debug, Clone, FromQueryResult)]
pub struct ChatMessage {
    pub message_id: i64,
    pub user_id: Option<Uuid>,
    pub username: String,
    pub body: String,
    pub sent_at: DateTimeWithTimeZone,
}

/// Newest first. `next_before` is the id to pass for the next older page.
pub struct ChatPage {
    pub messages: Vec<ChatMessage>,
    pub next_before: Option<i64>,
}

/// `body` trimmed, or `InvalidRequestBody` when it is empty or too long.
fn clean_body(body: &str) -> Result<&str, CadenzaError> {
    let body = body.trim();
    if body.is_empty() {
        return Err(CadenzaError::InvalidRequestBody(
            "message is empty".to_string(),
        ));
    }
    if body.chars().count() > MAX_BODY_CHARS {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "message is over {MAX_BODY_CHARS} characters"
        )));
    }
    Ok(body)
}

/// Messages joined to their sender's username.
fn with_username() -> sea_orm::Select<messages::Entity> {
    messages::Entity::find()
        .select_only()
        .column(messages::Column::MessageId)
        .column(messages::Column::UserId)
        .column(messages::Column::Body)
        .column(messages::Column::SentAt)
        .expr_as(
            Func::coalesce([
                Expr::col((profile::Entity, profile::Column::Username)),
                Expr::val("unknown"),
            ]),
            "username",
        )
        .join(
            JoinType::LeftJoin,
            messages::Entity::belongs_to(profile::Entity)
                .from(messages::Column::UserId)
                .to(profile::Column::Uid)
                .into(),
        )
}

/// Stores a message from `user_id`, who must be in the open session.
/// `NotFound` when they are not, `SessionEnded` once it is over.
pub async fn send_message(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    body: &str,
) -> Result<ChatMessage, CadenzaError> {
    let body = clean_body(body)?;
    check_in_open_session(db, session_id, user_id).await?;
    let inserted = messages::Entity::insert(messages::ActiveModel {
        message_id: NotSet,
        session_id: Set(session_id),
        user_id: Set(Some(user_id)),
        body: Set(body.to_string()),
        sent_at: NotSet,
    })
    .exec(db)
    .await?;
    with_username()
        .filter(messages::Column::MessageId.eq(inserted.last_insert_id))
        .into_model::<ChatMessage>()
        .one(db)
        .await?
        .ok_or(CadenzaError::NotFound)
}

/// One page of the session's chat, newest first, older than `before` when
/// given. `user_id` must be in the open session.
pub async fn list_messages(
    db: &impl Db,
    user_id: Uuid,
    session_id: Uuid,
    before: Option<i64>,
    limit: Option<u64>,
) -> Result<ChatPage, CadenzaError> {
    check_in_open_session(db, session_id, user_id).await?;
    let limit = limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let mut query = with_username().filter(messages::Column::SessionId.eq(session_id));
    if let Some(before) = before {
        query = query.filter(messages::Column::MessageId.lt(before));
    }
    // one extra row says whether an older page exists
    let mut rows = query
        .order_by_desc(messages::Column::MessageId)
        .limit(limit + 1)
        .into_model::<ChatMessage>()
        .all(db)
        .await?;
    let more = rows.len() as u64 > limit;
    rows.truncate(limit as usize);
    let next_before = if more {
        rows.last().map(|message| message.message_id)
    } else {
        None
    };
    Ok(ChatPage {
        messages: rows,
        next_before,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bodies_are_trimmed_and_bounded() {
        assert_eq!(clean_body("  hi  ").unwrap(), "hi");
        assert!(clean_body("   ").is_err());
        assert!(clean_body(&"a".repeat(MAX_BODY_CHARS)).is_ok());
        assert!(clean_body(&"a".repeat(MAX_BODY_CHARS + 1)).is_err());
        // characters, not bytes
        assert!(clean_body(&"\u{e9}".repeat(MAX_BODY_CHARS)).is_ok());
    }
}
