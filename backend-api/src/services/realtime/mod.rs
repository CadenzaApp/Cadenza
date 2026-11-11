//! Realtime push. Postgres holds every durable state; this mostly tells
//! subscribers that something changed, so they refetch it over HTTP. The one
//! exception is a live session's `playback` event, which carries the new
//! playback so a pause or seek lands without a refetch. Only members can
//! subscribe to a session topic, and they could read the same over HTTP.
//!
//! Mutations never go over the socket. A handler writes through `db/`, then
//! publishes an [`Event`] naming the topic and its new version. The socket
//! route (`routes/realtime.rs`) checks access before it subscribes anyone,
//! and an event carries no private data, so the audience checks stay in the
//! HTTP reads.
//!
//! The transport is the [`EventBus`] trait, so the in memory bus can be swapped
//! for a postgres `LISTEN/NOTIFY` one when there is more than one backend
//! instance, without touching anything that publishes or subscribes.
pub mod access;
pub mod memory_bus;
pub mod presence;

use std::sync::Arc;

use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::broadcast;

pub use memory_bus::InMemoryBus;
pub use presence::{InMemoryPresence, SharedPresence};

/// What a subscriber listens to.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
pub enum Topic {
    /// One user's now playing.
    User(Uuid),
    /// One live session: its state, queue, and members.
    LiveSession(Uuid),
    /// One shared playlist: its songs, members, and details.
    SharedPlaylist(i64),
}

/// One change. `version` is the topic's version after the change, so a
/// client that sees a gap refetches. `data` is small and never private.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Event {
    pub topic: Topic,
    pub version: i64,
    pub kind: String,
    pub data: Value,
}

impl Event {
    pub fn new(topic: Topic, version: i64, kind: &str) -> Self {
        Self {
            topic,
            version,
            kind: kind.to_owned(),
            data: Value::Null,
        }
    }

    pub fn with_data(mut self, data: Value) -> Self {
        self.data = data;
        self
    }
}

/// How events get from a publisher to subscribers.
pub trait EventBus: Send + Sync {
    /// Sends `event` to everyone subscribed to its topic. No subscribers is a
    /// no-op.
    fn publish(&self, event: Event);

    /// Starts receiving events for `topic`.
    fn subscribe(&self, topic: &Topic) -> broadcast::Receiver<Event>;
}

/// The bus as `AppState` holds it.
pub type SharedEventBus = Arc<dyn EventBus>;

/// Publishes that `topic` is now at `version`. The kinds a client acts on:
/// `now_playing`, `presence`, `live_session`, `playlist`, `session`,
/// `playback`, and `ended`.
pub fn publish_version(bus: &SharedEventBus, topic: Topic, version: i64, kind: &str) {
    bus.publish(Event::new(topic, version, kind));
}
