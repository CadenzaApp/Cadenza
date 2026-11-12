//! The [`EventBus`] for one backend instance: a broadcast channel per topic,
//! dropped once nobody listens to it.

use std::{collections::HashMap, sync::Mutex};

use tokio::sync::broadcast;

use super::{Event, EventBus, Topic};

/// Events a slow subscriber can fall behind by before it is told it lagged.
const CHANNEL_CAPACITY: usize = 64;

#[derive(Default)]
pub struct InMemoryBus {
    channels: Mutex<HashMap<Topic, broadcast::Sender<Event>>>,
}

impl InMemoryBus {
    pub fn new() -> Self {
        Self::default()
    }

    /// Topics with a live channel. For tests.
    #[cfg(test)]
    fn topic_count(&self) -> usize {
        self.channels.lock().unwrap().len()
    }
}

impl EventBus for InMemoryBus {
    fn publish(&self, event: Event) {
        let mut channels = self.channels.lock().unwrap();
        let Some(sender) = channels.get(&event.topic) else {
            return;
        };
        if sender.receiver_count() == 0 {
            channels.remove(&event.topic);
            return;
        }
        // only fails with no receivers, which was checked under the lock
        let _ = sender.send(event);
    }

    fn subscribe(&self, topic: &Topic) -> broadcast::Receiver<Event> {
        let mut channels = self.channels.lock().unwrap();
        // drop channels everyone has left, so the map does not grow forever
        channels.retain(|_, sender| sender.receiver_count() > 0);
        channels
            .entry(topic.clone())
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0)
            .subscribe()
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::prelude::Uuid;

    use super::*;
    use crate::services::realtime::EventKind;

    #[tokio::test]
    async fn subscribers_get_their_topic_only() {
        let bus = InMemoryBus::new();
        let a = Topic::User(Uuid::from_u128(1));
        let b = Topic::User(Uuid::from_u128(2));
        let mut rx = bus.subscribe(&a);

        bus.publish(Event::new(b.clone(), 1, EventKind::NowPlaying));
        bus.publish(Event::new(a.clone(), 7, EventKind::NowPlaying));

        let got = rx.recv().await.unwrap();
        assert_eq!(got.topic, a);
        assert_eq!(got.version, 7);
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn channels_go_away_when_nobody_listens() {
        let bus = InMemoryBus::new();
        let topic = Topic::LiveSession(Uuid::from_u128(3));
        drop(bus.subscribe(&topic));
        bus.publish(Event::new(topic, 1, EventKind::Session));
        assert_eq!(bus.topic_count(), 0);
    }

    #[test]
    fn topics_read_as_kind_and_id() {
        let topic: Topic =
            serde_json::from_value(serde_json::json!({ "kind": "shared_playlist", "id": 4 }))
                .unwrap();
        assert_eq!(topic, Topic::SharedPlaylist(4));
    }
}
