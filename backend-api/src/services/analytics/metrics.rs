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
    /// One line for the client to label a chart with.
    pub description: &'static str,
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
    pub const ALL: [Metric; 8] = [
        Metric {
            name: "plays",
            aggregate: "count(*) filter (where event_type = 'play_counted')",
            description: "Songs played long enough to count",
        },
        Metric {
            name: "starts",
            aggregate: "count(*) filter (where event_type = 'play_start')",
            description: "Songs started, counted or not",
        },
        Metric {
            name: "completions",
            aggregate: "count(*) filter (where event_type = 'play_complete')",
            description: "Songs played to the end",
        },
        Metric {
            name: "skips",
            aggregate: "count(*) filter (where event_type = 'skip')",
            description: "Songs left before the end",
        },
        // an early skip is a rejection, a late one is almost a full play. the
        // split is what makes skips usable as a signal rather than a tally
        Metric {
            name: "early_skips",
            aggregate: "count(*) filter (where event_type = 'skip' \
                        and (payload->>'position_ms')::bigint < 10000)",
            description: "Songs skipped in the first 10 seconds",
        },
        Metric {
            name: "unique_songs",
            aggregate: "count(distinct song_id) filter (where event_type = 'play_counted')",
            description: "Different songs played",
        },
        // only the two events that end a listen carry listened_ms, so these
        // cannot double count one play
        Metric {
            name: "query_plays",
            aggregate: "count(*) filter (where event_type = 'query_play')",
            description: "Plays started from a query",
        },
        Metric {
            name: "listening_ms",
            aggregate: "coalesce(sum((payload->>'listened_ms')::bigint) \
                        filter (where event_type in ('play_complete', 'skip')), 0)::bigint",
            description: "Time spent listening, in milliseconds",
        },
    ];

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|metric| metric.name == name)
    }
}

/// How wide one bucket of a trend is.
///
/// Both the `date_trunc` unit and the `generate_series` step come from here, so
/// they can never disagree, and neither is ever a string off a request.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Bucket {
    Day,
    Week,
    Month,
    Year,
}

impl Bucket {
    pub const ALL: [Bucket; 4] = [Self::Day, Self::Week, Self::Month, Self::Year];

    /// The `date_trunc` unit.
    pub fn trunc_unit(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
            Self::Year => "year",
        }
    }

    /// The `generate_series` step, one bucket wide.
    pub fn step(self) -> &'static str {
        match self {
            Self::Day => "1 day",
            Self::Week => "1 week",
            Self::Month => "1 month",
            Self::Year => "1 year",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|bucket| bucket.trunc_unit() == name)
    }

    /// How many buckets a window is allowed to produce, so a request for daily
    /// buckets over ten years cannot ask the database for 3,650 rows.
    ///
    /// Each is generous for its size: over a year of days, five years of weeks,
    /// fifteen years of months. The cap is there to stop an absurd request, not
    /// to second guess a reasonable one.
    pub fn max_buckets(self) -> i64 {
        match self {
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
            Self::Day => 1.0,
            Self::Week => 7.0,
            // the gregorian averages, so a decade estimates as a decade
            Self::Month => 30.436_875,
            Self::Year => 365.242_5,
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
        f.write_str(self.trunc_unit())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        for metric in Metric::ALL {
            assert_eq!(Metric::from_name(metric.name), Some(metric));
        }
        assert_eq!(Metric::from_name("nope"), None);
    }

    #[test]
    fn bucket_names_round_trip() {
        for bucket in Bucket::ALL {
            assert_eq!(Bucket::from_name(bucket.trunc_unit()), Some(bucket));
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
    fn an_empty_or_backwards_window_is_no_buckets() {
        for bucket in Bucket::ALL {
            assert_eq!(bucket.buckets_in(0), 0);
            assert_eq!(bucket.buckets_in(-5), 0);
        }
    }

    /// Aggregates are interpolated into SQL, so nothing in one may end the
    /// expression or start another statement.
    #[test]
    fn aggregates_carry_no_statement_breaks() {
        for metric in Metric::ALL {
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
