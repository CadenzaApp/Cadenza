use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::assistant_actions::ActionRow;

/// The body of `POST /assistant/messages`.
///
/// The phone keeps the conversation and sends all of it each time, so the
/// server stores nothing between messages.
#[derive(Deserialize, Debug)]
pub struct AssistantRequest {
    /// The conversation so far, oldest first. The last message is the user's.
    pub messages: Vec<ChatMessage>,
    /// The phone's IANA time zone, like `America/Denver`. Used to turn "last
    /// week" into dates. Defaults to UTC.
    #[serde(default)]
    pub time_zone: Option<String>,
    /// The phone's local time as RFC 3339 with its offset, like
    /// `2026-11-11T17:53:00-07:00`. Defaults to the server's clock in UTC.
    #[serde(default)]
    pub now: Option<String>,
    /// Set when this request carries the result of a phone tool: the
    /// `continuation` the last `client_tool_call` returned, as it came, and
    /// what the tool did. `messages` is the same conversation as before.
    #[serde(default)]
    pub resume: Option<Resume>,
    /// The phone's query builder settings as they are now, so the songs a query finds
    /// match what the builder would show for it. Both off when left out.
    #[serde(default)]
    pub query_settings: BuilderSettings,
}

/// The query builder settings that change which songs a query matches.
#[derive(Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BuilderSettings {
    /// Show songs only in library or tagged: a query runs over the user's library and
    /// tagged songs alone.
    #[serde(default)]
    pub library_or_tagged: bool,
    /// Include suggested tags: a song's shared default tags count as tags on it.
    #[serde(default)]
    pub include_suggested: bool,
}

/// A phone tool's result, sent back to carry on the answer it was part of.
#[derive(Deserialize, Debug, Clone)]
pub struct Resume {
    pub continuation: Continuation,
    /// What the tool returned, as JSON, for the model to read. A song list
    /// can come as `card: {song_ids, total, title?}`, which becomes the card
    /// under the answer instead of going to the model.
    pub output: Value,
}

/// Where an answer stopped to wait for a phone tool. The phone sends it back
/// unchanged with the tool's output, so the server keeps nothing in between.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Continuation {
    /// This answer's tool calls and their outputs so far, as Responses API
    /// input items, ending with the phone tool's call.
    pub items: Vec<Value>,
    /// The status rows so far.
    pub steps: Vec<AssistantStep>,
    /// The card so far.
    #[serde(default)]
    pub songs: Option<SongsCard>,
    /// The changes this answer made so far, for the done cards.
    #[serde(default)]
    pub actions: Vec<ActionSummary>,
    /// Model calls this answer has used, out of `MAX_STEPS`.
    pub steps_used: usize,
    /// The phone tool's call, which the output answers.
    pub call_id: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
    /// For an assistant message, the song ids on the card under it, in order,
    /// so a follow-up can mean "those songs". Ignored on a user's message.
    #[serde(default)]
    pub song_ids: Vec<String>,
    /// For an assistant message whose card came from `run_query`, that card's query, so
    /// "save that query" can save it.
    #[serde(default)]
    pub card_query: Option<CardQuery>,
}

#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
}

/// What `POST /assistant/messages` returns.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AssistantResponse {
    /// The assistant's answer.
    Reply {
        text: String,
        /// What the assistant did on the way, in order, for the status rows.
        steps: Vec<AssistantStep>,
        /// Songs to show under the answer, from the last tool that found some.
        #[serde(skip_serializing_if = "Option::is_none")]
        songs: Option<SongsCard>,
        /// The changes the user confirmed in this answer, each a done card with Undo.
        #[serde(skip_serializing_if = "Vec::is_empty")]
        actions: Vec<ActionSummary>,
    },
    /// A change the assistant wants to make, which waits for the user. The phone shows
    /// `preview` as a confirm card and sends the same conversation back with `resume`:
    /// this `continuation` and `{confirmed: true}` or `{confirmed: false}`. Only then
    /// does the server make the change.
    PendingAction {
        call_id: String,
        name: String,
        preview: WritePreview,
        continuation: Continuation,
    },
    /// A tool only the phone can run, like playback. The phone runs it and
    /// sends the same conversation back with `resume`: this `continuation`
    /// and the tool's output.
    ClientToolCall {
        call_id: String,
        name: String,
        arguments: Value,
        continuation: Continuation,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct AssistantStep {
    /// The tool's name, like `run_query`.
    pub tool: String,
    /// What to show the user, like "Ran a query".
    pub label: String,
}

/// Songs a tool found, for the song card under an answer.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct SongsCard {
    /// In the order the tool returned them. At most `MAX_CARD_SONGS`.
    pub song_ids: Vec<String>,
    /// How many songs matched in all, which can be more than `song_ids`.
    pub total: usize,
    /// True when the match itself was cut off, so `total` is a lower bound.
    #[serde(default)]
    pub capped: bool,
    /// A short name for the list, shown as its title when the user opens it:
    /// the model's for a search or top songs, the real name for a saved query
    /// or playlist. Absent when there is none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The query behind a card from `run_query`, so tapping the card loads it into the
    /// query builder. Absent for every other card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<CardQuery>,
}

/// A `run_query` card's query, and everything that decided its songs, so the phone can
/// load it into the query builder and show the same results there.
///
/// ```json
/// {
///   "query": { "where": { "and": [{ "filter": { "field": "tag", "tag_id": 4, "op": "is_applied" } }] } },
///   "builder": "simple",
///   "library_or_tagged": false,
///   "include_suggested": false,
///   "sort": { "field": "metadata", "key": "release_date", "direction": "descending" },
///   "limit": 20
/// }
/// ```
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct CardQuery {
    /// The query in the wire format of `POST /queries/results`, as the model wrote it.
    pub query: Value,
    /// The builder it loads into: `simple` when that one can hold it, otherwise `advanced`.
    pub builder: String,
    /// It ran over the user's library and tagged songs alone.
    pub library_or_tagged: bool,
    /// A song's shared default tags counted as tags on it.
    pub include_suggested: bool,
    /// The sort it ran with, in the `sort` shape of `POST /queries/results`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<Value>,
    /// The group it ran with, in the same shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<Value>,
    /// How many songs it kept, when it kept only the first ones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

/// What a confirm card says before a change.
///
/// ```json
/// { "title": "Apply pop to 1,243 songs?", "detail": "Purple Rain, Redbone, and 1,241 more. 87 already have it.", "confirm_label": "Apply" }
/// ```
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct WritePreview {
    pub title: String,
    pub detail: String,
    pub confirm_label: String,
}

/// One change in the assistant's activity log, as a done card and a log row show it.
///
/// ```json
/// {
///   "id": 12,
///   "kind": "apply_tag",
///   "summary": "Applied pop to 1,156 songs",
///   "undoable": true,
///   "target": { "kind": "tag", "id": "4", "name": "pop" },
///   "created_at": "2026-11-18T17:53:00-07:00",
///   "undone": false
/// }
/// ```
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ActionSummary {
    pub id: i64,
    pub kind: String,
    pub summary: String,
    /// False for a change Cadenza cannot reverse, like an Apple Music playlist add.
    pub undoable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<ActionTarget>,
    pub created_at: String,
    #[serde(default)]
    pub undone: bool,
    /// What Undo did, like "Left 2 songs you changed since".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_result: Option<String>,
}

/// What a change was made to.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ActionTarget {
    /// `tag`, `saved_query`, `shared_playlist`, or `apple_music_playlist`.
    pub kind: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl From<&ActionRow> for ActionSummary {
    fn from(row: &ActionRow) -> Self {
        Self {
            id: row.action_id,
            kind: row.kind.clone(),
            summary: row.summary.clone(),
            undoable: row.undoable,
            target: match (&row.target_kind, &row.target_id) {
                (Some(kind), Some(id)) => Some(ActionTarget {
                    kind: kind.clone(),
                    id: id.clone(),
                    name: row.target_name.clone(),
                }),
                _ => None,
            },
            created_at: row.created_at.to_rfc3339(),
            undone: row.undone_at.is_some(),
            undo_result: row.undo_result.clone(),
        }
    }
}

/// What `GET /assistant/actions` returns: the user's log, newest first.
#[derive(Serialize, Debug)]
pub struct ActionList {
    pub actions: Vec<ActionSummary>,
}

/// What `POST /assistant/actions/{id}/undo` returns: the row, now undone, and what the
/// undo did in words.
#[derive(Serialize, Debug)]
pub struct UndoResult {
    pub action: ActionSummary,
    pub message: String,
}
