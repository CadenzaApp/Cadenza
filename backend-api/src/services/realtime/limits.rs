//! Per-process socket admission. Guards release capacity on disconnect or cancellation.
use sea_orm::prelude::Uuid;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

pub const CONNECTIONS: usize = 128;
const PER_USER: usize = 4;

fn users() -> &'static Mutex<HashMap<Uuid, usize>> {
    static USERS: OnceLock<Mutex<HashMap<Uuid, usize>>> = OnceLock::new();
    USERS.get_or_init(Default::default)
}

pub struct UserSlot(Uuid);
impl UserSlot {
    pub fn acquire(id: Uuid) -> Option<Self> {
        let mut users = users().lock().unwrap();
        let count = users.entry(id).or_default();
        if *count >= PER_USER {
            return None;
        }
        *count += 1;
        Some(Self(id))
    }
}
impl Drop for UserSlot {
    fn drop(&mut self) {
        let mut users = users().lock().unwrap();
        let count = users.get_mut(&self.0).unwrap();
        *count -= 1;
        if *count == 0 {
            users.remove(&self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sockets_are_limited_per_user_and_released_on_drop() {
        let id = Uuid::new_v4();
        let mut held: Vec<_> = (0..PER_USER)
            .map(|_| UserSlot::acquire(id).unwrap())
            .collect();
        assert!(UserSlot::acquire(id).is_none());
        assert!(UserSlot::acquire(Uuid::new_v4()).is_some());
        held.pop();
        assert!(UserSlot::acquire(id).is_some());
        drop(held);
        assert!(!users().lock().unwrap().contains_key(&id));
    }
}
