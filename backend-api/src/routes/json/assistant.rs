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
}

#[derive(Deserialize, Debug, Clone)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
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
    /// sends the conversation back with the result. Not produced until the
    /// phone-side tools exist.
    #[allow(dead_code)]
    ClientToolCall {
        call_id: String,
        name: String,
        arguments: Value,
    },
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct AssistantStep {
    /// The tool's name, like `run_query`.
    pub tool: String,
    /// What to show the user, like "Ran a query".
    pub label: String,
}

/// Songs a tool found, for the song card under an answer.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct SongsCard {
    /// In the order the tool returned them. At most `MAX_CARD_SONGS`.
    pub song_ids: Vec<String>,
    /// How many songs matched in all, which can be more than `song_ids`.
    pub total: usize,
    /// True when the match itself was cut off, so `total` is a lower bound.
    pub capped: bool,
}
