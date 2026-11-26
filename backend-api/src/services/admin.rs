//! Validates dashboard requests and caches bounded platform aggregates.
use crate::{db::admin_metrics, err::CadenzaError, routes::json::admin::MetricsParams};
use chrono::{Datelike, Duration, Months, Utc};
use sea_orm::DatabaseConnection;
use serde_json::Value;

pub async fn metrics(
    db: &DatabaseConnection,
    params: MetricsParams,
) -> Result<Value, CadenzaError> {
    if params.search.as_ref().is_some_and(|s| s.len() > 200) {
        return Err(CadenzaError::InvalidRequestBody("search too long".into()));
    }
    let now = Utc::now();
    let today = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
    let days = params.days.unwrap_or(30);
    if ![7, 30, 90].contains(&days) {
        return Err(CadenzaError::InvalidRequestBody(
            "days must be 7, 30, or 90".into(),
        ));
    }
    let limit = params.limit.unwrap_or(10);
    let offset = params.offset.unwrap_or(0);
    if !(1..=100).contains(&limit) || offset > 1200 {
        return Err(CadenzaError::InvalidRequestBody(
            "limit or offset out of range".into(),
        ));
    }
    let since = params.since.unwrap_or(today - Duration::days(days - 1));
    let until = params.until.unwrap_or(now).min(now);
    if since >= until || until - since > Duration::days(367) {
        return Err(CadenzaError::InvalidRequestBody(
            "Invalid reporting period".into(),
        ));
    }
    if !["listening", "social", "tags", "daily", "week", "month"]
        .contains(&params.kind.as_deref().unwrap_or("listening"))
    {
        return Err(CadenzaError::InvalidRequestBody(
            "Unknown metric section".into(),
        ));
    }
    if !["name", "songs", "plays", "accounts"].contains(&params.sort.as_deref().unwrap_or("songs"))
    {
        return Err(CadenzaError::InvalidRequestBody("Unknown tag sort".into()));
    }
    static CACHE: std::sync::OnceLock<
        tokio::sync::Mutex<
            std::collections::HashMap<String, (std::time::Instant, serde_json::Value)>,
        >,
    > = std::sync::OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let cache_key = serde_json::to_string(&params)
        .map_err(|e| CadenzaError::InvalidRequestBody(e.to_string()))?;
    {
        let entries = cache.lock().await;
        if let Some((at, value)) = entries.get(&cache_key) {
            if at.elapsed().as_secs() < 60 {
                return Ok(value.clone());
            }
        }
    }
    let result = match params.kind.as_deref().unwrap_or("listening") {
        "tags" => {
            let search = params.search.unwrap_or_default();
            admin_metrics::tags(
                db,
                &search,
                params.sort.as_deref().unwrap_or("songs"),
                params.descending.unwrap_or(true),
                i64::from(offset) * 25,
                params.defaults.unwrap_or(false),
            )
            .await?
        }
        "social" => admin_metrics::social(db, since, until, limit).await?,
        "daily" => admin_metrics::daily_trend(db, today - Duration::days(29), now).await?,
        "week" | "month" => {
            let (start, end) = user_window(&params, today)?;
            admin_metrics::users(db, start, end, now).await?
        }
        "listening" => {
            let mut value = admin_metrics::listening(db, since, until, limit).await?;
            let trend = admin_metrics::daily_trend_until(db, since, until, now).await?;
            value["plays"] = trend["plays"].clone();
            value["listening_ms"] = trend["listening_ms"].clone();
            value["trend"] = trend;
            value
        }
        _ => {
            return Err(CadenzaError::InvalidRequestBody(
                "Unknown metric section".into(),
            ));
        }
    };
    {
        let mut entries = cache.lock().await;
        entries.retain(|_, (at, _)| at.elapsed().as_secs() < 60);
        if entries.len() < 256 {
            entries.insert(cache_key, (std::time::Instant::now(), result.clone()));
        }
    }
    Ok(result)
}

/// Explicit calendar bounds win over server-relative offsets, including near UTC midnight.
fn user_window(
    params: &MetricsParams,
    today: chrono::DateTime<Utc>,
) -> Result<(chrono::DateTime<Utc>, chrono::DateTime<Utc>), CadenzaError> {
    let week = params.kind.as_deref() == Some("week");
    match (params.since, params.until) {
        (Some(start), Some(end)) => {
            let midnight = start.time() == chrono::NaiveTime::MIN;
            let valid = if week {
                midnight
                    && start.weekday() == chrono::Weekday::Mon
                    && end == start + Duration::days(7)
            } else {
                midnight
                    && start.day() == 1
                    && start.checked_add_months(Months::new(1)) == Some(end)
            };
            if !valid {
                return Err(CadenzaError::InvalidRequestBody(
                    "Expected a complete UTC calendar week or month".into(),
                ));
            }
            Ok((start, end))
        }
        (None, None) => {
            let offset = params.offset.unwrap_or(0);
            if week {
                let start = today
                    - Duration::days(
                        i64::from(today.weekday().num_days_from_monday()) + i64::from(offset) * 7,
                    );
                Ok((start, start + Duration::days(7)))
            } else {
                let start = today
                    .with_day(1)
                    .unwrap()
                    .checked_sub_months(Months::new(offset))
                    .ok_or_else(|| CadenzaError::InvalidRequestBody("Invalid month".into()))?;
                Ok((start, start.checked_add_months(Months::new(1)).unwrap()))
            }
        }
        _ => Err(CadenzaError::InvalidRequestBody(
            "since and until must be provided together".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn users_respects_selected_calendar_bounds_before_server_relative_offsets() {
        let today = "2026-11-23T00:00:00Z".parse().unwrap();
        let mut params = MetricsParams {
            kind: Some("week".into()),
            since: Some("2026-11-16T00:00:00Z".parse().unwrap()),
            until: Some(today),
            ..Default::default()
        };
        assert_eq!(
            user_window(&params, today).unwrap(),
            (params.since.unwrap(), today)
        );
        params.kind = Some("month".into());
        params.since = Some("2026-11-01T00:00:00Z".parse().unwrap());
        params.until = Some("2026-12-01T00:00:00Z".parse().unwrap());
        assert_eq!(
            user_window(&params, today).unwrap().1,
            params.until.unwrap(),
            "retain full month end for snapshot eligibility"
        );
        params.kind = Some("week".into());
        params.since = Some("2026-11-17T00:00:00Z".parse().unwrap());
        params.until = Some("2026-11-24T00:00:00Z".parse().unwrap());
        assert!(
            user_window(&params, today).is_err(),
            "calendar weeks must start Monday"
        );
    }
}
