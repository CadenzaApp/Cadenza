use axum::{Json, Router, extract::State, routing::post};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;

use crate::{
    AppState,
    auth::SupabaseClaims,
    err::CadenzaError,
    routes::json::assistant::{AssistantRequest, AssistantResponse},
    services::assistant::AssistantService,
};

/// Answers the last message in a conversation with the assistant.
///
/// The phone sends the whole conversation each time; nothing is stored. The
/// assistant can call read-only tools (tags, queries, song metadata, top
/// plays, listening totals) before it answers, up to 8 model calls. A user
/// may send 20 messages per 10 minutes and 150 per day; past that it returns
/// 429 `UserRateLimited` with `retry_after_secs`.
///
/// Request JSON:
/// ```json
/// {
///   "messages": [
///     { "role": "user", "content": "how many tags do I have?" }
///   ],
///   "time_zone": "America/Denver",
///   "now": "2026-11-11T17:53:00-07:00"
/// }
/// ```
///
/// JSON return value format:
/// ```json
/// {
///   "type": "reply",
///   "text": "You have 84 songs tagged chill that aren't pop.",
///   "steps": [{ "tool": "run_query", "label": "Ran a query" }],
///   "songs": { "song_ids": ["1440857781"], "total": 84, "capped": false }
/// }
/// ```
///
/// `songs` is left out when no tool found songs. A later `type` of
/// `client_tool_call` will ask the phone to run a tool only it can, like
/// playback.
async fn post_message_handler(
    State(db): State<DatabaseConnection>,
    State(assistant_service): State<AssistantService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<AssistantRequest>,
) -> Result<Json<AssistantResponse>, CadenzaError> {
    let response = assistant_service.answer(&db, claims.user_id, body).await?;
    Ok(Json(response))
}

pub fn get_assistant_router() -> Router<AppState> {
    Router::new().route("/messages", post(post_message_handler))
}
