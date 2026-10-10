//! The metrics the analytics endpoints can compute, and the time windows and
//! buckets they compute them over.
//!
//! A [`Metric`] is a name plus one SQL aggregate over `listening_events` rows.
//! That is the whole seam: `GET /analytics/summary` runs every aggregate once
//! over the window, and `GET /analytics/trends` runs one of them per bucket.
//! Adding a metric is adding an entry to [`Metric::ALL`], and both endpoints
//! pick it up without a new handler.
//!
//! Aggregates that are not one expression over rows do not live here. Top
//! songs, top tags, and replays are their own functions in `db::analytics`,
//! because they group by something other than the window.

use std::fmt;

use serde::{Deserialize, Serialize};

/// What a metric's number means, so a reader can format it.
///
/// Without this the client cannot render an arbitrary metric: every value is
/// just an integer, and a listening time in milliseconds formatted as a count
/// reads as 71,280,000 rather than 19h 48m.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MetricUnit {
    /// A tally of events. Rendered with thousands separators.
    Count,
    /// A duration. Rendered as hours and minutes.
    Milliseconds,
}

/// One event's listened time in ms, null when it has none or the value is junk.
/// Guarded the same way as `early_skips`: at most 18 digits, so the value always
/// fits a bigint and no row can overflow a sum. A macro so it can be spliced
/// into the `listening_ms` aggregate at compile time.
macro_rules! listened_ms_expr {
    () => {
        "case when payload->>'listened_ms' ~ '^-?[0-9]{1,18}$' \
              then (payload->>'listened_ms')::bigint end"
    };
}

/// The events that end a listen and so carry `listened_ms`. Only these count
/// toward listening time, so one play cannot be counted twice.
macro_rules! listen_events_filter {
    () => {
        "event_type in ('play_complete', 'skip')"
    };
}

/// One event's listened time, unqualified columns of `listening_events`. Every
/// listening time read uses this with [`LISTEN_EVENTS`], so a tag's share and
/// the period total cannot disagree on what a listen is worth.
pub const LISTENED_MS: &str = listened_ms_expr!();

/// The `where` fragment picking the events [`LISTENED_MS`] is summed over.
pub const LISTEN_EVENTS: &str = listen_events_filter!();

/// A number computed from a user's events over a window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Metric {
    /// What the client asks for it by, and the key it comes back under.
    pub name: &'static str,
    /// A SQL aggregate over `listening_events`. Must come back as `bigint`:
    /// postgres sums a bigint into numeric, so any `sum` needs a `::bigint`.
    ///
    /// Interpolated into the query, so it must stay a literal written here and
    /// never come from a request.
    pub aggregate: &'static str,
    /// What a chart of this metric is titled. A short noun phrase, not a
    /// sentence: it is read as a heading and on a filter chip, not as prose.
    pub description: &'static str,
    /// What the number means, so the client can format it without knowing the
    /// metric by name.
    pub unit: MetricUnit,
}

impl Metric {
    /// Every metric, in the order the summary lists them.
    ///
    /// Only metrics something actually emits events for belong here. The client
    /// builds its chart picker straight off this list, so an entry with no
    /// emitter is a chart the user can select and only ever see zeros in.
    /// `query_run`, `tag_applied` and `tag_removed` are valid event types that
    /// nothing emits yet; each becomes a metric by adding one entry below, once
    /// it does.
    pub const ALL: &[Metric] = &[
        Metric {
            name: "plays",
            aggregate: "count(*) filter (where event_type = 'play_counted')",
            description: "Plays",
            unit: MetricUnit::Count,
        },
        Metric {
            name: "starts",
            aggregate: "count(*) filter (where event_type = 'play_start')",
            description: "Songs started",
            unit: MetricUnit::Count,
        },
        Metric {
            name: "completions",
            aggregate: "count(*) filter (where event_type = 'play_complete')",
            description: "Finished",
            unit: MetricUnit::Count,
        },
        Metric {
            name: "skips",
            aggregate: "count(*) filter (where event_type = 'skip')",
            description: "Skips",
            unit: MetricUnit::Count,
        },
        // an early skip is a rejection, a late one is almost a full play. the
        // split is what makes skips usable as a signal rather than a tally
        Metric {
            name: "early_skips",
            // the cast is guarded: ingest only type-checks a payload key for the
            // event type that requires it, so another type could have stored a
            // non-numeric position_ms, and postgres is free to evaluate the cast
            // on rows the filter would otherwise exclude. the log is append only,
            // so one such row would break this metric for that user forever
            aggregate: "count(*) filter (where event_type = 'skip' \
                        and case when payload->>'position_ms' ~ '^-?[0-9]{1,18}$' \
                                 then (payload->>'position_ms')::bigint end < 10000)",
            description: "Early skips",
            unit: MetricUnit::Count,
        },
        Metric {
            name: "unique_songs",
            aggregate: "count(distinct song_id) filter (where event_type = 'play_counted')",
            description: "Different songs",
            unit: MetricUnit::Count,
        },
        // only the two events that end a listen carry listened_ms, so these
        // cannot double count one play
        Metric {
            name: "query_plays",
            aggregate: "count(*) filter (where event_type = 'query_play')",
            description: "From a query",
            unit: MetricUnit::Count,
        },
        Metric {
            name: "listening_ms",
            aggregate: concat!(
                "coalesce(sum(",
                listened_ms_expr!(),
                ") filter (where ",
                listen_events_filter!(),
                "), 0)::bigint"
            ),
            description: "Listening time",
            unit: MetricUnit::Milliseconds,
        },
    ];

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|metric| metric.name == name)
    }
}

/// How wide one bucket of a trend is.
///
/// Both the truncation and the `generate_series` step come from here, so they
/// can never disagree, and neither is ever a string off a request. Crosses
/// the wire as a plain string through `from_name` and `Display`, so it needs no
/// serde of its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bucket {
    Hour,
    /// Two hours from an even hour, local midnight first. Lets a week heatmap
    /// draw 12 columns a day instead of 24.
    TwoHours,
    Day,
    Week,
    Month,
    Year,
}

impl Bucket {
    pub const ALL: &[Bucket] = &[
        Self::Hour,
        Self::TwoHours,
        Self::Day,
        Self::Week,
        Self::Month,
        Self::Year,
    ];

    /// What `bucket=auto` picks from, finest first. No hours: a trend is a
    /// calendar view, and hours are asked for by name, for a heatmap or a day.
    const AUTO: &[Bucket] = &[Self::Day, Self::Week, Self::Month, Self::Year];

    /// What a request names it by.
    pub fn name(self) -> &'static str {
        match self {
            Self::Hour => "hour",
            Self::TwoHours => "two_hour",
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
            Self::Year => "year",
        }
    }

    /// SQL truncating the local `timestamp` expression `ts` to the start of its
    /// bucket. Built from literals only, never from a request.
    ///
    /// `date_trunc` has no two hour unit, so that one bins from a midnight
    /// origin instead; `ts` is local, so the bins start on local even hours.
    pub fn truncate(self, ts: &str) -> String {
        match self {
            Self::TwoHours => {
                format!("date_bin('2 hours', {ts}, timestamp '2000-01-01')")
            }
            Self::Hour => format!("date_trunc('hour', {ts})"),
            Self::Day => format!("date_trunc('day', {ts})"),
            Self::Week => format!("date_trunc('week', {ts})"),
            Self::Month => format!("date_trunc('month', {ts})"),
            Self::Year => format!("date_trunc('year', {ts})"),
        }
    }

    /// The `generate_series` step, one bucket wide.
    pub fn step(self) -> &'static str {
        match self {
            Self::Hour => "1 hour",
            Self::TwoHours => "2 hours",
            Self::Day => "1 day",
            Self::Week => "1 week",
            Self::Month => "1 month",
            Self::Year => "1 year",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL
            .iter()
            .copied()
            .find(|bucket| bucket.name() == name)
    }

    /// How many buckets a window is allowed to produce, so a request for daily
    /// buckets over ten years cannot ask the database for 3,650 rows.
    ///
    /// Each is generous for its size: over a year of days, five years of weeks,
    /// fifteen years of months. The cap is there to stop an absurd request, not
    /// to second guess a reasonable one.
    pub fn max_buckets(self) -> i64 {
        match self {
            // a month of hours, the widest a heatmap cuts in hours
            Self::Hour => 800,
            Self::TwoHours => 400,
            Self::Day => 400,
            Self::Week => 260,
            Self::Month => 180,
            Self::Year => 50,
        }
    }

    /// Average days in one bucket, for estimating how many a window covers.
    ///
    /// Averaged rather than rounded down, because a divisor that is too small
    /// over-counts the buckets and would refuse a window that actually fits: ten
    /// years is 120 months, but at 28 days a month it estimates 130.
    pub fn average_days(self) -> f64 {
        match self {
            Self::Hour => 1.0 / 24.0,
            Self::TwoHours => 1.0 / 12.0,
            Self::Day => 1.0,
            Self::Week => 7.0,
            // the gregorian averages, so a decade estimates as a decade
            Self::Month => 30.436_875,
            Self::Year => 365.242_5,
        }
    }

    /// Bars a chart should carry at most, for picking a bucket off a span.
    const TARGET_BUCKETS: i64 = 60;

    /// The finest bucket that keeps `days` under [`Self::TARGET_BUCKETS`] bars.
    /// What `bucket=auto` resolves to.
    ///
    /// The client cannot pick this itself for an all-time window without first
    /// asking how much history there is, and chaining those two requests is a
    /// visible extra round trip, so the server decides.
    ///
    /// [`Self::AUTO`] is ordered finest first, so this is the first that fits.
    /// Year is the floor: nothing is coarser, so a long enough span just gets
    /// more year bars.
    pub fn fit(days: i64) -> Self {
        Self::AUTO
            .iter()
            .copied()
            .find(|bucket| bucket.buckets_in(days) <= Self::TARGET_BUCKETS)
            .unwrap_or(Self::Year)
    }

    /// How a bucket's start is printed, as a `to_char` pattern in local time.
    /// Coarser than an hour is a bare date; an hour carries its time, or every
    /// hour of a day would print the same.
    pub fn label_format(self) -> &'static str {
        match self {
            Self::Hour | Self::TwoHours => "YYYY-MM-DD\"T\"HH24:MI",
            _ => "YYYY-MM-DD",
        }
    }

    /// How many buckets a window of `days` covers, rounded up, never negative.
    pub fn buckets_in(self, days: i64) -> i64 {
        if days <= 0 {
            return 0;
        }
        (days as f64 / self.average_days()).ceil() as i64
    }
}

impl fmt::Display for Bucket {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::analytics::EventType;

    #[test]
    fn listening_time_is_built_from_the_shared_listen_rule() {
        let metric = Metric::from_name("listening_ms").unwrap();
        assert!(metric.aggregate.contains(LISTENED_MS));
        assert!(metric.aggregate.contains(LISTEN_EVENTS));
    }

    #[test]
    fn metric_names_are_unique() {
        let mut names: Vec<&str> = Metric::ALL.iter().map(|m| m.name).collect();
        let before = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), before, "two metrics share a name");
    }

    #[test]
    fn metric_names_round_trip() {
        for &metric in Metric::ALL {
            assert_eq!(Metric::from_name(metric.name), Some(metric));
        }
        assert_eq!(Metric::from_name("nope"), None);
    }

    #[test]
    fn bucket_names_round_trip() {
        for &bucket in Bucket::ALL {
            assert_eq!(Bucket::from_name(bucket.name()), Some(bucket));
        }
        assert_eq!(Bucket::from_name("fortnight"), None);
    }

    /// Ten gregorian years, so the estimate is not fighting a rounding edge.
    const DECADE_DAYS: i64 = 3652;

    #[test]
    fn a_decade_estimates_as_the_buckets_it_really_is() {
        assert_eq!(Bucket::Year.buckets_in(DECADE_DAYS), 10);
        assert_eq!(Bucket::Month.buckets_in(DECADE_DAYS), 120);
        assert_eq!(Bucket::Day.buckets_in(DECADE_DAYS), DECADE_DAYS);
        assert_eq!(Bucket::Week.buckets_in(364), 52);
    }

    #[test]
    fn a_window_spilling_into_one_more_bucket_counts_it() {
        // rounded up, because a window that touches an 11th year really does
        // produce an 11th bucket
        assert_eq!(Bucket::Year.buckets_in(DECADE_DAYS + 2), 11);
        assert_eq!(Bucket::Day.buckets_in(1), 1);
    }

    #[test]
    fn months_and_years_fit_a_whole_listening_history() {
        // days and weeks are capped below a decade on purpose; months and years
        // have to fit one, since that is the span of a real history
        assert!(Bucket::Month.buckets_in(DECADE_DAYS) <= Bucket::Month.max_buckets());
        assert!(Bucket::Year.buckets_in(DECADE_DAYS) <= Bucket::Year.max_buckets());
    }

    #[test]
    fn fit_picks_the_finest_bucket_that_is_not_too_many_bars() {
        assert_eq!(Bucket::fit(1), Bucket::Day);
        assert_eq!(Bucket::fit(60), Bucket::Day);
        // 61 days of days is over the target, so it steps out to weeks
        assert_eq!(Bucket::fit(61), Bucket::Week);
        assert_eq!(Bucket::fit(365), Bucket::Week);
        assert_eq!(Bucket::fit(3 * 365), Bucket::Month);
        assert_eq!(Bucket::fit(20 * 365), Bucket::Year);
    }

    #[test]
    fn fit_never_returns_a_bucket_that_blows_the_target() {
        // except at the very top, where year is the floor and there is nothing
        // coarser to escape to
        for days in [1, 7, 30, 61, 200, 400, 1000, 3652, 20 * 365] {
            let bucket = Bucket::fit(days);
            let bars = bucket.buckets_in(days);
            assert!(
                bars <= Bucket::TARGET_BUCKETS || bucket == Bucket::Year,
                "{days} days gave {bars} {bucket} bars"
            );
        }
    }

    #[test]
    fn fit_never_picks_hours() {
        // a trend is a calendar view; hours are only ever asked for by name
        for days in [0, 1, 2] {
            assert_ne!(Bucket::fit(days), Bucket::Hour);
        }
    }

    #[test]
    fn a_month_of_hours_fits_the_hour_cap() {
        assert_eq!(Bucket::Hour.buckets_in(7), 168);
        assert!(Bucket::Hour.buckets_in(31) <= Bucket::Hour.max_buckets());
    }

    #[test]
    fn only_hours_print_a_time() {
        for &bucket in Bucket::ALL {
            let has_time = bucket.label_format().contains("HH24");
            let hourly = matches!(bucket, Bucket::Hour | Bucket::TwoHours);
            assert_eq!(has_time, hourly, "{bucket}");
        }
    }

    #[test]
    fn fit_handles_an_empty_span_without_panicking() {
        assert_eq!(Bucket::fit(0), Bucket::Day);
        assert_eq!(Bucket::fit(-5), Bucket::Day);
    }

    #[test]
    fn fit_always_stays_inside_the_buckets_cap() {
        // a chart the backend chose the bucket for must never be refused by the
        // bucket count guard
        for days in [1, 61, 400, 3652, 50 * 365] {
            let bucket = Bucket::fit(days);
            assert!(
                bucket.buckets_in(days) <= bucket.max_buckets(),
                "{days} days as {bucket} exceeds its own cap"
            );
        }
    }

    #[test]
    fn an_empty_or_backwards_window_is_no_buckets() {
        for &bucket in Bucket::ALL {
            assert_eq!(bucket.buckets_in(0), 0);
            assert_eq!(bucket.buckets_in(-5), 0);
        }
    }

    /// Every event type an aggregate filters on, pulled out of the SQL.
    ///
    /// Reads quoted tokens directly rather than splitting on punctuation: an
    /// aggregate also contains payload keys and a digit guard whose `{1,18}`
    /// holds a comma and whose casts hold parentheses.
    fn event_types_named_in(aggregate: &str) -> Vec<String> {
        let mut found = Vec::new();

        for marker in ["event_type = ", "event_type in "] {
            let mut rest = aggregate;
            while let Some(at) = rest.find(marker) {
                rest = &rest[at + marker.len()..];
                // `= 'x'` names one, `in ('x', 'y')` names everything in the list
                let (mut scan, limit) = match rest.as_bytes().first() {
                    Some(b'(') => match rest.find(')') {
                        Some(close) => (&rest[1..close], close),
                        None => break,
                    },
                    _ => (rest, rest.len()),
                };

                let mut taken = 0;
                while let Some(open) = scan.find('\'') {
                    let after = &scan[open + 1..];
                    let Some(close) = after.find('\'') else { break };
                    found.push(after[..close].to_owned());
                    scan = &after[close + 1..];
                    taken += 1;
                    // `= 'x'` takes exactly one token; a list takes all of them
                    if limit == rest.len() && taken == 1 {
                        break;
                    }
                }

                rest = &rest[limit.min(rest.len())..];
            }
        }

        found
    }

    /// The aggregates spell event types as SQL literals, because Rust cannot
    /// build a `&'static str` out of a `const fn` call. So this pins the two
    /// together: rename a variant and this fails rather than silently orphaning
    /// every row written under the old name.
    #[test]
    fn every_event_type_named_in_an_aggregate_is_a_real_one() {
        let known: Vec<&str> = EventType::ALL.iter().map(|e| e.name()).collect();
        let mut seen = 0;

        for &metric in Metric::ALL {
            for named in event_types_named_in(metric.aggregate) {
                seen += 1;
                assert!(
                    known.contains(&named.as_str()),
                    "{} filters on '{named}', which is not an EventType. known: {known:?}",
                    metric.name
                );
            }
        }

        assert!(
            seen >= Metric::ALL.len(),
            "found only {seen} filters, so the scan is broken"
        );
    }

    #[test]
    fn the_event_type_scan_actually_finds_things() {
        // guards the test above: a scan that finds nothing would pass vacuously
        assert_eq!(
            event_types_named_in("count(*) filter (where event_type = 'skip')"),
            vec!["skip".to_owned()]
        );
        assert_eq!(
            event_types_named_in("filter (where event_type in ('play_complete', 'skip'))"),
            vec!["play_complete".to_owned(), "skip".to_owned()]
        );
        // the shapes that broke an earlier scan: a comma inside a regex, and
        // parentheses inside a cast, both after the event type
        assert_eq!(
            event_types_named_in(
                "count(*) filter (where event_type = 'skip' and case when \
                 payload->>'position_ms' ~ '^-?[0-9]{1,18}$' then \
                 (payload->>'position_ms')::bigint end < 10000)"
            ),
            vec!["skip".to_owned()]
        );
        // a payload key on its own is not an event type
        assert!(event_types_named_in("sum((payload->>'listened_ms')::bigint)").is_empty());
    }

    /// Aggregates are interpolated into SQL, so nothing in one may end the
    /// expression or start another statement.
    #[test]
    fn aggregates_carry_no_statement_breaks() {
        for &metric in Metric::ALL {
            assert!(
                !metric.aggregate.contains(';'),
                "{} has a semicolon",
                metric.name
            );
            assert!(
                !metric.aggregate.contains("--"),
                "{} has a comment",
                metric.name
            );
        }
    }
}
