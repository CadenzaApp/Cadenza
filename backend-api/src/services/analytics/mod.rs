//! Listening analytics: what an event is, what can be computed from events, and
//! over what window.
//!
//! Three stages, each replaceable on its own:
//!
//! 1. This module defines the event types and the metrics. No SQL runs here.
//! 2. `db::events` writes events. `db::analytics` reads them, running the
//!    aggregates this module names.
//! 3. `routes::events` and `routes::analytics` are thin wrappers over those.

pub mod event_type;
pub mod metrics;

pub use event_type::EventType;
pub use metrics::{Bucket, Metric};

use chrono::{DateTime, Duration, Utc};

use crate::err::CadenzaError;

/// How far ahead of the server's clock an event's `occurred_at` may be before
/// the request is refused. Covers ordinary clock drift and nothing more, so a
/// client cannot write itself into next year and poison every trend.
pub const MAX_CLOCK_SKEW_MINUTES: i64 = 10;

/// The time range a metric is computed over. Both ends are optional, and all
/// time is the default.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimeWindow {
    /// Inclusive.
    pub since: Option<DateTime<Utc>>,
    /// Exclusive.
    pub until: Option<DateTime<Utc>>,
}

impl TimeWindow {
    pub const ALL_TIME: Self = Self {
        since: None,
        until: None,
    };

    pub fn new(
        since: Option<DateTime<Utc>>,
        until: Option<DateTime<Utc>>,
    ) -> Result<Self, CadenzaError> {
        if let (Some(since), Some(until)) = (since, until)
            && since >= until
        {
            return Err(CadenzaError::InvalidRequestBody(
                "since must be before until".to_owned(),
            ));
        }
        Ok(Self { since, until })
    }
}

/// Refuses an `occurred_at` further than [`MAX_CLOCK_SKEW_MINUTES`] ahead of
/// now. A client whose clock is behind is left alone: late events are ordinary,
/// future ones are not.
pub fn check_not_in_future(
    occurred_at: DateTime<Utc>,
    now: DateTime<Utc>,
    client_event_id: &str,
) -> Result<(), CadenzaError> {
    if occurred_at > now + Duration::minutes(MAX_CLOCK_SKEW_MINUTES) {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "event '{client_event_id}' has an occurred_at more than \
             {MAX_CLOCK_SKEW_MINUTES} minutes in the future"
        )));
    }
    Ok(())
}

/// Whether a string is a timezone postgres will accept, checked before it
/// reaches a query. Postgres raises on an unknown zone, which would turn one bad
/// client into a 500, so an unrecognized name falls back to UTC instead.
///
/// Deliberately loose: it only keeps out the shapes that are not zone names at
/// all. Postgres owns the real list.
pub fn sanitize_timezone(tz: &str) -> &str {
    let plausible = !tz.is_empty()
        && tz.len() <= 64
        && tz
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-' | '+'));
    if plausible { tz } else { "UTC" }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(iso: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(iso)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn a_backwards_window_is_refused() {
        let early = at("2026-01-01T00:00:00Z");
        let late = at("2026-02-01T00:00:00Z");
        assert!(TimeWindow::new(Some(late), Some(early)).is_err());
        assert!(TimeWindow::new(Some(early), Some(early)).is_err());
        assert!(TimeWindow::new(Some(early), Some(late)).is_ok());
        assert!(TimeWindow::new(None, None).is_ok());
        assert!(TimeWindow::new(Some(late), None).is_ok());
    }

    #[test]
    fn small_clock_drift_is_allowed() {
        let now = at("2026-01-01T12:00:00Z");
        let slightly_ahead = now + Duration::minutes(MAX_CLOCK_SKEW_MINUTES - 1);
        assert!(check_not_in_future(slightly_ahead, now, "a").is_ok());
    }

    #[test]
    fn the_far_future_is_refused() {
        let now = at("2026-01-01T12:00:00Z");
        let way_ahead = now + Duration::days(400);
        assert!(check_not_in_future(way_ahead, now, "a").is_err());
    }

    #[test]
    fn the_past_is_always_fine() {
        let now = at("2026-01-01T12:00:00Z");
        assert!(check_not_in_future(now - Duration::days(900), now, "a").is_ok());
    }

    #[test]
    fn timezones_fall_back_to_utc() {
        assert_eq!(sanitize_timezone("America/Denver"), "America/Denver");
        assert_eq!(sanitize_timezone("UTC"), "UTC");
        assert_eq!(sanitize_timezone("Etc/GMT+7"), "Etc/GMT+7");
        assert_eq!(sanitize_timezone(""), "UTC");
        assert_eq!(sanitize_timezone("'; drop table tags; --"), "UTC");
        assert_eq!(sanitize_timezone(&"a".repeat(200)), "UTC");
    }
}
