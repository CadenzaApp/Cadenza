//! Bounded, process-local admission. All counters reset on restart.
use crate::{AppState, auth::SupabaseClaims, err::CadenzaError};
use axum::{
    extract::{OriginalUri, Request, State},
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_jwt_auth::Claims;
use sea_orm::prelude::Uuid;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::Semaphore;

struct Config {
    requests: u32,
    paid_minute: u32,
    paid_day: u32,
    provider_day: u32,
    provider_concurrency: u32,
}
fn config() -> &'static Config {
    static CONFIG: OnceLock<Config> = OnceLock::new();
    CONFIG.get_or_init(|| {
        fn setting(name: &str, default: u32) -> u32 {
            let value = match std::env::var(name) {
                Ok(value) => value
                    .parse::<u32>()
                    .unwrap_or_else(|_| panic!("{name} must be a positive integer")),
                Err(std::env::VarError::NotPresent) => default,
                Err(_) => panic!("invalid {name}"),
            };
            assert!(
                value > 0 && value <= 1_000_000,
                "{name} must be between 1 and 1000000"
            );
            value
        }
        Config {
            requests: setting("API_REQUESTS_PER_USER_MINUTE", 600),
            paid_minute: setting("TAG_REQUESTS_PER_USER_MINUTE", 30),
            paid_day: setting("TAG_REQUESTS_PER_USER_DAY", 1000),
            provider_day: setting("TAG_PROVIDER_CALLS_PER_DAY", 7000),
            provider_concurrency: setting("TAG_PROVIDER_CONCURRENCY", 2),
        }
    })
}
pub fn init() {
    config();
}

#[derive(Default)]
struct Window {
    started: Option<Instant>,
    used: u32,
}
impl Window {
    fn available(&mut self, now: Instant, period: Duration, limit: u32) -> bool {
        if self
            .started
            .is_none_or(|start| now.duration_since(start) >= period)
        {
            self.started = Some(now);
            self.used = 0;
        }
        self.used < limit
    }
}
struct User {
    seen: Instant,
    requests: Window,
    paid_minute: Window,
    paid_day: Window,
}
#[derive(Default)]
struct Limits {
    users: HashMap<Uuid, User>,
    provider_day: Window,
}
impl Limits {
    fn admit(&mut self, user: Uuid, paid: bool, now: Instant) -> bool {
        // Expiry preserves the full daily quota window. Never evict an active quota
        // just to admit a new ID; fail closed when the bounded map is full.
        if !self.users.contains_key(&user) {
            self.users
                .retain(|_, v| now.duration_since(v.seen) < Duration::from_secs(86400));
            if self.users.len() >= 10000 {
                return false;
            }
        }
        let user = self.users.entry(user).or_insert_with(|| User {
            seen: now,
            requests: Window::default(),
            paid_minute: Window::default(),
            paid_day: Window::default(),
        });
        user.seen = now;
        if !user
            .requests
            .available(now, Duration::from_secs(60), config().requests)
        {
            return false;
        }
        user.requests.used += 1;
        if paid {
            if !user
                .paid_minute
                .available(now, Duration::from_secs(60), config().paid_minute)
                || !user
                    .paid_day
                    .available(now, Duration::from_secs(86400), config().paid_day)
            {
                return false;
            }
            user.paid_minute.used += 1;
            user.paid_day.used += 1;
        }
        true
    }
}
fn limits() -> &'static Mutex<Limits> {
    static LIMITS: OnceLock<Mutex<Limits>> = OnceLock::new();
    LIMITS.get_or_init(Default::default)
}

pub async fn admit(
    State(_state): State<AppState>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    OriginalUri(uri): OriginalUri,
    request: Request,
    next: Next,
) -> Response {
    let paid = matches!(
        uri.path(),
        "/tags/suggest" | "/songs/default-tags" | "/songs/default-tags/batch"
    ) && request.method() != axum::http::Method::DELETE;
    if !limits()
        .lock()
        .expect("admission limits")
        .admit(claims.user_id, paid, Instant::now())
    {
        return CadenzaError::RateLimited.into_response();
    }
    next.run(request).await
}

/// Runs before JWT verification. Health routes are merged outside this layer.
pub async fn capacity(request: Request, next: Next) -> Response {
    static ACTIVE: Semaphore = Semaphore::const_new(64);
    let Ok(_permit) = ACTIVE.try_acquire() else {
        return CadenzaError::ServiceUnavailable.into_response();
    };
    next.run(request).await
}

/// Counts actual attempted provider calls, including background jobs and failures.
pub fn provider_call() -> Result<tokio::sync::SemaphorePermit<'static>, CadenzaError> {
    static ACTIVE: OnceLock<Semaphore> = OnceLock::new();
    let active = ACTIVE.get_or_init(|| Semaphore::new(config().provider_concurrency as usize));
    let permit = active
        .try_acquire()
        .map_err(|_| CadenzaError::ServiceUnavailable)?;
    let mut limits = limits().lock().expect("admission limits");
    if !limits.provider_day.available(
        Instant::now(),
        Duration::from_secs(86400),
        config().provider_day,
    ) {
        return Err(CadenzaError::RateLimited);
    }
    limits.provider_day.used += 1;
    Ok(permit)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paid_limits_are_per_user_and_reset_after_the_window() {
        let mut limits = Limits::default();
        let now = Instant::now();
        let id = Uuid::new_v4();
        for _ in 0..30 {
            assert!(limits.admit(id, true, now));
        }
        assert!(!limits.admit(id, true, now));
        assert!(limits.admit(Uuid::new_v4(), true, now));
        assert!(limits.admit(id, true, now + Duration::from_secs(60)));
        for minute in 1..36 {
            for _ in 0..30 {
                limits.admit(id, true, now + Duration::from_secs(minute * 60));
            }
        }
        assert!(!limits.admit(id, true, now + Duration::from_secs(2400)));
        assert!(limits.admit(id, true, now + Duration::from_secs(86400)));
    }
    #[test]
    fn window_refusals_do_not_extend_the_window() {
        let mut window = Window::default();
        let now = Instant::now();
        assert!(window.available(now, Duration::from_secs(60), 1));
        window.used += 1;
        assert!(!window.available(now, Duration::from_secs(60), 1));
        assert!(window.available(now + Duration::from_secs(60), Duration::from_secs(60), 1));
    }
}
