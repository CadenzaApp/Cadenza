//! Invite code generation and the redeem rate limit. Storing and redeeming
//! codes is `db/invites.rs`.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use sea_orm::prelude::Uuid;

/// No `0 O 1 I L`, so a code read aloud or off a screen cannot be misread.
pub const CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";

pub const CODE_LENGTH: usize = 8;

/// A fresh random code. Random bytes from a v4 uuid, with any byte past the
/// last whole multiple of the alphabet thrown away so every letter is equally
/// likely.
pub fn generate_code() -> String {
    let limit = (256 / CODE_ALPHABET.len() * CODE_ALPHABET.len()) as u8;
    let mut code = String::with_capacity(CODE_LENGTH);
    while code.len() < CODE_LENGTH {
        for byte in Uuid::new_v4().into_bytes() {
            if byte < limit && code.len() < CODE_LENGTH {
                code.push(CODE_ALPHABET[byte as usize % CODE_ALPHABET.len()] as char);
            }
        }
    }
    code
}

/// A code as a user typed it: trimmed, uppercased, spaces and dashes dropped.
pub fn normalize_code(input: &str) -> String {
    input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_ascii_uppercase()
}

/// Redeems allowed per user per window, so a code cannot be guessed by trying
/// them all. 31^8 codes makes guessing hopeless at this rate.
pub const REDEEMS_PER_WINDOW: usize = 10;
pub const REDEEM_WINDOW: Duration = Duration::from_secs(60);

/// Per user sliding window of redeem attempts. In memory, so it resets on a
/// restart, which is fine for its job.
#[derive(Clone, Default)]
pub struct RedeemLimiter {
    attempts: Arc<Mutex<HashMap<Uuid, Vec<Instant>>>>,
}

impl RedeemLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records an attempt and returns whether it is allowed.
    pub fn allow(&self, user_id: Uuid) -> bool {
        self.allow_at(user_id, Instant::now())
    }

    fn allow_at(&self, user_id: Uuid, now: Instant) -> bool {
        let mut attempts = self.attempts.lock().unwrap();
        attempts.retain(|_, times| {
            times.retain(|at| now.duration_since(*at) < REDEEM_WINDOW);
            !times.is_empty()
        });
        let times = attempts.entry(user_id).or_default();
        if times.len() >= REDEEMS_PER_WINDOW {
            return false;
        }
        times.push(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_use_only_the_alphabet() {
        for _ in 0..50 {
            let code = generate_code();
            assert_eq!(code.len(), CODE_LENGTH);
            assert!(code.bytes().all(|b| CODE_ALPHABET.contains(&b)));
        }
    }

    #[test]
    fn typed_codes_normalize() {
        assert_eq!(normalize_code(" abcd-efgh "), "ABCDEFGH");
    }

    #[test]
    fn limiter_allows_a_window_then_refuses() {
        let limiter = RedeemLimiter::new();
        let user = Uuid::from_u128(1);
        let start = Instant::now();
        for _ in 0..REDEEMS_PER_WINDOW {
            assert!(limiter.allow_at(user, start));
        }
        assert!(!limiter.allow_at(user, start));
        assert!(limiter.allow_at(Uuid::from_u128(2), start));
        assert!(limiter.allow_at(user, start + REDEEM_WINDOW));
    }
}
