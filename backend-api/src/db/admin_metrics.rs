//! Platform aggregates. JSON SQL keeps grouped aggregates in postgres rather than
//! loading events into the API. No per-user analytics scope is weakened here.
use crate::{db::stmt, err::CadenzaError};
use chrono::{DateTime, Duration, Utc};
use sea_orm::ConnectionTrait;
use serde_json::Value;

async fn json_query(
    db: &impl ConnectionTrait,
    sql: &str,
    values: Vec<sea_orm::Value>,
) -> Result<Value, CadenzaError> {
    let row = db
        .query_one_raw(stmt(sql, values))
        .await?
        .ok_or_else(|| CadenzaError::DatabaseError("Missing aggregate".into()))?;
    Ok(row.try_get_by_index(0)?)
}

pub async fn listening(
    db: &impl ConnectionTrait,
    since: DateTime<Utc>,
    until: DateTime<Utc>,
    limit: i64,
) -> Result<Value, CadenzaError> {
    // Count plays and endings independently; joining raw streams would multiply durations.
    let sql = r#"with events as (
        select * from listening_events where occurred_at >= $1 and occurred_at < $2
    ), songs as (
        select song_id, count(*) filter(where event_type='play_counted') plays,
            count(distinct user_id) filter(where event_type='play_counted') listeners,
            count(*) filter(where event_type='skip') skips,
            count(*) filter(where event_type in ('skip','play_complete')) endings,
            count(*) filter(where event_type='skip' and case when payload->>'position_ms' ~ '^[0-9]{1,18}$' then (payload->>'position_ms')::bigint end < 10000) early_skips,
            coalesce(sum(case when event_type in ('skip','play_complete') and payload->>'listened_ms' ~ '^[0-9]{1,18}$' then (payload->>'listened_ms')::bigint else 0 end),0) listening_ms
        from events where song_id is not null group by song_id
    ), song_rows as (
        select s.*, coalesce(m.name, s.song_id) name, m.artist_name,
            skips::float / nullif(endings,0) skip_rate,
            early_skips::float / nullif(endings,0) early_skip_rate
        from songs s left join metadata_song_tags_applied m using(song_id)
    ), artists as (
        select lower(btrim(payload->>'artist_name')) key,
            min(payload->>'artist_name') name, min(nullif(payload->>'artist_id','')) artist_id, count(*) plays, count(distinct user_id) listeners
        from events where event_type='play_counted' and nullif(btrim(payload->>'artist_name'),'') is not null group by 1
    ), tag_plays as (
        select distinct e.event_id, e.user_id, lower(regexp_replace(btrim(t.name), '\s+', ' ', 'g')) name
        from events e join user_tags_applied a on a.user_id=e.user_id and a.song_id=e.song_id
        join tags t on t.tag_id=a.tag_id and t.user_id=e.user_id and not t.is_activity
        where e.event_type='play_counted'
    ), tag_durations as (
        select name,sum(ms)::bigint as listening_ms from (
            select distinct e.event_id,lower(regexp_replace(btrim(t.name), '\s+', ' ', 'g')) name,
                case when e.payload->>'listened_ms' ~ '^[0-9]{1,18}$' then (e.payload->>'listened_ms')::bigint else 0 end as ms
            from events e join user_tags_applied a on a.user_id=e.user_id and a.song_id=e.song_id
            join tags t on t.tag_id=a.tag_id and t.user_id=e.user_id and not t.is_activity
            where e.event_type in ('skip','play_complete')
        ) d group by name
    ), ending_days as (
        select to_char(occurred_at at time zone 'UTC','YYYY-MM-DD') as day,
            count(*) filter(where event_type='play_complete')::bigint as completed,
            count(*) filter(where event_type='skip' and case when payload->>'position_ms' ~ '^[0-9]{1,18}$' then (payload->>'position_ms')::bigint end < 10000)::bigint as early_skips,
            count(*) filter(where event_type='skip') - count(*) filter(where event_type='skip' and case when payload->>'position_ms' ~ '^[0-9]{1,18}$' then (payload->>'position_ms')::bigint end < 10000) as skips
        from events where event_type in ('skip','play_complete') group by 1
    ), tag_counts as (select name,count(*) plays,count(distinct user_id) listeners from tag_plays group by name),
    top_tags as (select c.*,coalesce(d.listening_ms,0) as listening_ms from tag_counts c left join tag_durations d using(name) order by plays desc,name limit $3)
    select jsonb_build_object(
        'song_endings',coalesce((select jsonb_agg(to_jsonb(ending_days) order by day) from ending_days),'[]'),
        'songs', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from song_rows where plays>0 order by plays desc,song_id limit $3) x),'[]'),
        'artists', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from artists order by plays desc,key limit $3) x),'[]'),
        'tags', coalesce((select jsonb_agg(to_jsonb(x)) from top_tags x),'[]'),
        'skipped', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from song_rows where skips>0 order by skips desc,song_id limit 10) x),'[]'),
        'rates', (select jsonb_build_object('skips',coalesce(sum(skips),0),'endings',coalesce(sum(endings),0),
            'skip_rate',sum(skips)::float/nullif(sum(endings),0), 'early_skip_rate',sum(early_skips)::float/nullif(sum(endings),0)) from songs)
    )"#;
    json_query(db, sql, vec![since.into(), until.into(), limit.into()]).await
}

/// WAU and MAU use distinct users across their entire calendar interval.
/// Daily counts are only averaged for stickiness, never summed into WAU/MAU.
pub async fn users(
    db: &impl ConnectionTrait,
    since: DateTime<Utc>,
    until: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<Value, CadenzaError> {
    use chrono::{Datelike, Months};
    let midnight = since.time() == chrono::NaiveTime::MIN;
    let metric = if midnight && until == since + Duration::days(1) {
        Some("DailyActiveUsers")
    } else if midnight
        && since.weekday() == chrono::Weekday::Mon
        && until == since + Duration::days(7)
    {
        Some("WeeklyActiveUsers")
    } else if midnight
        && since.day() == 1
        && since.checked_add_months(Months::new(1)) == Some(until)
    {
        Some("MonthlyActiveUsers")
    } else {
        None
    };
    let eligible = metric.is_some() && now >= until + Duration::hours(4);
    let mut active = None;
    let mut cutoff = now;
    if eligible {
        if let Some(row)=db.query_one_raw(stmt("select value,source_cutoff from admin_metric_snapshots where date=$1 and metric=$2::admin_snapshot_metric",vec![since.date_naive().into(),metric.unwrap().into()])).await? {
            active=Some(row.try_get_by_index::<i64>(0)?);cutoff=row.try_get_by_index(1)?;
        }
    }
    if active.is_none() {
        let row=db.query_one_raw(stmt("select count(distinct user_id)::bigint from listening_events where occurred_at >= $1 and occurred_at < $2 and created_at <= $3 and event_type in ('play_start','play_counted','play_complete','skip','seek')",vec![since.into(),until.min(now).into(),now.into()])).await?.unwrap();
        active = Some(row.try_get_by_index(0)?);
        if eligible {
            db.execute_raw(stmt("insert into admin_metric_snapshots(date,metric,value,source_cutoff) values ($1,$2::admin_snapshot_metric,$3,$4) on conflict(date,metric) do nothing",vec![since.date_naive().into(),metric.unwrap().into(),active.unwrap().into(),now.into()])).await?;
            let row=db.query_one_raw(stmt("select value,source_cutoff from admin_metric_snapshots where date=$1 and metric=$2::admin_snapshot_metric",vec![since.date_naive().into(),metric.unwrap().into()])).await?.unwrap();
            active = Some(row.try_get_by_index(0)?);
            cutoff = row.try_get_by_index(1)?;
        }
    }
    let daily = daily_trend_until(db, since, until.min(now), now).await?;
    let days = daily["days"].as_array().unwrap();
    let average = if days.is_empty() {
        0.0
    } else {
        days.iter()
            .map(|d| d["active_users"].as_i64().unwrap_or(0) as f64)
            .sum::<f64>()
            / days.len() as f64
    };
    let active = active.unwrap();
    Ok(
        serde_json::json!({"since":since,"until":until,"source_cutoff":cutoff,"snapshot":eligible,
        "active_users":active,"average_dau":average,"stickiness":if active==0{None}else{Some(average/active as f64)},"days":days,
        "plays":daily["plays"],"listening_ms":daily["listening_ms"]}),
    )
}

pub async fn tags(
    db: &impl ConnectionTrait,
    search: &str,
    sort: &str,
    descending: bool,
    offset: i64,
    defaults: bool,
) -> Result<Value, CadenzaError> {
    let order = match sort {
        "accounts" => "accounts",
        "songs" => "songs",
        "plays" => "plays",
        _ => "name",
    };
    let direction = if descending { "desc" } else { "asc" };
    let sql = format!(
        r#"with names as (
        select tag_id, user_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) name from tags
        where not is_activity and (user_id is null)=$3
    ), counts as (
        select n.name, count(distinct a.user_id) accounts, count(distinct coalesce(a.song_id,d.song_id)) songs
        from names n left join user_tags_applied a on not $3 and a.tag_id=n.tag_id
        left join default_tags_applied d on $3 and d.tag_id=n.tag_id group by n.name
    ), played as (
        select n.name, count(distinct e.event_id) plays from names n join listening_events e
        on e.event_type='play_counted' and (
            (not $3 and n.user_id=e.user_id and exists(select 1 from user_tags_applied a where a.tag_id=n.tag_id and a.user_id=e.user_id and a.song_id=e.song_id))
            or ($3 and exists(select 1 from default_tags_applied d where d.tag_id=n.tag_id and d.song_id=e.song_id))
        ) group by n.name
    ), filtered as (select counts.*,coalesce(played.plays,0) plays from counts left join played using(name) where strpos(counts.name,lower($1))>0)
    select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(x)) from
        (select * from filtered order by {order} {direction}, name asc limit 25 offset $2) x),'[]'))"#
    );
    json_query(
        db,
        &sql,
        vec![search.to_owned().into(), offset.into(), defaults.into()],
    )
    .await
}

pub async fn social(
    db: &impl ConnectionTrait,
    since: DateTime<Utc>,
    until: DateTime<Utc>,
    limit: i64,
) -> Result<Value, CadenzaError> {
    let sql = r#"with ranked as (
        select p.post_id,p.content,p.user_id,count(*) likes from post_likes l join posts p using(post_id)
        where p.user_id is not null and l.date >= $1 and l.date < $2
        group by p.post_id order by likes desc,p.post_id limit $3
    ), days as (select generate_series($1::timestamptz at time zone 'UTC',($2::timestamptz - interval '1 microsecond') at time zone 'UTC',interval '1 day') as bucket_start),
    daily as (select to_char(bucket_start,'YYYY-MM-DD') as day,count(p.post_id) posts from days left join posts p
        on p.user_id is not null and p.created_at >= $1 and p.created_at < $2
        and date_trunc('day',p.created_at at time zone 'UTC')=bucket_start group by bucket_start order by bucket_start)
    select jsonb_build_object('posts',coalesce((select jsonb_agg(to_jsonb(ranked)) from ranked),'[]'),
        'days',coalesce((select jsonb_agg(to_jsonb(daily)) from daily),'[]'))"#;
    Ok(json_query(db, sql, vec![since.into(), until.into(), limit.into()]).await?)
}

/// Daily scalar snapshots. Plays and playtime are summed from these buckets;
/// distinct users over longer periods are calculated separately in `users`.
pub async fn daily_trend(
    db: &impl ConnectionTrait,
    since: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<Value, CadenzaError> {
    daily_trend_until(db, since, now, now).await
}

pub async fn daily_trend_until(
    db: &impl ConnectionTrait,
    since: DateTime<Utc>,
    until: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<Value, CadenzaError> {
    let sql = r#"with days as (
        select generate_series(date_trunc('day',$1::timestamptz at time zone 'UTC'),
            ($2::timestamptz - interval '1 microsecond') at time zone 'UTC',interval '1 day') as bucket
    ), buckets as (
        select bucket, (bucket at time zone 'UTC' >= $1 and (bucket+interval '1 day') at time zone 'UTC' <= $2) as complete from days
    ), cached as (
        select b.bucket,b.complete,
            max(s.value) filter(where s.metric='DailyActiveUsers') as dau,
            max(s.value) filter(where s.metric='Plays') as plays,
            max(s.value) filter(where s.metric='Playtime') as ms,
            max(s.source_cutoff) filter(where s.metric='DailyActiveUsers') as cutoff
        from buckets b left join admin_metric_snapshots s on b.complete and s.date=b.bucket::date
            and s.metric in ('DailyActiveUsers','Plays','Playtime') group by b.bucket,b.complete
    ), cells as (
        select to_char(c.bucket,'YYYY-MM-DD') as day,c.complete,
            coalesce(c.dau,l.dau,0) as active_users,coalesce(c.plays,l.plays,0) as plays,
            coalesce(c.ms,l.ms,0) as listening_ms,coalesce(c.cutoff,$3::timestamptz) as source_cutoff,
            c.dau is not null as snapshot
        from cached c left join lateral (
            select count(distinct user_id)::bigint as dau,
                count(*) filter(where event_type='play_counted')::bigint as plays,
                coalesce(sum(case when event_type in ('skip','play_complete')
                    and payload->>'listened_ms' ~ '^[0-9]{1,18}$'
                    then (payload->>'listened_ms')::bigint else 0 end),0)::bigint as ms
            from listening_events where (c.dau is null or c.plays is null or c.ms is null)
                and occurred_at >= greatest(c.bucket at time zone 'UTC',$1)
                and occurred_at < least((c.bucket+interval '1 day') at time zone 'UTC',$2)
                and created_at <= $3
                and event_type in ('play_start','play_counted','play_complete','skip','seek')
        ) l on true
    ) select jsonb_build_object('source_cutoff',$3::timestamptz,
        'days',coalesce((select jsonb_agg(to_jsonb(cells) order by day) from cells),'[]'))"#;
    let mut result = json_query(db, sql, vec![since.into(), until.into(), now.into()]).await?;
    db.execute_raw(stmt(
        r#"insert into admin_metric_snapshots(date,metric,value,source_cutoff)
        select (d->>'day')::date, m.metric::admin_snapshot_metric, m.value, $2
        from jsonb_array_elements($1::jsonb) d
        cross join lateral (values
            ('DailyActiveUsers',(d->>'active_users')::bigint),
            ('Plays',(d->>'plays')::bigint),
            ('Playtime',(d->>'listening_ms')::bigint)
        ) m(metric,value)
        where (d->>'complete')::boolean
            and (((d->>'day')::date+1)::timestamp at time zone 'UTC') + interval '4 hours' <= $2
        on conflict(date,metric) do nothing"#,
        vec![result["days"].clone().into(), now.into()],
    ))
    .await?;
    // A second read returns the winning immutable values after concurrent inserts.
    let rows=db.query_all_raw(stmt("select date,metric::text,value,source_cutoff from admin_metric_snapshots where date >= ($1::timestamptz at time zone 'UTC')::date and date <= ($2::timestamptz at time zone 'UTC')::date and metric in ('DailyActiveUsers','Plays','Playtime')",vec![since.into(),until.into()])).await?;
    for row in rows {
        let date: chrono::NaiveDate = row.try_get_by_index(0)?;
        let metric: String = row.try_get_by_index(1)?;
        let value: i64 = row.try_get_by_index(2)?;
        let cutoff: DateTime<Utc> = row.try_get_by_index(3)?;
        if let Some(day) = result["days"].as_array_mut().and_then(|days| {
            days.iter_mut()
                .find(|day| day["day"] == date.to_string() && day["complete"] == true)
        }) {
            let field = match metric.as_str() {
                "DailyActiveUsers" => "active_users",
                "Plays" => "plays",
                _ => "listening_ms",
            };
            day[field] = serde_json::json!(value);
            if metric == "DailyActiveUsers" {
                day["source_cutoff"] = serde_json::json!(cutoff);
                day["snapshot"] = serde_json::json!(true);
            }
        }
    }
    let days = result["days"].as_array().unwrap();
    result["plays"] = serde_json::json!(
        days.iter()
            .map(|d| d["plays"].as_i64().unwrap_or(0))
            .sum::<i64>()
    );
    result["listening_ms"] = serde_json::json!(
        result["days"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["listening_ms"].as_i64().unwrap_or(0))
            .sum::<i64>()
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{Database, TransactionTrait};

    /// Temporary tables shadow the real tables only inside this rolled-back
    /// transaction. Exercises postgres parsing, aggregation and snapshot writes.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn admin_metrics_charts_and_snapshots() {
        dotenvy::dotenv().ok();
        let db = Database::connect(std::env::var("DATABASE_URL").unwrap())
            .await
            .unwrap();
        let tx = db.begin().await.unwrap();
        for sql in [
            "create temp table listening_events(event_id bigint, user_id uuid, song_id text, event_type text, occurred_at timestamptz, created_at timestamptz, payload jsonb) on commit drop",
            "create temp table metadata_song_tags_applied(song_id text, name text, artist_name text) on commit drop",
            "create temp table tags(tag_id bigint, user_id uuid, name text, is_activity boolean) on commit drop",
            "create temp table user_tags_applied(user_id uuid, song_id text, tag_id bigint) on commit drop",
            "create temp table default_tags_applied(tag_id bigint,song_id text) on commit drop",
            "insert into tags values (1,'00000000-0000-0000-0000-000000000001','Indie Rock',false),(2,'00000000-0000-0000-0000-000000000001','indie rock',false)",
            "insert into user_tags_applied values ('00000000-0000-0000-0000-000000000001','s',1),('00000000-0000-0000-0000-000000000001','s',2)",
            "create temp table posts(post_id bigint primary key, user_id uuid, content text, created_at timestamptz) on commit drop",
            "create temp table post_likes(post_id bigint, date timestamptz) on commit drop",
            "create type pg_temp.admin_snapshot_metric as enum ('DailyActiveUsers','WeeklyActiveUsers','MonthlyActiveUsers','Plays','Playtime')",
            "create temp table admin_metric_snapshots(date date, metric pg_temp.admin_snapshot_metric, value bigint,source_cutoff timestamptz,computed_at timestamptz default now(),primary key(date,metric)) on commit drop",
            "insert into listening_events values (1,'00000000-0000-0000-0000-000000000001','s','play_counted','2026-11-01T12:00Z','2026-11-01T12:00Z','{\"artist_name\":\"Artist\"}'), (2,'00000000-0000-0000-0000-000000000001','s','play_complete','2026-11-01T12:03Z','2026-11-01T12:03Z','{\"listened_ms\":180000}')",
            "insert into posts values (1,'00000000-0000-0000-0000-000000000001','A post','2026-11-01T12:00Z'), (2,null,'Spotlight','2026-11-01T12:00Z')",
            "insert into post_likes values (1,'2026-11-01T12:00Z'),(2,'2026-11-01T12:00Z')",
        ] {
            tx.execute_raw(stmt(sql, vec![])).await.unwrap();
        }
        let since: DateTime<Utc> = "2026-11-01T00:00:00Z".parse().unwrap();
        let until = since + Duration::days(1);
        let now = until + Duration::hours(4);
        let directory = tags(&tx, "DIE R", "plays", true, 0, false).await.unwrap();
        assert_eq!(directory["total"], 1);
        assert_eq!(
            directory["rows"][0]["plays"], 1,
            "duplicate tag names must not multiply plays"
        );
        assert_eq!(directory["rows"][0]["songs"], 1);
        let songs = listening(&tx, since, until, 10).await.unwrap();
        assert_eq!(songs["songs"][0]["plays"], 1);
        assert_eq!(songs["songs"][0]["listening_ms"], 180000);
        assert_eq!(
            songs["tags"][0]["listening_ms"], 180000,
            "same-name tag aliases must not multiply listening time"
        );
        let activity = users(&tx, since, until, now).await.unwrap();
        assert_eq!(activity["days"][0]["day"], "2026-11-01");
        assert_eq!(activity["days"][0]["active_users"], 1);
        assert_eq!(activity["snapshot"], true);
        let social = social(&tx, since, until, 10).await.unwrap();
        assert_eq!(social["posts"].as_array().unwrap().len(), 1);
        assert_eq!(social["days"][0]["posts"], 1);
        let trend = daily_trend(&tx, since, now).await.unwrap();
        assert_eq!(trend["days"][0]["plays"], 1);
        assert_eq!(trend["days"][0]["snapshot"], true);
        let historical = daily_trend_until(&tx, since, until, now).await.unwrap();
        assert_eq!(
            historical["days"].as_array().unwrap().len(),
            1,
            "exclusive end must not add the following day"
        );
        assert_eq!(
            historical["source_cutoff"]
                .as_str()
                .unwrap()
                .parse::<DateTime<Utc>>()
                .unwrap(),
            now,
            "source cutoff is computation time, not the historical period end"
        );
        tx.execute_raw(stmt("delete from listening_events", vec![]))
            .await
            .unwrap();
        assert_eq!(users(&tx, since, until, now).await.unwrap(), activity);
        assert_eq!(
            daily_trend(&tx, since, now).await.unwrap()["days"][0],
            trend["days"][0]
        );
        // Repeated listeners across days/weeks must count once per full period.
        tx.execute_raw(stmt("insert into listening_events values (10,'00000000-0000-0000-0000-000000000001','s','play_counted','2026-12-07T12:00Z','2026-12-07T12:00Z','{}'), (11,'00000000-0000-0000-0000-000000000001','s','play_counted','2026-12-08T12:00Z','2026-12-08T12:00Z','{}'), (12,'00000000-0000-0000-0000-000000000002','s','play_counted','2026-12-08T12:00Z','2026-12-08T12:00Z','{}'), (13,'00000000-0000-0000-0000-000000000003','s','play_counted','2026-12-21T12:00Z','2026-12-21T12:00Z','{}'), (14,'00000000-0000-0000-0000-000000000001','s','play_complete','2026-12-07T12:03Z','2026-12-07T12:03Z','{\"listened_ms\":12345}')",vec![])).await.unwrap();
        let month_start = "2026-12-01T00:00:00Z".parse().unwrap();
        let month_end: DateTime<Utc> = "2027-01-01T00:00:00Z".parse().unwrap();
        let cutoff = month_end + Duration::hours(4);
        let week_start: DateTime<Utc> = "2026-12-07T00:00:00Z".parse().unwrap();
        let week_end = week_start + Duration::days(7);
        let week = users(&tx, week_start, week_end, cutoff).await.unwrap();
        assert_eq!(week["active_users"], 2);
        assert_eq!(week["plays"], 3);
        assert_eq!(week["listening_ms"], 12345);
        let month = users(&tx, month_start, month_end, cutoff).await.unwrap();
        assert_eq!(month["active_users"], 3);
        assert_eq!(month["plays"], 4);
        assert_eq!(month["listening_ms"], 12345);
        let zero=tx.query_one_raw(stmt("select value from admin_metric_snapshots where date='2026-12-09' and metric='DailyActiveUsers'",vec![])).await.unwrap().unwrap();
        assert_eq!(zero.try_get_by_index::<i64>(0).unwrap(), 0);
        let future: DateTime<Utc> = "2027-02-01T00:00:00Z".parse().unwrap();
        let current = users(
            &tx,
            future,
            future + Duration::days(28),
            future + Duration::hours(2),
        )
        .await
        .unwrap();
        assert_eq!(current["snapshot"], false);
        let count = tx
            .query_one_raw(stmt(
                "select count(*)::bigint from admin_metric_snapshots where date='2027-02-01'",
                vec![],
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(count.try_get_by_index::<i64>(0).unwrap(), 0);
        tx.execute_raw(stmt("delete from listening_events", vec![]))
            .await
            .unwrap();
        assert_eq!(
            users(&tx, week_start, week_end, cutoff + Duration::days(1))
                .await
                .unwrap()["active_users"],
            2
        );
        assert_eq!(
            users(&tx, month_start, month_end, cutoff + Duration::days(1))
                .await
                .unwrap()["active_users"],
            3
        );
        tx.execute_raw(stmt(
            "insert into tags values (3,'00000000-0000-0000-0000-000000000002','Indie Rock',false)",
            vec![],
        ))
        .await
        .unwrap();
        tx.execute_raw(stmt(
            "insert into user_tags_applied values ('00000000-0000-0000-0000-000000000002','s',3)",
            vec![],
        ))
        .await
        .unwrap();
        tx.execute_raw(stmt(r#"insert into listening_events values
            (101,'00000000-0000-0000-0000-000000000001','s','play_counted','2027-03-01T12:00Z','2027-03-01T12:00Z','{}'),
            (102,'00000000-0000-0000-0000-000000000002','s','play_counted','2027-03-02T12:00Z','2027-03-02T12:00Z','{}'),
            (103,'00000000-0000-0000-0000-000000000001','s','skip','2027-03-01T12:00Z','2027-03-01T12:00Z','{"position_ms":5000}'),
            (104,'00000000-0000-0000-0000-000000000001','s','skip','2027-03-01T13:00Z','2027-03-01T13:00Z','{"position_ms":10000}'),
            (105,'00000000-0000-0000-0000-000000000002','s','play_complete','2027-03-01T14:00Z','2027-03-01T14:00Z','{}'),
            (106,'00000000-0000-0000-0000-000000000001','s','skip','2027-03-02T12:00Z','2027-03-02T12:00Z','{"position_ms":0}')"#,vec![])).await.unwrap();
        let breakdown = listening(
            &tx,
            "2027-03-01T00:00:00Z".parse().unwrap(),
            "2027-03-03T00:00:00Z".parse().unwrap(),
            10,
        )
        .await
        .unwrap();
        assert_eq!(breakdown["tags"][0]["listeners"], 2);
        assert_eq!(breakdown["tags"][0]["plays"], 2);
        assert_eq!(breakdown["song_endings"][0]["early_skips"], 1);
        assert_eq!(breakdown["song_endings"][0]["skips"], 1);
        assert_eq!(breakdown["song_endings"][0]["completed"], 1);
        assert_eq!(breakdown["song_endings"][1]["early_skips"], 1);
        tx.rollback().await.unwrap();
    }
}
