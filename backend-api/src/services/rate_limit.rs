//! An in-memory sliding window rate limiter, keyed by anything hashable (a
//! user id, an ip). Counts live in this process only, so a restart or a second
//! instance starts every key fresh. Good enough to stop one account running up
//! a bill, not a hard quota.

use std::{
    collections::{HashMap, VecDeque},
    hash::Hash,
    sync::Mutex,
    time::{Duration, Instant},
};

/// At most `max` hits per `window`.
#[derive(Debug, Clone, Copy)]
pub struct Limit {
    pub max: usize,
    pub window: Duration,
}

/// How many keys the map holds before a check also drops keys with no recent
/// hits, so keys that never come back do not pile up.
const PRUNE_AT_KEYS: usize = 1024;

/// Admits a hit for a key only while every one of its limits has room.
pub struct RateLimiter<K> {
    limits: Vec<Limit>,
    /// Each key's hits inside the longest window, oldest first.
    hits: Mutex<HashMap<K, VecDeque<Instant>>>,
}

impl<K: Hash + Eq + Clone> RateLimiter<K> {
    pub fn new(limits: impl Into<Vec<Limit>>) -> Self {
        Self {
            limits: limits.into(),
            hits: Mutex::new(HashMap::new()),
        }
    }

    /// Records a hit for `key` and returns `Ok`, or returns how long until the
    /// key has room again and records nothing.
    pub fn check(&self, key: &K) -> Result<(), Duration> {
        self.check_at(key, Instant::now())
    }

    fn check_at(&self, key: &K, now: Instant) -> Result<(), Duration> {
        let longest = self
            .limits
            .iter()
            .map(|limit| limit.window)
            .max()
            .unwrap_or_default();
        let mut hits = self.hits.lock().unwrap_or_else(|err| err.into_inner());

        if hits.len() >= PRUNE_AT_KEYS {
            hits.retain(|_, times| {
                times
                    .back()
                    .is_some_and(|last| now.duration_since(*last) < longest)
            });
        }

        let times = hits.entry(key.clone()).or_default();
        while times
            .front()
            .is_some_and(|first| now.duration_since(*first) >= longest)
        {
            times.pop_front();
        }

        // the longest wait any full limit asks for
        let wait = self
            .limits
            .iter()
            .filter_map(|limit| {
                let inside: Vec<&Instant> = times
                    .iter()
                    .filter(|time| now.duration_since(**time) < limit.window)
                    .collect();
                // room opens when the oldest hit that keeps it full leaves
                (inside.len() >= limit.max).then(|| {
                    let blocking = inside[inside.len() - limit.max];
                    limit.window - now.duration_since(*blocking)
                })
            })
            .max();
        if let Some(wait) = wait {
            return Err(wait);
        }
        times.push_back(now);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: Duration = Duration::from_secs(60);

    #[test]
    fn admits_up_to_the_limit_then_says_how_long_to_wait() {
        let limiter = RateLimiter::new([Limit {
            max: 2,
            window: MINUTE,
        }]);
        let start = Instant::now();
        assert!(limiter.check_at(&1, start).is_ok());
        assert!(
            limiter
                .check_at(&1, start + Duration::from_secs(10))
                .is_ok()
        );
        assert_eq!(
            limiter.check_at(&1, start + Duration::from_secs(20)),
            Err(Duration::from_secs(40))
        );
        // the first hit has left the window
        assert!(limiter.check_at(&1, start + MINUTE).is_ok());
    }

    #[test]
    fn keys_are_counted_apart() {
        let limiter = RateLimiter::new([Limit {
            max: 1,
            window: MINUTE,
        }]);
        let now = Instant::now();
        assert!(limiter.check_at(&"a", now).is_ok());
        assert!(limiter.check_at(&"b", now).is_ok());
        assert!(limiter.check_at(&"a", now).is_err());
    }

    #[test]
    fn the_strictest_full_limit_sets_the_wait() {
        let limiter = RateLimiter::new([
            Limit {
                max: 3,
                window: MINUTE,
            },
            Limit {
                max: 3,
                window: MINUTE * 10,
            },
        ]);
        let start = Instant::now();
        for _ in 0..3 {
            assert!(limiter.check_at(&1, start).is_ok());
        }
        // the short window has emptied, the long one has not
        assert_eq!(limiter.check_at(&1, start + MINUTE * 2), Err(MINUTE * 8));
    }

    #[test]
    fn a_refused_hit_is_not_counted() {
        let limiter = RateLimiter::new([Limit {
            max: 1,
            window: MINUTE,
        }]);
        let start = Instant::now();
        assert!(limiter.check_at(&1, start).is_ok());
        for second in 1..30 {
            assert!(
                limiter
                    .check_at(&1, start + Duration::from_secs(second))
                    .is_err()
            );
        }
        assert!(limiter.check_at(&1, start + MINUTE).is_ok());
    }
}
