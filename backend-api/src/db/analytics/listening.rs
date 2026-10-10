//! Listening time and session reads. Tag membership is an EXISTS predicate,
//! so a song with ten tags still contributes one event to a filtered read.

use chrono::{DateTime, Utc};
use sea_orm::{ConnectionTrait, DbBackend, Statement, prelude::Uuid};

use super::Scope;
use crate::{
    err::CadenzaError,
    services::analytics::{Bucket, LISTEN_EVENTS, LISTENED_MS, TimeWindow, sanitize_timezone},
};

#[derive(Debug)]
pub struct ListeningCell {
    pub start: String,
    pub listening_ms: i64,
    pub plays: i64,
}

#[derive(Debug)]
pub struct Listening {
    pub total_ms: i64,
    pub listening_ms: i64,
    pub plays: i64,
    pub session_count: i64,
    pub cells: Vec<ListeningCell>,
}

#[derive(Debug)]
pub struct Session {
    /// Legacy events without a session are a separate group, not a new session.
    pub key: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub listening_ms: i64,
    pub plays: i64,
}

/// Which recorded session a song list is narrowed to.
#[derive(Debug, Clone, Copy)]
pub enum SessionFilter {
    /// Every event in the window, whatever its session.
    Any,
    /// One recorded session.
    One(Uuid),
    /// Legacy events without a session id.
    Unassigned,
}

#[derive(Debug)]
pub struct SessionSong {
    pub song_id: String,
    pub listening_ms: i64,
    pub plays: i64,
    pub tags: Vec<String>,
}

/// The duration expression is shared with the summary. Attribution follows
/// the event timestamp, including a completion recorded after midnight.
fn events(user_id: Uuid, window: TimeWindow, tag_id: Option<i64>) -> (Scope, String) {
    let mut scope = Scope::new(user_id, window, Some("e"));
    let matched = match tag_id {
        Some(id) => {
            let tag = scope.bind(id);
            format!(
                "exists (
                select 1 from user_tags_applied uta
                join tags t on t.tag_id = uta.tag_id
                where uta.user_id = e.user_id and uta.song_id = e.song_id
                    and t.user_id = e.user_id and not t.is_activity
                    and t.tag_id = {tag}
            )"
            )
        }
        None => "true".to_owned(),
    };
    let sql = format!(
        "events as (
        select e.song_id, e.session_id, e.occurred_at, e.event_type,
            case when {LISTEN_EVENTS} then coalesce({LISTENED_MS}, 0) else 0 end as ms,
            {matched} as matched
        from listening_events e
        where {} and e.event_type in ('play_start', 'play_counted', 'play_complete', 'skip')
    )",
        scope.clause
    );
    (scope, sql)
}

/// One snapshot supplies both the total and filtered time, with no tag join
/// multiplying the total. The total row exists even for an empty window.
pub async fn get_listening(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    window: TimeWindow,
    bucket: Bucket,
    tz: &str,
    tag_id: Option<i64>,
) -> Result<Listening, CadenzaError> {
    let (mut scope, events) = events(user_id, window, tag_id);
    let tz = scope.bind(sanitize_timezone(tz).to_owned());
    let label = scope.bind(bucket.label_format().to_owned());
    let cell = bucket.truncate(&format!("occurred_at at time zone {tz}::text"));
    let sql = format!("with {events},
        total as (
            select coalesce(sum(ms), 0)::bigint as total_ms,
                coalesce(sum(ms) filter (where matched), 0)::bigint as listening_ms,
                count(*) filter (where matched and event_type = 'play_counted')::bigint as plays,
                count(distinct session_id) filter (where matched and (ms > 0 or event_type = 'play_counted'))::bigint as session_count
            from events
        ), cells as (
            select {cell} as cell, sum(ms)::bigint as ms,
                count(*) filter (where event_type = 'play_counted')::bigint as plays
            from events where matched group by 1
            having sum(ms) <> 0 or count(*) filter (where event_type = 'play_counted') > 0
        )
        select total.*, to_char(cells.cell, {label}), cells.ms, cells.plays
        from total left join cells on true order by cells.cell");
    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            scope.values,
        ))
        .await?;
    let total = rows
        .first()
        .ok_or_else(|| CadenzaError::DatabaseError("listening returned no total".to_owned()))?;
    let mut result = Listening {
        total_ms: total.try_get_by_index(0)?,
        listening_ms: total.try_get_by_index(1)?,
        plays: total.try_get_by_index(2)?,
        session_count: total.try_get_by_index(3)?,
        cells: Vec::new(),
    };
    for row in rows {
        if let Some(start) = row.try_get_by_index::<Option<String>>(4)? {
            result.cells.push(ListeningCell {
                start,
                listening_ms: row.try_get_by_index(5)?,
                plays: row.try_get_by_index(6)?,
            });
        }
    }
    Ok(result)
}

/// Sessions are clipped to the requested window. Fetch one extra row to
/// report continuation without a second count query.
pub async fn get_sessions(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    window: TimeWindow,
    tag_id: Option<i64>,
    offset: i64,
    limit: i64,
) -> Result<Vec<Session>, CadenzaError> {
    let (mut scope, events) = events(user_id, window, tag_id);
    let offset = scope.bind(offset);
    let limit = scope.bind(limit + 1);
    let sql = format!(
        "with {events}
        select coalesce(session_id::text, 'unassigned') as key,
            min(occurred_at), max(occurred_at), sum(ms)::bigint,
            count(*) filter (where event_type = 'play_counted')::bigint as plays
        from events where matched
        group by session_id
        having sum(ms) > 0 or count(*) filter (where event_type = 'play_counted') > 0
        order by min(occurred_at) desc, key
        limit {limit} offset {offset}"
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
            Ok(Session {
                key: row.try_get_by_index(0)?,
                start: row.try_get_by_index(1)?,
                end: row.try_get_by_index(2)?,
                listening_ms: row.try_get_by_index(3)?,
                plays: row.try_get_by_index(4)?,
            })
        })
        .collect()
}

/// Songs within a window, optionally narrowed to one session. Tags are
/// collected after aggregation, so neither tag count nor repeated plays
/// multiply time.
pub async fn get_session_songs(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    window: TimeWindow,
    tag_id: Option<i64>,
    session: SessionFilter,
    offset: i64,
    limit: i64,
) -> Result<Vec<SessionSong>, CadenzaError> {
    let (mut scope, events) = events(user_id, window, tag_id);
    let session = match session {
        SessionFilter::Any => "true".to_owned(),
        SessionFilter::One(id) => format!("session_id = {}", scope.bind(id)),
        SessionFilter::Unassigned => "session_id is null".to_owned(),
    };
    let offset = scope.bind(offset);
    let limit = scope.bind(limit + 1);
    let sql = format!(
        "with {events}, songs as (
        select song_id, sum(ms)::bigint as ms,
            count(*) filter (where event_type = 'play_counted')::bigint as plays,
            min(occurred_at) as first_at
        from events where matched and {session} and song_id is not null
        group by song_id
        having sum(ms) > 0 or count(*) filter (where event_type = 'play_counted') > 0
    )
    select song_id, ms, plays, array(
        select distinct t.name from user_tags_applied uta
        join tags t on t.tag_id = uta.tag_id
        where uta.user_id = $1 and t.user_id = $1 and not t.is_activity
            and uta.song_id = songs.song_id order by t.name
    ) from songs order by first_at, song_id limit {limit} offset {offset}"
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
            Ok(SessionSong {
                song_id: row.try_get_by_index(0)?,
                listening_ms: row.try_get_by_index(1)?,
                plays: row.try_get_by_index(2)?,
                tags: row.try_get_by_index(3)?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{Database, TransactionTrait};

    /// Temporary tables shadow production names only in this transaction.
    /// No real listening, tag, or auth rows are modified.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn listening_filters_and_sessions_preserve_event_totals() {
        dotenvy::dotenv().ok();
        let db = Database::connect(std::env::var("DATABASE_URL").expect("DATABASE_URL"))
            .await
            .expect("connect test database");
        let txn = db.begin().await.unwrap();
        for sql in [
            "create temp table listening_events (user_id uuid, song_id text, session_id uuid, occurred_at timestamptz, event_type text, payload jsonb) on commit drop",
            "create temp table tags (tag_id bigint, user_id uuid, name text, is_activity boolean) on commit drop",
            "create temp table user_tags_applied (user_id uuid, song_id text, tag_id bigint) on commit drop",
        ] {
            txn.execute_raw(Statement::from_string(DbBackend::Postgres, sql))
                .await
                .unwrap();
        }
        let user = Uuid::new_v4();
        let session = Uuid::new_v4();
        let other_user = Uuid::new_v4();
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "insert into listening_events values
                ($1, 'A', $2, '2026-10-09T15:00:00Z', 'play_start', '{}'),
                ($1, 'A', $2, '2026-10-09T15:00:15Z', 'play_counted', '{}'),
                ($1, 'A', $2, '2026-10-09T15:03:00Z', 'play_complete', '{\"listened_ms\":180000}'),
                ($1, 'B', null, '2026-10-09T16:00:00Z', 'skip', '{\"listened_ms\":30000}'),
                ($1, 'A', $2, '2026-10-10T00:00:00Z', 'play_complete', '{\"listened_ms\":999999}'),
                ($3, 'A', $2, '2026-10-09T15:00:00Z', 'play_complete', '{\"listened_ms\":999999}')",
            [user.into(), session.into(), other_user.into()],
        ))
        .await
        .unwrap();
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "insert into tags select n, $1, 'Tag ' || n, false from generate_series(1, 10) n",
            [user.into()],
        ))
        .await
        .unwrap();
        txn.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
            "insert into user_tags_applied select $1, 'A', n from generate_series(1, 10) n union all select $1, 'A', 1",
            [user.into()])).await.unwrap();
        let window = TimeWindow::new(
            Some("2026-10-09T00:00:00Z".parse().unwrap()),
            Some("2026-10-10T00:00:00Z".parse().unwrap()),
        )
        .unwrap();
        let all = get_listening(&txn, user, window, Bucket::Hour, "America/Denver", None)
            .await
            .unwrap();
        assert_eq!(all.total_ms, 210_000);
        assert_eq!(all.listening_ms, all.total_ms);
        assert_eq!(all.plays, 1);
        assert_eq!(
            all.session_count, 1,
            "unassigned is not a fabricated session"
        );
        assert_eq!(
            all.cells.iter().map(|cell| cell.listening_ms).sum::<i64>(),
            all.total_ms
        );
        assert_eq!(all.cells[0].start, "2026-10-09T09:00");
        for tag in [1, 10] {
            let filtered = get_listening(&txn, user, window, Bucket::Day, "UTC", Some(tag))
                .await
                .unwrap();
            assert_eq!(filtered.total_ms, 210_000);
            assert_eq!(
                filtered.listening_ms, 180_000,
                "ten tags and duplicate links do not multiply time"
            );
            assert_eq!(filtered.plays, 1);
        }
        let missing = get_listening(&txn, user, window, Bucket::Day, "UTC", Some(999))
            .await
            .unwrap();
        assert_eq!(missing.total_ms, 210_000);
        assert_eq!(missing.listening_ms, 0);
        assert!(missing.cells.is_empty());
        let foreign = get_listening(&txn, other_user, window, Bucket::Day, "UTC", Some(1))
            .await
            .unwrap();
        assert_eq!(foreign.listening_ms, 0, "another user's tag never matches");
        let sessions = get_sessions(&txn, user, window, None, 0, 25).await.unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(
            sessions.iter().map(|row| row.listening_ms).sum::<i64>(),
            all.total_ms
        );
        let songs = get_session_songs(
            &txn,
            user,
            window,
            Some(1),
            SessionFilter::One(session),
            0,
            25,
        )
        .await
        .unwrap();
        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].listening_ms, 180_000);
        assert_eq!(songs[0].tags.len(), 10, "tag names are deduplicated");
        let legacy = get_session_songs(&txn, user, window, None, SessionFilter::Unassigned, 0, 25)
            .await
            .unwrap();
        assert_eq!(legacy[0].listening_ms, 30_000);
        let every = get_session_songs(&txn, user, window, None, SessionFilter::Any, 0, 25)
            .await
            .unwrap();
        assert_eq!(
            every.iter().map(|song| song.listening_ms).sum::<i64>(),
            all.total_ms,
            "no session filter covers the whole window"
        );
        let empty = TimeWindow::new(
            Some("2026-10-01T00:00:00Z".parse().unwrap()),
            Some("2026-10-02T00:00:00Z".parse().unwrap()),
        )
        .unwrap();
        let empty = get_listening(&txn, user, empty, Bucket::Day, "UTC", None)
            .await
            .unwrap();
        assert_eq!(empty.total_ms, 0);
        assert!(empty.cells.is_empty());
        txn.rollback().await.unwrap();
    }
}
