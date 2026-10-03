use std::collections::HashMap;

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::get,
};
use axum_jwt_auth::Claims;
use chrono::{DateTime, Utc};
use sea_orm::DatabaseConnection;
use serde::Deserialize;

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::analytics,
    err::CadenzaError,
    routes::json::{
        analytics::{AnalyticsSummary, AnalyticsTrend, MetricInfo, ResolvedWindow},
        vec_into,
    },
    services::analytics::{Bucket, Metric, TimeWindow},
};

/// How many entries the top songs, top tags, and replay lists carry.
const TOP_LIST_LIMIT: u64 = 10;

#[derive(Deserialize)]
pub struct WindowParams {
    /// Inclusive start. All time when absent.
    since: Option<DateTime<Utc>>,
    /// Exclusive end. Now when absent.
    until: Option<DateTime<Utc>>,
    /// IANA name the day, week, month and hour boundaries are cut in. Defaults
    /// to UTC, which is the wrong week for most users, so clients should send it.
    tz: Option<String>,
}

impl WindowParams {
    fn window(&self) -> Result<TimeWindow, CadenzaError> {
        TimeWindow::new(self.since, self.until)
    }

    fn tz(&self) -> &str {
        self.tz.as_deref().unwrap_or("UTC")
    }
}

/// Every count the analytics page shows, over an optional window.
///
/// `stats` comes straight off the metric registry, so adding a metric there adds
/// a key here and the client needs no change. `rates` holds the ratios, computed
/// from `stats`.
///
/// A user with no events gets zeros, empty lists, and a null window. That is a
/// real case, not an error.
///
/// JSON return value format:
/// ```json
/// {
///   "stats": {"plays": 412, "skips": 88, "listening_ms": 71280000, "...": 0},
///   "rates": {"skip_rate": 0.176, "completion_rate": 0.824},
///   "active_days": 37,
///   "plays_by_hour": [0, 0, 1, 0, 0, 0, 4, 19, 22, 8, 3, 2, 6, 9, 11, 14, 28, 41, 33, 20, 12, 7, 2, 1],
///   "top_songs": [{"song_id": "1234567", "plays": 23}],
///   "top_tags": [{"name": "GYM", "color": "#f97316", "plays": 61}],
///   "most_replayed": [{"song_id": "7654321", "most_in_one_session": 6, "plays": 14}],
///   "window": {"since": "2026-08-01T00:00:00Z", "until": "2026-09-28T00:00:00Z"}
/// }
/// ```
async fn get_summary_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<WindowParams>,
) -> Result<Json<AnalyticsSummary>, CadenzaError> {
    let window = params.window()?;
    let tz = params.tz();
    let user_id = claims.user_id;

    let stats = analytics::get_summary(&db, user_id, window).await?;
    let active_days = analytics::get_active_days(&db, user_id, window, tz).await?;
    let plays_by_hour = analytics::get_plays_by_hour(&db, user_id, window, tz).await?;
    let top_songs = analytics::get_top_songs(&db, user_id, window, TOP_LIST_LIMIT).await?;
    let top_tags = analytics::get_top_tags_by_play(&db, user_id, window, TOP_LIST_LIMIT).await?;
    let most_replayed = analytics::get_most_replayed(&db, user_id, window, TOP_LIST_LIMIT).await?;

    // resolve an open window against the user's own history, so the client can
    // label the chart with what it actually covers
    let bounds = analytics::get_event_bounds(&db, user_id).await?;
    let resolved = ResolvedWindow {
        since: window.since.or(bounds.map(|(first, _)| first)),
        until: window.until.or(bounds.map(|(_, last)| last)),
    };

    Ok(Json(AnalyticsSummary {
        rates: derive_rates(&stats),
        stats,
        active_days,
        plays_by_hour,
        top_songs: vec_into(top_songs),
        top_tags: vec_into(top_tags),
        most_replayed: vec_into(most_replayed),
        window: resolved,
    }))
}

/// The ratios, from the counts.
///
/// Kept out of the metric registry on purpose: a ratio cannot be bucketed by
/// summing, because the average of per-bucket ratios is not the ratio over the
/// whole window. A client wanting a skip rate trend asks for `skips` and
/// `completions` and divides per bucket itself.
///
/// A denominator of zero gives 0.0 rather than a null or a NaN, so the client
/// never has to special case a new account.
fn derive_rates(stats: &HashMap<String, i64>) -> HashMap<String, f64> {
    let get = |name: &str| stats.get(name).copied().unwrap_or(0);
    let ratio = |numerator: i64, denominator: i64| {
        if denominator == 0 {
            0.0
        } else {
            numerator as f64 / denominator as f64
        }
    };

    // every listen ends in exactly one of a completion or a skip, so the two
    // together are how many listens finished
    let finished = get("completions") + get("skips");

    HashMap::from([
        ("skip_rate".to_owned(), ratio(get("skips"), finished)),
        (
            "completion_rate".to_owned(),
            ratio(get("completions"), finished),
        ),
        (
            "early_skip_rate".to_owned(),
            ratio(get("early_skips"), get("skips")),
        ),
        (
            "plays_per_song".to_owned(),
            ratio(get("plays"), get("unique_songs")),
        ),
        (
            "query_play_rate".to_owned(),
            ratio(get("query_plays"), get("plays")),
        ),
    ])
}

#[derive(Deserialize)]
pub struct TrendParams {
    /// A name from [`Metric::ALL`].
    metric: String,
    /// `day`, `week`, `month`, or `year`. Defaults to `week`.
    bucket: Option<String>,
    since: Option<DateTime<Utc>>,
    until: Option<DateTime<Utc>>,
    tz: Option<String>,
}

/// One metric bucketed over time, densely: every bucket in the window comes
/// back, and one with no events comes back as zero.
///
/// One generic path for every metric. Adding a metric to the registry makes it
/// available here with no new handler.
///
/// Buckets are cut in `tz`. An absent window runs from the user's first event to
/// their last. A user with no events gets an empty series.
///
/// JSON return value format:
/// ```json
/// {
///   "metric": "plays",
///   "description": "Songs played long enough to count",
///   "bucket": "week",
///   "points": [{"bucket": "2026-09-07", "value": 61}, {"bucket": "2026-09-14", "value": 0}]
/// }
/// ```
async fn get_trend_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<TrendParams>,
) -> Result<Json<AnalyticsTrend>, CadenzaError> {
    let metric = Metric::from_name(&params.metric).ok_or_else(|| {
        CadenzaError::InvalidRequestBody(format!(
            "unknown metric '{}'. known metrics: {}",
            params.metric,
            Metric::ALL
                .iter()
                .map(|m| m.name)
                .collect::<Vec<_>>()
                .join(", ")
        ))
    })?;

    let bucket_name = params.bucket.as_deref().unwrap_or("week");
    let bucket = Bucket::from_name(bucket_name).ok_or_else(|| {
        CadenzaError::InvalidRequestBody(format!(
            "unknown bucket '{bucket_name}'. known buckets: day, week, month, year"
        ))
    })?;

    // the series needs both ends, so an open window resolves against the user's
    // own history rather than defaulting to some arbitrary range
    let bounds = analytics::get_event_bounds(&db, claims.user_id).await?;
    let Some((first, last)) = bounds else {
        return Ok(Json(AnalyticsTrend {
            metric: metric.name.to_owned(),
            description: metric.description.to_owned(),
            bucket: bucket.to_string(),
            points: Vec::new(),
        }));
    };

    let since = params.since.unwrap_or(first);
    // the window's upper bound is exclusive, so the default has to clear the last
    // event rather than land on it. landing on it would drop the newest event
    // from every default trend, and would make since == until for a user with
    // exactly one event, which then reads as a backwards window
    let until = params
        .until
        .unwrap_or_else(|| last + chrono::Duration::milliseconds(1));
    if since >= until {
        return Err(CadenzaError::InvalidRequestBody(
            "since must be before until".to_owned(),
        ));
    }
    check_bucket_count(since, until, bucket)?;

    let points = analytics::get_trend(
        &db,
        claims.user_id,
        metric,
        bucket,
        since,
        until,
        params.tz.as_deref().unwrap_or("UTC"),
    )
    .await?;

    Ok(Json(AnalyticsTrend {
        metric: metric.name.to_owned(),
        description: metric.description.to_owned(),
        bucket: bucket.to_string(),
        points: vec_into(points),
    }))
}

/// Refuses a window that would generate more buckets than the bucket size is
/// meant for, rather than quietly truncating it. Asking for daily buckets over
/// ten years is a mistake worth hearing about.
fn check_bucket_count(
    since: DateTime<Utc>,
    until: DateTime<Utc>,
    bucket: Bucket,
) -> Result<(), CadenzaError> {
    let estimated = bucket.buckets_in((until - since).num_days());

    if estimated > bucket.max_buckets() {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "that window is about {estimated} {bucket} buckets, over the limit of {}. \
             use a wider bucket or a shorter window",
            bucket.max_buckets()
        )));
    }
    Ok(())
}

/// Every metric the trends endpoint knows, so a client can offer them without
/// hardcoding the list.
///
/// JSON return value format:
/// ```json
/// [{"name": "plays", "description": "Songs played long enough to count"}]
/// ```
async fn list_metrics_handler(
    _: Claims<SupabaseClaims>, // must have credentials to use this route
) -> Json<Vec<MetricInfo>> {
    Json(
        Metric::ALL
            .iter()
            .map(|metric| MetricInfo {
                name: metric.name.to_owned(),
                description: metric.description.to_owned(),
            })
            .collect(),
    )
}

pub fn get_analytics_router() -> Router<AppState> {
    Router::new()
        .route("/summary", get(get_summary_handler))
        .route("/trends", get(get_trend_handler))
        .route("/metrics", get(list_metrics_handler))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(iso: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(iso)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn stats(pairs: &[(&str, i64)]) -> HashMap<String, i64> {
        pairs.iter().map(|(k, v)| ((*k).to_owned(), *v)).collect()
    }

    #[test]
    fn skip_rate_is_over_listens_that_finished() {
        // 3 skips and 7 completions is 10 finished listens
        let rates = derive_rates(&stats(&[("skips", 3), ("completions", 7)]));
        assert!((rates["skip_rate"] - 0.3).abs() < 1e-9);
        assert!((rates["completion_rate"] - 0.7).abs() < 1e-9);
    }

    #[test]
    fn a_new_account_gets_zero_rather_than_a_nan() {
        let rates = derive_rates(&stats(&[]));
        for (name, value) in &rates {
            assert!(value.is_finite(), "{name} is {value}");
            assert_eq!(*value, 0.0, "{name}");
        }
    }

    #[test]
    fn the_early_skip_rate_is_a_share_of_skips_not_of_plays() {
        let rates = derive_rates(&stats(&[("skips", 4), ("early_skips", 1), ("plays", 100)]));
        assert!((rates["early_skip_rate"] - 0.25).abs() < 1e-9);
    }

    #[test]
    fn a_missing_metric_reads_as_zero_rather_than_panicking() {
        // a client on an older backend, or a metric since renamed
        let rates = derive_rates(&stats(&[("plays", 10)]));
        assert_eq!(rates["skip_rate"], 0.0);
    }

    #[test]
    fn a_sensible_window_passes_every_bucket() {
        let since = at("2026-01-01T00:00:00Z");
        let until = at("2026-03-01T00:00:00Z");
        for bucket in Bucket::ALL {
            assert!(
                check_bucket_count(since, until, bucket).is_ok(),
                "two months by {bucket}"
            );
        }
    }

    #[test]
    fn daily_buckets_over_a_decade_are_refused_with_advice() {
        let since = at("2016-01-01T00:00:00Z");
        let until = at("2026-01-01T00:00:00Z");
        let err = check_bucket_count(since, until, Bucket::Day)
            .expect_err("3650 daily buckets is too many");
        let message = err.to_string();
        assert!(message.contains("wider bucket"), "{message}");

        // the same decade is fine by month or year
        assert!(check_bucket_count(since, until, Bucket::Month).is_ok());
        assert!(check_bucket_count(since, until, Bucket::Year).is_ok());
    }

    #[test]
    fn a_backwards_window_counts_as_no_buckets_rather_than_panicking() {
        // the handler rejects since >= until before this, so it only has to not
        // underflow
        let since = at("2026-06-01T00:00:00Z");
        let until = at("2026-01-01T00:00:00Z");
        assert!(check_bucket_count(since, until, Bucket::Day).is_ok());
    }

    #[test]
    fn every_metric_is_also_offered_by_the_metrics_endpoint() {
        // the client builds its picker from that list, so a metric missing from it
        // is a metric nobody can chart
        for metric in Metric::ALL {
            assert!(Metric::from_name(metric.name).is_some(), "{}", metric.name);
            assert!(
                !metric.description.is_empty(),
                "{} has no label",
                metric.name
            );
        }
    }
}
