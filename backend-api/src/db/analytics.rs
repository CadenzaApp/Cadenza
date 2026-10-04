//! The read path for `listening_events`: every aggregate the analytics
//! endpoints serve.
//!
//! Aggregation happens in SQL. Nothing here pulls event rows into Rust and
//! counts them, because the point of the event log is that it gets large.
//!
//! Two shapes of read live here. The ones driven by
//! [`crate::services::analytics::Metric`] interpolate that metric's aggregate
//! into one query, so adding a metric needs no change in this file. The rest
//! (replays, top tags, the clock) group by something other than the window and
//! so are each their own function. Rankings are the same idea one level up:
//! [`crate::services::analytics::Dimension`] supplies the group key, so
//! `get_top_entities` serves songs, artists and albums from one query.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sea_orm::{ConnectionTrait, DbBackend, Statement, Value as DbValue, prelude::Uuid};

use crate::db::entity::sea_orm_active_enums::TagType;
use crate::err::CadenzaError;
use crate::services::analytics::{Bucket, Dimension, Metric, TimeWindow, sanitize_timezone};

/// A `where` fragment restricting rows to one user and a window, plus the values
/// it binds, starting at `$1`.
///
/// Built conditionally rather than with `($2 is null or ...)` so an all-time
/// read still uses `listening_events_user_time_idx` instead of scanning.
struct Scope {
    clause: String,
    values: Vec<DbValue>,
    /// The number of the next free placeholder.
    next_param: usize,
    /// Placeholder holding `window.since`, when the window has one.
    since_param: Option<String>,
    /// Placeholder holding `window.until`, when the window has one.
    until_param: Option<String>,
}

impl Scope {
    /// `alias` qualifies the columns, for a query that joins. Pass `None` when
    /// `listening_events` is the only table in the statement.
    fn new(user_id: Uuid, window: TimeWindow, alias: Option<&str>) -> Self {
        let qualify = |column: &str| match alias {
            Some(alias) => format!("{alias}.{column}"),
            None => column.to_owned(),
        };

        let mut clause = format!("{} = $1", qualify("user_id"));
        let mut values: Vec<DbValue> = vec![user_id.into()];
        let mut next_param = 2;
        let mut since_param = None;
        let mut until_param = None;

        if let Some(since) = window.since {
            let placeholder = format!("${next_param}");
            clause.push_str(&format!(" and {} >= {placeholder}", qualify("occurred_at")));
            values.push(since.into());
            next_param += 1;
            since_param = Some(placeholder);
        }
        if let Some(until) = window.until {
            let placeholder = format!("${next_param}");
            clause.push_str(&format!(" and {} < {placeholder}", qualify("occurred_at")));
            values.push(until.into());
            next_param += 1;
            until_param = Some(placeholder);
        }

        Self {
            clause,
            values,
            next_param,
            since_param,
            until_param,
        }
    }

    /// Adds one more bound value and returns its placeholder.
    fn bind(&mut self, value: impl Into<DbValue>) -> String {
        let placeholder = format!("${}", self.next_param);
        self.values.push(value.into());
        self.next_param += 1;
        placeholder
    }
}

/// Every metric in [`Metric::ALL`] over one window, keyed by metric name.
///
/// One query, one pass over the user's rows: each metric is a `filter`ed
/// aggregate in the same select, so adding metrics does not add round trips. A
/// user with no events gets a zero for every metric, never an empty map.
pub async fn get_summary(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    window: TimeWindow,
) -> Result<HashMap<String, i64>, CadenzaError> {
    let scope = Scope::new(user_id, window, None);

    let selected = Metric::ALL
        .iter()
        .enumerate()
        .map(|(i, metric)| format!("{} as m{i}", metric.aggregate))
        .collect::<Vec<_>>()
        .join(",\n       ");

    let sql = format!(
        "select {selected}
         from listening_events
         where {}",
        scope.clause
    );

    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            scope.values,
        ))
        .await?
        .ok_or_else(|| {
            // an aggregate-only select always returns exactly one row
            CadenzaError::DatabaseError("the analytics summary returned no row".to_owned())
        })?;

    Metric::ALL
        .iter()
        .enumerate()
        .map(|(i, metric)| {
            let value: i64 = row.try_get_by_index(i)?;
            Ok((metric.name.to_owned(), value))
        })
        .collect()
}

/// One point of a trend: the bucket it covers and the metric's value in it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrendPoint {
    /// The bucket's first day in the user's timezone, as `YYYY-MM-DD`.
    ///
    /// A local date rather than an instant, because that is what it is: a
    /// timestamp here would invite the client to re-shift it into some other
    /// zone and move the bucket.
    pub bucket: String,
    pub value: i64,
}

/// One metric bucketed over a window, densely: every bucket between `since` and
/// `until` comes back, and one with no events comes back as zero rather than
/// going missing. A chart drawn off a sparse series lies about its shape.
///
/// Both ends of the window are required here. The caller resolves "all time"
/// against [`get_event_bounds`] first, since a series needs somewhere to start.
///
/// `until` is exclusive and the series respects that: a seven day window returns
/// seven buckets, not eight with an empty one on the end.
///
/// Buckets are cut in `tz`, not UTC, because a week boundary in UTC is the wrong
/// week for most of the world. Each event's own `client_tz` is stored but not
/// used for this: one zone for the whole series keeps the buckets contiguous,
/// which they would not be for a user who travelled mid-window.
///
/// `unique_songs` counts distinct per bucket, so its buckets do not sum to the
/// summary's figure. That is the honest reading of "different songs that week".
pub async fn get_trend(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    metric: Metric,
    bucket: Bucket,
    since: DateTime<Utc>,
    until: DateTime<Utc>,
    tz: &str,
) -> Result<Vec<TrendPoint>, CadenzaError> {
    let window = TimeWindow::new(Some(since), Some(until))?;
    let mut scope = Scope::new(user_id, window, None);
    // both ends are Some, so the scope bound a placeholder for each
    let (since_p, until_p) = match (scope.since_param.clone(), scope.until_param.clone()) {
        (Some(since_p), Some(until_p)) => (since_p, until_p),
        _ => unreachable!("a trend window always has both ends"),
    };
    let tz_param = scope.bind(sanitize_timezone(tz).to_owned());
    let unit = scope.bind(bucket.trunc_unit().to_owned());
    // from the Bucket enum, never from a request
    let step = bucket.step();

    let sql = format!(
        "with bounds as (
             select date_trunc({unit}, {since_p}::timestamptz at time zone {tz_param}::text) as lo,
                    -- until is exclusive, so the last bucket wanted is the one
                    -- holding the final instant inside the window. truncating
                    -- until itself lands on the first bucket *outside* it, and
                    -- since the client's windows end on a local midnight that is
                    -- always a whole extra bar that can never hold an event
                    date_trunc(
                        {unit},
                        ({until_p}::timestamptz - interval '1 microsecond')
                            at time zone {tz_param}::text
                    ) as hi
         ),
         buckets as (
             select generate_series(lo, hi, '{step}'::interval) as bucket from bounds
         ),
         agg as (
             select date_trunc({unit}, occurred_at at time zone {tz_param}::text) as bucket,
                    {aggregate} as value
             from listening_events
             where {scope}
             group by 1
         )
         select to_char(buckets.bucket, 'YYYY-MM-DD') as bucket,
                coalesce(agg.value, 0)::bigint as value
         from buckets left join agg using (bucket)
         order by buckets.bucket",
        aggregate = metric.aggregate,
        scope = scope.clause,
    );

    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            scope.values,
        ))
        .await?;

    rows.into_iter()
        .map(|row| {
            Ok(TrendPoint {
                bucket: row.try_get_by_index(0)?,
                value: row.try_get_by_index(1)?,
            })
        })
        .collect()
}

/// The user's first and last event time, or `None` when they have no events.
/// What an all-time window resolves to.
pub async fn get_event_bounds(
    db: &impl ConnectionTrait,
    user_id: Uuid,
) -> Result<Option<(DateTime<Utc>, DateTime<Utc>)>, CadenzaError> {
    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "select min(occurred_at), max(occurred_at) from listening_events where user_id = $1",
            [user_id.into()],
        ))
        .await?;

    let Some(row) = row else { return Ok(None) };
    let first: Option<DateTime<Utc>> = row.try_get_by_index(0)?;
    let last: Option<DateTime<Utc>> = row.try_get_by_index(1)?;
    Ok(first.zip(last))
}

/// One row of a "most played" ranking: whatever it is, how often, and enough to
/// draw and open it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntityPlays {
    /// The group key. Opaque to the client; it only needs it as a list key.
    pub key: String,
    /// What to show. `None` for songs, whose titles live in Apple Music.
    pub label: Option<String>,
    /// A second line, or `None` when there is nothing to add.
    pub sub_label: Option<String>,
    /// The id needed to open the thing, when any play recorded one.
    pub entity_id: Option<String>,
    /// A song in the group. Its artwork is the album's, and a fair stand-in for
    /// an artist, so the client resolves every row's art in one batch of these.
    pub sample_song_id: String,
    pub plays: i64,
}

/// The user's most played songs, artists, or albums over a window, most played
/// first.
///
/// One query whatever the dimension: [`Dimension`] supplies the group key and
/// the label, so a new dimension needs no change here.
///
/// Artist and album read the names out of the event payload, which means a play
/// recorded before the client started writing them is invisible to those two
/// dimensions. Nothing is affected today because the log was empty when the
/// payload gained them, which is why that change went first.
pub async fn get_top_entities(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    dimension: Dimension,
    window: TimeWindow,
    limit: u64,
) -> Result<Vec<EntityPlays>, CadenzaError> {
    let mut scope = Scope::new(user_id, window, None);
    let limit_param = scope.bind(limit as i64);

    let sql = format!(
        "with plays as (
             select {key} as group_key,
                    {label} as label,
                    {sub_label} as sub_label,
                    {entity_id} as entity_id,
                    song_id,
                    occurred_at
             from listening_events
             where {scope} and event_type = 'play_counted' and song_id is not null
         )
         select group_key,
                -- the newest spelling wins, so a renamed album reads as its new name
                (array_agg(label     order by occurred_at desc))[1] as label,
                (array_agg(sub_label order by occurred_at desc))[1] as sub_label,
                -- nulls sort last, so the group keeps an id even when one play
                -- was a library copy that had none
                (array_agg(entity_id order by (entity_id is null), occurred_at desc))[1]
                    as entity_id,
                -- the group's most played song, so the artwork is representative
                mode() within group (order by song_id) as sample_song_id,
                count(*)::bigint as plays
         from plays
         where group_key is not null
         group by group_key
         order by plays desc, label nulls last, group_key
         limit {limit_param}",
        key = dimension.key_expr,
        label = dimension.label_expr,
        sub_label = dimension.sub_label_expr,
        entity_id = dimension.entity_id_expr,
        scope = scope.clause,
    );

    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            scope.values,
        ))
        .await?;

    rows.into_iter()
        .map(|row| {
            Ok(EntityPlays {
                key: row.try_get_by_index(0)?,
                label: row.try_get_by_index(1)?,
                sub_label: row.try_get_by_index(2)?,
                entity_id: row.try_get_by_index(3)?,
                sample_song_id: row.try_get_by_index(4)?,
                plays: row.try_get_by_index(5)?,
            })
        })
        .collect()
}

/// A song the user replayed, and how hard.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SongReplays {
    pub song_id: String,
    /// The most plays it got inside one listening session.
    pub most_in_one_session: i64,
    /// Its plays across every session in the window.
    pub plays: i64,
}

/// Songs the user put on repeat, worst offender first.
///
/// A replay is more than one `play_counted` for the same song inside one
/// session, which is what distinguishes "played it six times in a row tonight"
/// from "played it six times over six weeks". Events with no session id cannot
/// say either way and are left out.
pub async fn get_most_replayed(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    window: TimeWindow,
    limit: u64,
) -> Result<Vec<SongReplays>, CadenzaError> {
    let mut scope = Scope::new(user_id, window, None);
    let limit_param = scope.bind(limit as i64);

    let sql = format!(
        "with per_session as (
             select song_id, session_id, count(*)::bigint as plays_in_session
             from listening_events
             where {} and event_type = 'play_counted'
                   and song_id is not null and session_id is not null
             group by song_id, session_id
         )
         select song_id,
                max(plays_in_session)::bigint as most_in_one_session,
                sum(plays_in_session)::bigint as plays
         from per_session
         group by song_id
         having max(plays_in_session) > 1
         order by most_in_one_session desc, plays desc, song_id
         limit {limit_param}",
        scope.clause
    );

    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            scope.values,
        ))
        .await?;

    rows.into_iter()
        .map(|row| {
            Ok(SongReplays {
                song_id: row.try_get_by_index(0)?,
                most_in_one_session: row.try_get_by_index(1)?,
                plays: row.try_get_by_index(2)?,
            })
        })
        .collect()
}

/// A tag and how many plays landed on songs carrying it.
///
/// Carries the whole tag, not just its name, so the client can draw it with the
/// same tag component as everywhere else rather than inventing a stand-in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TagPlays {
    pub tag_id: i64,
    pub name: String,
    pub color: String,
    /// The `tag_type` enum, by name. Read as text and matched in Rust, the same
    /// way `queries.rs` reads it, rather than decoding a postgres enum out of a
    /// raw statement.
    pub tag_type: TagType,
    pub plays: i64,
}

/// The tags the user actually listens to, by plays of the songs they are on.
///
/// Counts the user's own tags only. Activity tags are excluded because every
/// played song has My Plays on it by construction, so they would take every top
/// slot and say nothing.
pub async fn get_top_tags_by_play(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    window: TimeWindow,
    limit: u64,
) -> Result<Vec<TagPlays>, CadenzaError> {
    let mut scope = Scope::new(user_id, window, Some("e"));
    let limit_param = scope.bind(limit as i64);

    // the scope's user_id is $1, which is also the tag owner we want
    let sql = format!(
        "select t.tag_id, t.name, t.color, t.type::text, count(*)::bigint as plays
         from listening_events e
         join user_tags_applied uta
             on uta.song_id = e.song_id and uta.user_id = e.user_id
         join tags t on t.tag_id = uta.tag_id
         where {} and e.event_type = 'play_counted' and t.is_activity = false
         group by t.tag_id, t.name, t.color, t.type
         order by plays desc, t.name
         limit {limit_param}",
        scope.clause
    );

    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            scope.values,
        ))
        .await?;

    rows.into_iter()
        .map(|row| {
            let type_name: String = row.try_get_by_index(3)?;
            Ok(TagPlays {
                tag_id: row.try_get_by_index(0)?,
                name: row.try_get_by_index(1)?,
                color: row.try_get_by_index(2)?,
                tag_type: tag_type_from_name(&type_name)?,
                plays: row.try_get_by_index(4)?,
            })
        })
        .collect()
}

/// A `tag_type` read back as text. The forward direction lives in
/// `activity_tags::tag_type_name`.
fn tag_type_from_name(name: &str) -> Result<TagType, CadenzaError> {
    match name {
        "basic" => Ok(TagType::Basic),
        "text" => Ok(TagType::Text),
        "datetime" => Ok(TagType::Datetime),
        "number" => Ok(TagType::Number),
        "checkbox" => Ok(TagType::Checkbox),
        "date" => Ok(TagType::Date),
        other => Err(CadenzaError::DatabaseError(format!(
            "unknown tag type '{other}'"
        ))),
    }
}

/// Plays in each hour of the user's local day, always 24 entries, index 0 being
/// midnight. Answers when they listen rather than how much.
pub async fn get_plays_by_hour(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    window: TimeWindow,
    tz: &str,
) -> Result<Vec<i64>, CadenzaError> {
    let mut scope = Scope::new(user_id, window, None);
    let tz_param = scope.bind(sanitize_timezone(tz).to_owned());

    let sql = format!(
        "select extract(hour from occurred_at at time zone {tz_param}::text)::int as hour,
                count(*)::bigint as plays
         from listening_events
         where {} and event_type = 'play_counted'
         group by 1",
        scope.clause
    );

    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            scope.values,
        ))
        .await?;

    // dense, so the client can render 24 bars without filling gaps itself
    let mut by_hour = vec![0i64; 24];
    for row in rows {
        let hour: i32 = row.try_get_by_index(0)?;
        let plays: i64 = row.try_get_by_index(1)?;
        if let Some(slot) = by_hour.get_mut(hour as usize) {
            *slot = plays;
        }
    }
    Ok(by_hour)
}

/// How many distinct local days the user played something on.
pub async fn get_active_days(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    window: TimeWindow,
    tz: &str,
) -> Result<i64, CadenzaError> {
    let mut scope = Scope::new(user_id, window, None);
    let tz_param = scope.bind(sanitize_timezone(tz).to_owned());

    let sql = format!(
        "select count(distinct date_trunc('day', occurred_at at time zone {tz_param}::text))::bigint
         from listening_events
         where {} and event_type = 'play_counted'",
        scope.clause
    );

    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            scope.values,
        ))
        .await?
        .ok_or_else(|| CadenzaError::DatabaseError("active days returned no row".to_owned()))?;

    Ok(row.try_get_by_index(0)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::events::{NewEvent, insert_events};
    use crate::services::analytics::EventType;
    use chrono::TimeZone;
    use sea_orm::{Database, DatabaseTransaction, TransactionTrait};
    use serde_json::json;

    fn at(iso: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(iso)
            .unwrap()
            .with_timezone(&Utc)
    }

    /// A `play_counted` payload carrying the artist and album the client writes,
    /// which is what the artist and album rankings group by.
    fn counted(artist: &str, album: &str) -> serde_json::Value {
        json!({ "artist_name": artist, "album_name": album })
    }

    /// The same, with the catalog ids a library-only copy would not have.
    fn counted_with_ids(
        artist: &str,
        artist_id: &str,
        album: &str,
        album_id: &str,
    ) -> serde_json::Value {
        json!({
            "artist_name": artist,
            "artist_id": artist_id,
            "album_name": album,
            "album_id": album_id,
        })
    }

    fn event(
        event_type: EventType,
        song_id: Option<&str>,
        occurred_at: &str,
        id: &str,
        session: Option<Uuid>,
        payload: serde_json::Value,
    ) -> NewEvent {
        NewEvent {
            event_type,
            song_id: song_id.map(str::to_owned),
            occurred_at: at(occurred_at),
            client_tz: "America/Denver".to_owned(),
            session_id: session,
            client_event_id: id.to_owned(),
            payload,
        }
    }

    /// A transaction that is never committed, and a user that really exists, so
    /// the foreign key holds. Dropping the transaction undoes everything.
    async fn scratch() -> (DatabaseTransaction, Uuid) {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let db = Database::connect(url).await.expect("connect");
        let txn = db.begin().await.expect("begin");

        let row = txn
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                "select id from auth.users limit 1",
            ))
            .await
            .expect("query users")
            .expect("the database needs at least one user for this test");
        let user_id: Uuid = row.try_get_by_index(0).expect("user id");

        (txn, user_id)
    }

    /// A spread of events covering every aggregate, so one seed drives all the
    /// assertions below.
    ///
    /// Three plays of song A, two of them in one session (a replay), one play and
    /// one skip of song B, a query run, and a query play.
    ///
    /// Song A is played twice as a catalog copy, with artist and album ids, and
    /// once as a library copy without them. The artist and album rankings have to
    /// read that as one artist and one album.
    async fn seed(txn: &DatabaseTransaction, user_id: Uuid) {
        let session = Uuid::from_u128(1);
        let other_session = Uuid::from_u128(2);
        let events = vec![
            event(
                EventType::PlayStart,
                Some("A"),
                "2026-09-07T20:00:00Z",
                "e1",
                Some(session),
                json!({}),
            ),
            event(
                EventType::PlayCounted,
                Some("A"),
                "2026-09-07T20:00:20Z",
                "e2",
                Some(session),
                counted_with_ids("Phoebe Bridgers", "966309175", "Punisher", "1504438806"),
            ),
            event(
                EventType::PlayComplete,
                Some("A"),
                "2026-09-07T20:03:00Z",
                "e3",
                Some(session),
                json!({"listened_ms": 180_000}),
            ),
            // same song again in the same session: that is the replay
            event(
                EventType::PlayCounted,
                Some("A"),
                "2026-09-07T20:06:00Z",
                "e4",
                Some(session),
                counted_with_ids("Phoebe Bridgers", "966309175", "Punisher", "1504438806"),
            ),
            event(
                EventType::PlayComplete,
                Some("A"),
                "2026-09-07T20:09:00Z",
                "e5",
                Some(session),
                json!({"listened_ms": 180_000}),
            ),
            // a week later, a different session
            event(
                EventType::PlayCounted,
                Some("A"),
                "2026-09-14T20:00:00Z",
                "e6",
                Some(other_session),
                // the library copy of the same song: same names, no catalog ids.
                // this is what the name-keyed grouping has to merge with e2/e4
                counted("Phoebe Bridgers", "Punisher"),
            ),
            event(
                EventType::PlayCounted,
                Some("B"),
                "2026-09-14T21:00:00Z",
                "e7",
                Some(other_session),
                counted("Fontaines D.C.", "Romance"),
            ),
            // skipped early, so it counts as an early skip too
            event(
                EventType::Skip,
                Some("B"),
                "2026-09-14T21:00:04Z",
                "e8",
                Some(other_session),
                json!({"listened_ms": 4_000, "position_ms": 4_000}),
            ),
            event(
                EventType::QueryRun,
                None,
                "2026-09-14T21:05:00Z",
                "e9",
                Some(other_session),
                json!({"result_count": 12}),
            ),
            // song B again, this time started from a query's results
            event(
                EventType::QueryPlay,
                Some("B"),
                "2026-09-14T21:06:00Z",
                "e10",
                Some(other_session),
                json!({"result_count": 12}),
            ),
        ];

        let stored = insert_events(txn, user_id, &events).await.expect("insert");
        assert_eq!(stored.inserted.len(), 10, "every seeded event is new");
        assert_eq!(stored.accepted.len(), 10);
    }

    fn window() -> TimeWindow {
        TimeWindow::new(
            Some(at("2026-09-01T00:00:00Z")),
            Some(at("2026-10-01T00:00:00Z")),
        )
        .unwrap()
    }

    // ----- these need the database -----

    #[tokio::test]
    #[ignore]
    async fn a_resent_batch_inserts_nothing_and_still_accepts() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let again = vec![event(
            EventType::PlayCounted,
            Some("A"),
            "2026-09-07T20:00:20Z",
            "e2",
            None,
            json!({}),
        )];
        let stored = insert_events(&txn, user_id, &again).await.unwrap();
        assert!(stored.inserted.is_empty(), "the row was already there");
        assert_eq!(stored.accepted, vec!["e2".to_owned()], "still safe to drop");
    }

    #[tokio::test]
    #[ignore]
    async fn the_summary_counts_what_was_seeded() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let stats = get_summary(&txn, user_id, window()).await.unwrap();

        assert_eq!(stats["plays"], 4, "e2, e4, e6, e7");
        assert_eq!(stats["starts"], 1);
        assert_eq!(stats["completions"], 2);
        assert_eq!(stats["skips"], 1);
        assert_eq!(stats["early_skips"], 1, "skipped at 4s, under the 10s line");
        assert_eq!(stats["unique_songs"], 2, "A and B");
        assert_eq!(stats["listening_ms"], 364_000, "180k + 180k + 4k");
        assert_eq!(stats["query_plays"], 1, "e10");
        // every metric answers, so a new one cannot quietly go missing
        assert_eq!(stats.len(), Metric::ALL.len());
    }

    #[tokio::test]
    #[ignore]
    async fn a_user_with_no_events_gets_zeros_not_an_error() {
        let (txn, _) = scratch().await;
        // a user id that cannot have events, so the window is genuinely empty
        let nobody = Uuid::from_u128(0);

        let stats = get_summary(&txn, nobody, TimeWindow::ALL_TIME)
            .await
            .unwrap();
        assert_eq!(stats.len(), Metric::ALL.len());
        assert!(stats.values().all(|&v| v == 0), "{stats:?}");

        assert_eq!(get_event_bounds(&txn, nobody).await.unwrap(), None);
        for dimension in Dimension::ALL {
            assert!(
                get_top_entities(&txn, nobody, dimension, TimeWindow::ALL_TIME, 10)
                    .await
                    .unwrap()
                    .is_empty(),
                "{} should be empty",
                dimension.name
            );
        }
        assert!(
            get_most_replayed(&txn, nobody, TimeWindow::ALL_TIME, 10)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            get_top_tags_by_play(&txn, nobody, TimeWindow::ALL_TIME, 10)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            get_active_days(&txn, nobody, TimeWindow::ALL_TIME, "UTC")
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            get_plays_by_hour(&txn, nobody, TimeWindow::ALL_TIME, "UTC")
                .await
                .unwrap(),
            vec![0i64; 24]
        );
    }

    /// `until` is exclusive, so a seven day window is seven bars.
    ///
    /// The window here is exactly what the client sends for its Week range:
    /// local midnight to local midnight seven days later. That boundary is the
    /// case that regressed, and the older trend test missed it because its
    /// `until` was not on a Denver bucket boundary.
    #[tokio::test]
    #[ignore]
    async fn a_window_ending_on_a_bucket_boundary_has_no_trailing_bucket() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let plays = Metric::from_name("plays").unwrap();
        // 2026-09-27 00:00 and 2026-10-04 00:00, Denver
        let points = get_trend(
            &txn,
            user_id,
            plays,
            Bucket::Day,
            at("2026-09-27T06:00:00Z"),
            at("2026-10-04T06:00:00Z"),
            "America/Denver",
        )
        .await
        .unwrap();

        assert_eq!(points.len(), 7, "seven days is seven bars: {points:?}");
        assert_eq!(points[0].bucket, "2026-09-27");
        assert_eq!(
            points[6].bucket, "2026-10-03",
            "the last bar is the last day inside the window, not the day after"
        );
    }

    #[tokio::test]
    #[ignore]
    async fn a_twelve_month_window_has_twelve_buckets() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let plays = Metric::from_name("plays").unwrap();
        // the client's Year range: the 1st, eleven months back, to the 1st of
        // next month
        let points = get_trend(
            &txn,
            user_id,
            plays,
            Bucket::Month,
            at("2025-11-01T06:00:00Z"),
            at("2026-11-01T06:00:00Z"),
            "America/Denver",
        )
        .await
        .unwrap();

        assert_eq!(points.len(), 12, "{points:?}");
        assert_eq!(points[0].bucket, "2025-11-01");
        assert_eq!(points[11].bucket, "2026-10-01");
    }

    /// A window that stops mid-bucket still shows the bucket it stops inside.
    #[tokio::test]
    #[ignore]
    async fn a_partial_last_bucket_is_still_a_bucket() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let plays = Metric::from_name("plays").unwrap();
        let points = get_trend(
            &txn,
            user_id,
            plays,
            Bucket::Day,
            at("2026-09-27T06:00:00Z"),
            // midday on the 3rd, not a boundary
            at("2026-10-03T18:00:00Z"),
            "America/Denver",
        )
        .await
        .unwrap();

        assert_eq!(points.len(), 7, "{points:?}");
        assert_eq!(points[6].bucket, "2026-10-03");
    }

    #[tokio::test]
    #[ignore]
    async fn trend_buckets_are_dense_and_cut_in_the_users_zone() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let plays = Metric::from_name("plays").unwrap();
        let points = get_trend(
            &txn,
            user_id,
            plays,
            Bucket::Week,
            at("2026-09-01T00:00:00Z"),
            at("2026-09-29T00:00:00Z"),
            "America/Denver",
        )
        .await
        .unwrap();

        // weeks start on monday, so 2026-08-31 through 2026-09-28: five buckets,
        // and the empty ones are present as zero rather than missing
        assert_eq!(points.len(), 5, "{points:?}");
        let total: i64 = points.iter().map(|p| p.value).sum();
        assert_eq!(total, 4, "every play lands in some bucket");

        let by_bucket: HashMap<&str, i64> = points
            .iter()
            .map(|p| (p.bucket.as_str(), p.value))
            .collect();
        // 2026-09-07 20:00 UTC is 14:00 in Denver, same day, week of the 7th
        assert_eq!(by_bucket["2026-09-07"], 2, "e2 and e4");
        assert_eq!(by_bucket["2026-09-14"], 2, "e6 and e7");
        assert_eq!(by_bucket["2026-09-21"], 0, "a quiet week is a zero");
    }

    #[tokio::test]
    #[ignore]
    async fn a_day_bucket_respects_the_timezone() {
        let (txn, user_id) = scratch().await;
        // 01:30 UTC is still the previous evening in Denver
        let events = vec![event(
            EventType::PlayCounted,
            Some("A"),
            "2026-09-08T01:30:00Z",
            "tz1",
            None,
            json!({}),
        )];
        insert_events(&txn, user_id, &events).await.unwrap();

        let plays = Metric::from_name("plays").unwrap();
        let denver = get_trend(
            &txn,
            user_id,
            plays,
            Bucket::Day,
            at("2026-09-07T00:00:00Z"),
            at("2026-09-09T00:00:00Z"),
            "America/Denver",
        )
        .await
        .unwrap();
        let utc = get_trend(
            &txn,
            user_id,
            plays,
            Bucket::Day,
            at("2026-09-07T00:00:00Z"),
            at("2026-09-09T00:00:00Z"),
            "UTC",
        )
        .await
        .unwrap();

        let play_day =
            |points: Vec<TrendPoint>| points.into_iter().find(|p| p.value > 0).map(|p| p.bucket);
        assert_eq!(play_day(denver).as_deref(), Some("2026-09-07"));
        assert_eq!(play_day(utc).as_deref(), Some("2026-09-08"));
    }

    /// Looks a dimension up by name the way the routes do.
    fn dimension(name: &str) -> Dimension {
        Dimension::from_name(name).expect(name)
    }

    #[tokio::test]
    #[ignore]
    async fn top_songs_and_replays_read_the_sessions() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let top = get_top_entities(&txn, user_id, dimension("song"), window(), 10)
            .await
            .unwrap();
        assert_eq!(top[0].key, "A");
        assert_eq!(top[0].plays, 3);
        // a song carries no label: Apple Music owns the title
        assert_eq!(top[0].label, None);
        assert_eq!(top[0].sample_song_id, "A");
        assert_eq!(top[1].key, "B");
        assert_eq!(top[1].plays, 1);

        let replayed = get_most_replayed(&txn, user_id, window(), 10)
            .await
            .unwrap();
        // only A was played twice inside one session. B was played once, so it is
        // not a replay even though it has plays in the window
        assert_eq!(
            replayed,
            vec![SongReplays {
                song_id: "A".to_owned(),
                most_in_one_session: 2,
                plays: 3,
            }]
        );
    }

    /// The reason the key is the name and not the id. Song A was played twice as
    /// a catalog copy, which carries ids, and once as a library copy, which does
    /// not. An id-first key would make that two artists.
    #[tokio::test]
    #[ignore]
    async fn a_library_copy_and_a_catalog_copy_are_one_artist() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let top = get_top_entities(&txn, user_id, dimension("artist"), window(), 10)
            .await
            .unwrap();

        let phoebe: Vec<_> = top
            .iter()
            .filter(|row| row.label.as_deref() == Some("Phoebe Bridgers"))
            .collect();
        assert_eq!(phoebe.len(), 1, "one artist, not one per copy: {top:?}");
        assert_eq!(phoebe[0].plays, 3, "all three plays counted");
        assert_eq!(
            phoebe[0].entity_id.as_deref(),
            Some("966309175"),
            "the id survives the play that had none"
        );
    }

    #[tokio::test]
    #[ignore]
    async fn albums_merge_the_same_way_and_name_their_artist() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let top = get_top_entities(&txn, user_id, dimension("album"), window(), 10)
            .await
            .unwrap();

        assert_eq!(top[0].label.as_deref(), Some("Punisher"));
        assert_eq!(top[0].sub_label.as_deref(), Some("Phoebe Bridgers"));
        assert_eq!(top[0].plays, 3);
        assert_eq!(top[0].entity_id.as_deref(), Some("1504438806"));
    }

    /// The reason the album key carries the artist. Two unrelated albums that
    /// share a title are two albums.
    #[tokio::test]
    #[ignore]
    async fn two_albums_sharing_a_title_stay_apart() {
        let (txn, user_id) = scratch().await;
        let events = vec![
            event(
                EventType::PlayCounted,
                Some("x"),
                "2026-09-10T10:00:00Z",
                "g1",
                None,
                counted("Queen", "Greatest Hits"),
            ),
            event(
                EventType::PlayCounted,
                Some("y"),
                "2026-09-10T11:00:00Z",
                "g2",
                None,
                counted("ABBA", "Greatest Hits"),
            ),
        ];
        insert_events(&txn, user_id, &events).await.unwrap();

        let top = get_top_entities(&txn, user_id, dimension("album"), window(), 10)
            .await
            .unwrap();
        assert_eq!(top.len(), 2, "{top:?}");
        assert_eq!(top[0].plays, 1);
        assert_eq!(top[1].plays, 1);
    }

    /// Two different artists who really do share a name merge. Stated as a test
    /// so the trade is on the record rather than a surprise.
    #[tokio::test]
    #[ignore]
    async fn two_artists_sharing_a_name_merge() {
        let (txn, user_id) = scratch().await;
        let events = vec![
            event(
                EventType::PlayCounted,
                Some("x"),
                "2026-09-10T10:00:00Z",
                "n1",
                None,
                counted_with_ids("Nirvana", "111", "Nevermind", "a1"),
            ),
            event(
                EventType::PlayCounted,
                Some("y"),
                "2026-09-10T11:00:00Z",
                "n2",
                None,
                counted_with_ids("nirvana", "222", "Me, Us, All", "a2"),
            ),
        ];
        insert_events(&txn, user_id, &events).await.unwrap();

        let top = get_top_entities(&txn, user_id, dimension("artist"), window(), 10)
            .await
            .unwrap();
        assert_eq!(top.len(), 1, "case folds, so these merge: {top:?}");
        assert_eq!(top[0].plays, 2);
    }

    #[tokio::test]
    #[ignore]
    async fn a_play_with_no_artist_name_is_left_out_of_the_artist_ranking() {
        let (txn, user_id) = scratch().await;
        let events = vec![
            event(
                EventType::PlayCounted,
                Some("x"),
                "2026-09-10T10:00:00Z",
                "b1",
                None,
                json!({}),
            ),
            event(
                EventType::PlayCounted,
                Some("y"),
                "2026-09-10T11:00:00Z",
                "b2",
                None,
                json!({ "artist_name": "   " }),
            ),
            event(
                EventType::PlayCounted,
                Some("z"),
                "2026-09-10T12:00:00Z",
                "b3",
                None,
                counted("black midi", "Hellfire"),
            ),
        ];
        insert_events(&txn, user_id, &events).await.unwrap();

        let top = get_top_entities(&txn, user_id, dimension("artist"), window(), 10)
            .await
            .unwrap();
        assert_eq!(top.len(), 1, "only the one with a name: {top:?}");
        assert_eq!(top[0].label.as_deref(), Some("black midi"));

        // the songs ranking still counts all three, since it needs no payload
        let songs = get_top_entities(&txn, user_id, dimension("song"), window(), 10)
            .await
            .unwrap();
        assert_eq!(songs.len(), 3);
    }

    #[tokio::test]
    #[ignore]
    async fn a_play_with_no_album_name_is_left_out_of_the_album_ranking() {
        let (txn, user_id) = scratch().await;
        let events = vec![
            event(
                EventType::PlayCounted,
                Some("x"),
                "2026-09-10T10:00:00Z",
                "c1",
                None,
                // an artist but no album, which a single often has
                json!({ "artist_name": "Caroline Polachek" }),
            ),
            event(
                EventType::PlayCounted,
                Some("y"),
                "2026-09-10T11:00:00Z",
                "c2",
                None,
                json!({ "artist_name": "black midi", "album_name": "  " }),
            ),
        ];
        insert_events(&txn, user_id, &events).await.unwrap();

        let albums = get_top_entities(&txn, user_id, dimension("album"), window(), 10)
            .await
            .unwrap();
        assert!(albums.is_empty(), "no album name, no album row: {albums:?}");

        // but both still count as artists
        let artists = get_top_entities(&txn, user_id, dimension("artist"), window(), 10)
            .await
            .unwrap();
        assert_eq!(artists.len(), 2);
    }

    #[tokio::test]
    #[ignore]
    async fn the_sample_song_is_one_the_group_was_played_from() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let top = get_top_entities(&txn, user_id, dimension("artist"), window(), 10)
            .await
            .unwrap();
        let phoebe = top
            .iter()
            .find(|row| row.label.as_deref() == Some("Phoebe Bridgers"))
            .unwrap();
        // mode() breaks a tie arbitrarily, so assert membership, not identity
        assert_eq!(phoebe.sample_song_id, "A");

        let fontaines = top
            .iter()
            .find(|row| row.label.as_deref() == Some("Fontaines D.C."))
            .unwrap();
        assert_eq!(fontaines.sample_song_id, "B");
    }

    #[tokio::test]
    #[ignore]
    async fn a_limit_cuts_the_ranking() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let top = get_top_entities(&txn, user_id, dimension("song"), window(), 1)
            .await
            .unwrap();
        assert_eq!(top.len(), 1);
        assert_eq!(top[0].key, "A", "the most played survives the cut");
    }

    /// The registry's point: a dimension needs no query of its own.
    #[tokio::test]
    #[ignore]
    async fn every_dimension_answers_over_every_window() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        for dimension in Dimension::ALL {
            for window in [window(), TimeWindow::ALL_TIME] {
                let top = get_top_entities(&txn, user_id, dimension, window, 10)
                    .await
                    .unwrap_or_else(|e| panic!("{} failed: {e}", dimension.name));
                assert!(!top.is_empty(), "{} came back empty", dimension.name);
            }
        }
    }

    #[tokio::test]
    #[ignore]
    async fn a_tag_ranking_carries_the_whole_tag() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        // the seed applies no tags, so this is the empty case; what matters is
        // that the widened select and the enum decode both run
        let tags = get_top_tags_by_play(&txn, user_id, window(), 10)
            .await
            .unwrap();
        assert!(tags.is_empty(), "{tags:?}");
    }

    #[tokio::test]
    #[ignore]
    async fn plays_by_hour_is_always_twenty_four_local_hours() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let by_hour = get_plays_by_hour(&txn, user_id, window(), "America/Denver")
            .await
            .unwrap();
        assert_eq!(by_hour.len(), 24);
        assert_eq!(by_hour.iter().sum::<i64>(), 4);
        // 20:00 and 20:06 UTC are 14:00 Denver, 20:00 and 21:00 on the 14th are
        // 14:00 and 15:00
        assert_eq!(by_hour[14], 3);
        assert_eq!(by_hour[15], 1);

        let active = get_active_days(&txn, user_id, window(), "America/Denver")
            .await
            .unwrap();
        assert_eq!(active, 2, "the 7th and the 14th");
    }

    #[tokio::test]
    #[ignore]
    async fn a_narrow_window_excludes_what_falls_outside_it() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let first_week = TimeWindow::new(
            Some(at("2026-09-07T00:00:00Z")),
            Some(at("2026-09-08T00:00:00Z")),
        )
        .unwrap();
        let stats = get_summary(&txn, user_id, first_week).await.unwrap();
        assert_eq!(stats["plays"], 2, "only the two on the 7th");
        assert_eq!(stats["skips"], 0, "the skip was a week later");
    }

    #[tokio::test]
    #[ignore]
    async fn event_bounds_frame_the_whole_history() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        let (first, last) = get_event_bounds(&txn, user_id).await.unwrap().unwrap();
        assert_eq!(first, Utc.with_ymd_and_hms(2026, 9, 7, 20, 0, 0).unwrap());
        assert_eq!(last, Utc.with_ymd_and_hms(2026, 9, 14, 21, 6, 0).unwrap());
    }

    #[tokio::test]
    #[ignore]
    async fn every_metric_can_be_bucketed_by_every_bucket() {
        let (txn, user_id) = scratch().await;
        seed(&txn, user_id).await;

        // the point of the registry: no metric needs its own trend handler
        for metric in Metric::ALL {
            for bucket in Bucket::ALL {
                let points = get_trend(
                    &txn,
                    user_id,
                    metric,
                    bucket,
                    at("2026-09-01T00:00:00Z"),
                    at("2026-09-29T00:00:00Z"),
                    "America/Denver",
                )
                .await
                .unwrap_or_else(|e| panic!("{} by {bucket} failed: {e}", metric.name));
                assert!(
                    !points.is_empty(),
                    "{} by {bucket} came back empty",
                    metric.name
                );
            }
        }
    }
}
