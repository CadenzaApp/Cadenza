//! Who has the app open: a user counts as online while at least one of their
//! realtime sockets is up. The client closes its socket in the background, so
//! this is foreground presence. Behind the [`Presence`] trait for the same
//! reason as the bus: one instance keeps it in memory, several would need a
//! shared store.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

use sea_orm::prelude::Uuid;

pub trait Presence: Send + Sync {
    /// Counts one more socket for `user_id`. True when they just came online.
    fn connect(&self, user_id: Uuid) -> bool;

    /// Counts one socket fewer. True when that was their last one.
    fn disconnect(&self, user_id: Uuid) -> bool;

    /// The users in `user_ids` who are online.
    fn online_among(&self, user_ids: &[Uuid]) -> HashSet<Uuid>;
}

/// Presence as `AppState` holds it.
pub type SharedPresence = Arc<dyn Presence>;

#[derive(Default)]
pub struct InMemoryPresence {
    sockets: Mutex<HashMap<Uuid, usize>>,
}

impl InMemoryPresence {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Presence for InMemoryPresence {
    fn connect(&self, user_id: Uuid) -> bool {
        let mut sockets = self.sockets.lock().unwrap();
        let count = sockets.entry(user_id).or_insert(0);
        *count += 1;
        *count == 1
    }

    fn disconnect(&self, user_id: Uuid) -> bool {
        let mut sockets = self.sockets.lock().unwrap();
        let Some(count) = sockets.get_mut(&user_id) else {
            return false;
        };
        *count -= 1;
        if *count == 0 {
            sockets.remove(&user_id);
            true
        } else {
            false
        }
    }

    fn online_among(&self, user_ids: &[Uuid]) -> HashSet<Uuid> {
        let sockets = self.sockets.lock().unwrap();
        user_ids
            .iter()
            .filter(|id| sockets.contains_key(id))
            .copied()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn online_until_the_last_socket_closes() {
        let presence = InMemoryPresence::new();
        let ada = Uuid::from_u128(1);
        assert!(presence.connect(ada));
        assert!(!presence.connect(ada));
        assert!(!presence.disconnect(ada));
        assert_eq!(presence.online_among(&[ada]).len(), 1);
        assert!(presence.disconnect(ada));
        assert!(presence.online_among(&[ada]).is_empty());
        assert!(!presence.disconnect(ada));
    }
}
