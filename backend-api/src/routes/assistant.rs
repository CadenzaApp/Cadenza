use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::assistant_actions,
    err::CadenzaError,
    routes::json::assistant::{
        ActionList, ActionSummary, AssistantRequest, AssistantResponse, UndoResult,
    },
    services::{
        assistant::{AssistantService, writes},
        realtime::SharedEventBus,
        song_metadata::SongMetadataService,
    },
};

/// Answers the last message in a conversation with the assistant.
///
/// The phone sends the whole conversation each time; nothing is stored. An
/// assistant message carries the song ids on its card, so a follow-up can mean
/// those songs. The
/// assistant can call read-only tools (tags, queries, song metadata, top
/// plays, listening totals) before it answers, up to 8 model calls. A user
/// may send 20 messages per 10 minutes and 150 per day; past that it returns
/// 429 `UserRateLimited` with `retry_after_secs`.
///
/// Request JSON:
/// ```json
/// {
///   "messages": [
///     { "role": "user", "content": "chill songs" },
///     { "role": "assistant", "content": "Here are 84.", "song_ids": ["1440857781"] },
///     { "role": "user", "content": "which of those are explicit?" }
///   ],
///   "time_zone": "America/Denver",
///   "now": "2026-11-11T17:53:00-07:00",
///   "query_settings": { "library_or_tagged": false, "include_suggested": false }
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
/// `songs` is left out when no tool found songs. A card from `run_query` also carries
/// `query` (see `json::assistant::CardQuery`), so tapping it can load the query into the
/// phone's query builder. `query_settings` is the builder's settings; `run_query` runs with
/// them unless the user asks otherwise. A later `type` of
/// `client_tool_call` will ask the phone to run a tool only it can, like
/// playback.
async fn post_message_handler(
    State(db): State<DatabaseConnection>,
    State(assistant_service): State<AssistantService>,
    State(song_meta_service): State<SongMetadataService>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<AssistantRequest>,
) -> Result<Json<AssistantResponse>, CadenzaError> {
    let response = assistant_service
        .answer(&db, &song_meta_service, &bus, claims.user_id, body)
        .await?;
    Ok(Json(response))
}

/// The changes the user confirmed in the assistant over the last 30 days (at most 100),
/// newest first: the activity log.
///
/// ```json
/// {
///   "actions": [
///     {
///       "id": 12,
///       "kind": "apply_tag",
///       "summary": "Applied pop to 1,156 songs",
///       "undoable": true,
///       "target": { "kind": "tag", "id": "4", "name": "pop" },
///       "created_at": "2026-11-18T17:53:00-07:00",
///       "undone": false
///     }
///   ]
/// }
/// ```
async fn list_actions_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<ActionList>, CadenzaError> {
    let rows = assistant_actions::list(&db, claims.user_id).await?;
    Ok(Json(ActionList {
        actions: rows.iter().map(ActionSummary::from).collect(),
    }))
}

/// Undoes one change from the activity log: reverses exactly what it did, leaving alone
/// anything changed since, and marks it undone. The Undo button on a done card and on a
/// log row. `CannotUndo` (409) for one already undone, one Cadenza cannot reverse (an
/// Apple Music playlist add), or a made tag still on songs; `NotFound` for one that is
/// not the caller's.
///
/// ```json
/// {
///   "action": { "id": 12, "kind": "apply_tag", "summary": "Applied pop to 1,156 songs", "undoable": true, "created_at": "...", "undone": true, "undo_result": "Took pop back off 1,154 songs. Left 2 songs you changed since" },
///   "message": "Took pop back off 1,154 songs. Left 2 songs you changed since"
/// }
/// ```
async fn undo_action_handler(
    State(work): State<crate::lifecycle::BackgroundTasks>,
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(action_id): Path<i64>,
) -> Result<Json<UndoResult>, CadenzaError> {
    let (row, message) = writes::undo(&db, &work, Some(&bus), claims.user_id, action_id).await?;
    Ok(Json(UndoResult {
        action: ActionSummary::from(&row),
        message,
    }))
}

pub fn get_assistant_router() -> Router<AppState> {
    Router::new()
        .route("/messages", post(post_message_handler))
        .route("/actions", get(list_actions_handler))
        .route("/actions/{action_id}/undo", post(undo_action_handler))
}
