use serde::{Deserialize, Serialize};
use serde_json::Value;

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
}
