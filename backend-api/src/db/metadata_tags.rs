//! The query-only copy of Apple Music catalog metadata in `metadata_song_tags_applied`, and
//! the album crawl queue in `metadata_albums`.
//!
//! Nothing here is authoritative. Apple Music still owns song metadata, and every screen
//! that shows a title reads it from Apple. These rows exist so a query can filter on a
//! song's artist, album, genre, release date, length, and rating. A stale or missing row
//! only means a query misses that song until it is stored again.

use std::collections::HashSet;

use chrono::{NaiveDate, Utc};
use sea_orm::{
    ActiveEnum,
    ActiveValue::{NotSet, Set},
    ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, FromQueryResult, QueryFilter,
    QuerySelect, Statement, TransactionSession, TransactionTrait, UpdateMany,
    sea_query::{Expr, OnConflict},
};

use crate::db::entity::sea_orm_active_enums::MetadataCrawlStatus;
use crate::db::entity::{metadata_albums, metadata_song_tags_applied};
use crate::err::CadenzaError;
use crate::services::song_metadata::SongMetadata;

/// Apple tags nearly every song with this as well as its real genres. It says nothing a
/// query could use, so it is never stored.
const CATCH_ALL_GENRE: &str = "Music";

/// Rows per insert, so a batch of long albums stays well under postgres's bind limit of
/// 65535 values. Each row binds 11.
const MAX_ROWS_PER_INSERT: usize = 1000;

/// The song ids in `song_ids` that have no row yet, found or not, in input order.
pub async fn get_songs_without_metadata(
    db: &impl ConnectionTrait,
    song_ids: &[String],
) -> Result<Vec<String>, CadenzaError> {
    if song_ids.is_empty() {
        return Ok(Vec::new());
    }

    let stored: HashSet<String> = metadata_song_tags_applied::Entity::find()
        .filter(
            metadata_song_tags_applied::Column::SongId.is_in(song_ids.iter().map(String::as_str)),
        )
        .select_only()
        .column(metadata_song_tags_applied::Column::SongId)
        .into_tuple::<String>()
        .all(db)
        .await?
        .into_iter()
        .collect();

    let mut seen = HashSet::new();
    Ok(song_ids
        .iter()
        .filter(|song_id| !stored.contains(*song_id) && seen.insert(song_id.as_str()))
        .cloned()
        .collect())
}

/// A song's stored row, found or not. `None` when it has none yet.
pub async fn get_song_metadata(
    db: &impl ConnectionTrait,
    song_id: &str,
) -> Result<Option<metadata_song_tags_applied::Model>, CadenzaError> {
    Ok(metadata_song_tags_applied::Entity::find_by_id(song_id)
        .one(db)
        .await?)
}

/// The album a stored song is on. `None` when the song has no row, was not found, or Apple
/// gave it no album.
pub async fn get_stored_album_id(
    db: &impl ConnectionTrait,
    song_id: &str,
) -> Result<Option<String>, CadenzaError> {
    let album_id: Option<Option<String>> = metadata_song_tags_applied::Entity::find_by_id(song_id)
        .select_only()
        .column(metadata_song_tags_applied::Column::AlbumId)
        .into_tuple()
        .one(db)
        .await?;

    Ok(album_id.flatten())
}

/// Writes a row for every song, replacing any row it already had.
///
/// `found` are songs Apple returned. `not_found` are ids it did not, which get a row with
/// `found` false and no metadata, so nothing asks Apple about them again.
///
/// Replacing a row keeps its `total_plays`. A song that had no row starts from its
/// `play_counted` events in `listening_events`, so plays from before the row existed still
/// count. Both happen in one transaction, so a new row is never left at zero.
///
/// Each song is written once however often it is passed, which [`one_per_song`] explains.
pub async fn store_song_metadata(
    db: &(impl ConnectionTrait + TransactionTrait),
    found: &[SongMetadata],
    not_found: &[String],
) -> Result<(), CadenzaError> {
    let (found, not_found) = one_per_song(found, not_found);

    let fetched_at = Utc::now().fixed_offset();
    let rows: Vec<metadata_song_tags_applied::ActiveModel> = found
        .iter()
        .map(|song| found_row(song, fetched_at))
        .chain(
            not_found
                .iter()
                .map(|song_id| not_found_row(song_id, fetched_at)),
        )
        .collect();

    let song_ids: Vec<String> = found
        .iter()
        .map(|song| song.id.clone())
        .chain(not_found.iter().map(|song_id| (*song_id).clone()))
        .collect();
    if song_ids.is_empty() {
        return Ok(());
    }

    let txn = db.begin().await?;
    let new_song_ids = get_songs_without_metadata(&txn, &song_ids).await?;

    for chunk in rows.chunks(MAX_ROWS_PER_INSERT) {
        metadata_song_tags_applied::Entity::insert_many(chunk.to_vec())
            .on_conflict(
                OnConflict::column(metadata_song_tags_applied::Column::SongId)
                    .update_columns([
                        metadata_song_tags_applied::Column::Found,
                        metadata_song_tags_applied::Column::Name,
                        metadata_song_tags_applied::Column::ArtistName,
                        metadata_song_tags_applied::Column::AlbumName,
                        metadata_song_tags_applied::Column::AlbumId,
                        metadata_song_tags_applied::Column::DurationInMillis,
                        metadata_song_tags_applied::Column::GenreNames,
                        metadata_song_tags_applied::Column::ReleaseDate,
                        metadata_song_tags_applied::Column::ContentRating,
                        metadata_song_tags_applied::Column::FetchedAt,
                    ])
                    .to_owned(),
            )
            .exec_without_returning(&txn)
            .await?;
    }

    count_total_plays_from_log(&txn, &new_song_ids).await?;
    txn.commit().await?;
    Ok(())
}

/// Each song once: the found songs, then the not found ids, with every id in one or the
/// other and never twice.
///
/// One insert with the same song twice fails outright: `ON CONFLICT DO UPDATE` refuses to
/// touch the same row twice in one command. The album crawl can hand over the same song
/// twice, since a song can be on two of the albums it crawls in one pass, like a standard
/// and a deluxe edition. The last copy of a found song wins, so its `album_id` is the last
/// album it was read off; either album is right. A song both found and not found counts as
/// found. Input order is kept otherwise.
fn one_per_song<'a>(
    found: &'a [SongMetadata],
    not_found: &'a [String],
) -> (Vec<&'a SongMetadata>, Vec<&'a String>) {
    let mut seen = HashSet::new();
    let mut found: Vec<&SongMetadata> = found
        .iter()
        .rev()
        .filter(|song| seen.insert(song.id.as_str()))
        .collect();
    found.reverse();

    let not_found = not_found
        .iter()
        .filter(|song_id| seen.insert(song_id.as_str()))
        .collect();

    (found, not_found)
}

/// Sets `total_plays` on each song's row to its number of `play_counted` events, for
/// rows that were just created. Songs with no plays keep the column's default of 0.
async fn count_total_plays_from_log(
    db: &impl ConnectionTrait,
    song_ids: &[String],
) -> Result<(), CadenzaError> {
    for chunk in song_ids.chunks(MAX_ROWS_PER_INSERT) {
        let params: Vec<String> = (1..=chunk.len()).map(|n| format!("${n}")).collect();
        let values: Vec<sea_orm::Value> = chunk.iter().map(|id| id.clone().into()).collect();

        db.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            format!(
                r#"
                UPDATE metadata_song_tags_applied AS meta
                SET total_plays = plays.count
                FROM (
                    SELECT song_id, count(*) AS count
                    FROM listening_events
                    WHERE event_type = 'play_counted' AND song_id IN ({})
                    GROUP BY song_id
                ) AS plays
                WHERE meta.song_id = plays.song_id
                "#,
                params.join(", ")
            ),
            values,
        ))
        .await?;
    }

    Ok(())
}

/// Adds plays to each song's `total_plays`, every user's plays together. Takes each song
/// once, with how many plays to add.
///
/// A song with no row yet is skipped. Its plays are not lost: they are in
/// `listening_events`, and [`store_song_metadata`] counts them when the row is created.
pub async fn add_total_plays(
    db: &impl ConnectionTrait,
    plays: &[(&str, i64)],
) -> Result<(), CadenzaError> {
    for chunk in plays.chunks(MAX_ROWS_PER_INSERT) {
        let mut values: Vec<sea_orm::Value> = Vec::with_capacity(chunk.len() * 2);
        let rows: Vec<String> = chunk
            .iter()
            .map(|(song_id, count)| {
                values.push((*song_id).into());
                values.push((*count).into());
                format!("(${}, ${}::bigint)", values.len() - 1, values.len())
            })
            .collect();

        db.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            format!(
                r#"
                UPDATE metadata_song_tags_applied AS meta
                SET total_plays = meta.total_plays + plays.count
                FROM (VALUES {}) AS plays(song_id, count)
                WHERE meta.song_id = plays.song_id
                "#,
                rows.join(", ")
            ),
            values,
        ))
        .await?;
    }

    Ok(())
}

fn found_row(
    song: &SongMetadata,
    fetched_at: chrono::DateTime<chrono::FixedOffset>,
) -> metadata_song_tags_applied::ActiveModel {
    metadata_song_tags_applied::ActiveModel {
        song_id: Set(song.id.clone()),
        found: Set(true),
        name: Set(Some(song.title.clone())),
        artist_name: Set(Some(song.artist_name.clone())),
        album_name: Set(song.album_name.clone()),
        album_id: Set(song.album_id.clone()),
        // an int4 holds just under 600 hours, so a longer duration is unknown rather than
        // wrapped to a wrong one
        duration_in_millis: Set(song
            .duration_ms
            .and_then(|millis| i32::try_from(millis).ok())),
        genre_names: Set(query_genres(&song.genre_names)),
        release_date: Set(song.release_date.as_deref().and_then(parse_release_date)),
        content_rating: Set(song.content_rating.clone()),
        fetched_at: Set(fetched_at),
        // the column default on insert, and left out of the update on conflict
        total_plays: NotSet,
    }
}

fn not_found_row(
    song_id: &str,
    fetched_at: chrono::DateTime<chrono::FixedOffset>,
) -> metadata_song_tags_applied::ActiveModel {
    metadata_song_tags_applied::ActiveModel {
        song_id: Set(song_id.to_owned()),
        found: Set(false),
        name: Set(None),
        artist_name: Set(None),
        album_name: Set(None),
        album_id: Set(None),
        duration_in_millis: Set(None),
        genre_names: Set(Vec::new()),
        release_date: Set(None),
        content_rating: Set(None),
        fetched_at: Set(fetched_at),
        total_plays: NotSet,
    }
}

/// The genres worth querying on: Apple's list without the catch-all "Music", each kept once,
/// in Apple's order.
fn query_genres(genres: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    genres
        .iter()
        .map(|genre| genre.trim())
        .filter(|genre| !genre.is_empty() && *genre != CATCH_ALL_GENRE)
        .filter(|genre| seen.insert(genre.to_lowercase()))
        .map(str::to_owned)
        .collect()
}

/// Apple's release date as a day. Apple sends `YYYY-MM-DD`, or just `YYYY` when it only
/// knows the year, which is stored as January 1 of that year. Anything else is unknown.
fn parse_release_date(raw: &str) -> Option<NaiveDate> {
    let raw = raw.trim();
    if let Ok(day) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return Some(day);
    }
    if raw.len() == 4 {
        return raw
            .parse::<i32>()
            .ok()
            .and_then(|year| NaiveDate::from_ymd_opt(year, 1, 1));
    }
    None
}

/// One album id per row, for the raw statements that hand album ids back.
#[derive(FromQueryResult)]
struct AlbumIdRow {
    album_id: String,
}

/// Adds albums to the crawl queue as `pending`. An album already in the table, in any state,
/// is left alone, so this never re-crawls an album that is done.
pub async fn queue_albums(
    db: &impl ConnectionTrait,
    album_ids: &[String],
) -> Result<(), CadenzaError> {
    let album_ids = distinct(album_ids);
    if album_ids.is_empty() {
        return Ok(());
    }

    let rows = album_ids
        .iter()
        .map(|album_id| metadata_albums::ActiveModel {
            album_id: Set(album_id.clone()),
            status: Set(MetadataCrawlStatus::Pending),
            attempts: NotSet,
            queued_at: NotSet,
            crawled_at: NotSet,
        });

    metadata_albums::Entity::insert_many(rows)
        .on_conflict(
            OnConflict::column(metadata_albums::Column::AlbumId)
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(db)
        .await?;

    Ok(())
}

/// Puts `done` albums back in the queue, for when one of their songs turned up without a
/// row, which means the album changed since it was crawled. Attempts start over. Albums in
/// any other state are left alone: a pending or in flight one is already going to be
/// crawled, and a failed one stays failed.
pub async fn requeue_done_albums(
    db: &impl ConnectionTrait,
    album_ids: &[String],
) -> Result<(), CadenzaError> {
    let album_ids = distinct(album_ids);
    if album_ids.is_empty() {
        return Ok(());
    }

    requeue_done_albums_statement(&album_ids).exec(db).await?;
    Ok(())
}

fn requeue_done_albums_statement(album_ids: &[String]) -> UpdateMany<metadata_albums::Entity> {
    metadata_albums::Entity::update_many()
        // as_enum so the bind is cast to metadata_crawl_status, the same as in tags.rs
        .col_expr(
            metadata_albums::Column::Status,
            ActiveEnum::as_enum(&MetadataCrawlStatus::Pending),
        )
        .col_expr(metadata_albums::Column::Attempts, Expr::value(0))
        .col_expr(metadata_albums::Column::QueuedAt, Expr::current_timestamp())
        .filter(metadata_albums::Column::AlbumId.is_in(album_ids.iter().map(String::as_str)))
        .filter(metadata_albums::Column::Status.eq(MetadataCrawlStatus::Done))
}

/// Claims up to `limit` pending albums, oldest queued first, by moving them to `in_flight`
/// and counting the attempt. Returns their ids.
///
/// `FOR UPDATE SKIP LOCKED` means two servers claiming at once never get the same album.
pub async fn claim_pending_albums(
    db: &impl ConnectionTrait,
    limit: u64,
) -> Result<Vec<String>, CadenzaError> {
    if limit == 0 {
        return Ok(Vec::new());
    }

    let rows = AlbumIdRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r#"
        UPDATE metadata_albums
        SET status = 'in_flight', attempts = attempts + 1
        WHERE album_id IN (
            SELECT album_id FROM metadata_albums
            WHERE status = 'pending'
            ORDER BY queued_at
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING album_id
        "#,
        [(limit as i64).into()],
    ))
    .all(db)
    .await?;

    Ok(rows.into_iter().map(|row| row.album_id).collect())
}

/// Marks claimed albums `done`, so they are not crawled again unless one of their songs
/// later turns up missing.
pub async fn finish_albums(
    db: &impl ConnectionTrait,
    album_ids: &[String],
) -> Result<(), CadenzaError> {
    if album_ids.is_empty() {
        return Ok(());
    }

    metadata_albums::Entity::update_many()
        .col_expr(
            metadata_albums::Column::Status,
            ActiveEnum::as_enum(&MetadataCrawlStatus::Done),
        )
        .col_expr(
            metadata_albums::Column::CrawledAt,
            Expr::current_timestamp(),
        )
        .filter(metadata_albums::Column::AlbumId.is_in(album_ids.iter().map(String::as_str)))
        .exec(db)
        .await?;

    Ok(())
}

/// Hands claimed albums back after a crawl failed.
///
/// With `count_attempt`, the failure counts: an album that has now been tried
/// `max_attempts` times becomes `failed` and is not tried again, and the rest go back to
/// `pending`. Without it, as after a rate limit that was no fault of the album, every one
/// goes back to `pending` and the attempt the claim counted is taken back.
pub async fn release_albums(
    db: &impl ConnectionTrait,
    album_ids: &[String],
    count_attempt: bool,
    max_attempts: i32,
) -> Result<(), CadenzaError> {
    if album_ids.is_empty() {
        return Ok(());
    }

    let refund: i32 = if count_attempt { 0 } else { 1 };
    let mut values: Vec<sea_orm::Value> = vec![refund.into(), max_attempts.into()];
    let id_params: Vec<String> = album_ids
        .iter()
        .map(|album_id| {
            values.push(album_id.clone().into());
            format!("${}", values.len())
        })
        .collect();

    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        format!(
            r#"
            UPDATE metadata_albums
            SET attempts = attempts - $1,
                status = CASE
                    WHEN attempts - $1 >= $2 THEN 'failed'::metadata_crawl_status
                    ELSE 'pending'::metadata_crawl_status
                END
            WHERE status = 'in_flight' AND album_id IN ({})
            "#,
            id_params.join(", ")
        ),
        values,
    ))
    .await?;

    Ok(())
}

/// Puts every `in_flight` album back to `pending`. Run once when the crawl starts, so a
/// claim a stopped server never settled is not stuck forever. Assumes one server runs the
/// crawl; a second one starting up would hand back the first one's live claims, which costs
/// a duplicate crawl of those albums and nothing else.
pub async fn reset_in_flight_albums(db: &impl ConnectionTrait) -> Result<u64, CadenzaError> {
    let res = reset_in_flight_albums_statement().exec(db).await?;
    Ok(res.rows_affected)
}

fn reset_in_flight_albums_statement() -> UpdateMany<metadata_albums::Entity> {
    metadata_albums::Entity::update_many()
        .col_expr(
            metadata_albums::Column::Status,
            ActiveEnum::as_enum(&MetadataCrawlStatus::Pending),
        )
        .filter(metadata_albums::Column::Status.eq(MetadataCrawlStatus::InFlight))
}

/// One song id per row, the only column the library walk selects.
#[derive(FromQueryResult)]
struct SongIdRow {
    song_id: String,
}

/// Song ids in someone's library with no metadata row, most recently added first, at most
/// `limit` of them. Built the same way as
/// `user_songs::get_recent_songs_without_generated_default_tags`, so one song held by
/// several users can take more than one row of `limit`.
pub async fn get_library_songs_without_metadata(
    db: &impl ConnectionTrait,
    limit: u64,
) -> Result<Vec<String>, CadenzaError> {
    if limit == 0 {
        return Ok(Vec::new());
    }

    let rows = SongIdRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r#"
        SELECT us.song_id
        FROM user_songs AS us
        LEFT JOIN metadata_song_tags_applied AS meta ON meta.song_id = us.song_id
        WHERE meta.song_id IS NULL
        ORDER BY us.created_at DESC
        LIMIT $1
        "#,
        [(limit as i64).into()],
    ))
    .all(db)
    .await?;

    let mut seen = HashSet::new();
    Ok(rows
        .into_iter()
        .map(|row| row.song_id)
        .filter(|song_id| seen.insert(song_id.clone()))
        .collect())
}

/// Each id once, in input order.
fn distinct(ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.iter()
        .filter(|id| seen.insert(id.as_str()))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::QueryTrait;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn query_genres_drops_the_catch_all() {
        assert_eq!(
            query_genres(&strings(&["Metal", "Music", "Rock"])),
            strings(&["Metal", "Rock"])
        );
    }

    #[test]
    fn query_genres_keeps_each_genre_once() {
        assert_eq!(
            query_genres(&strings(&["Pop", "pop", " Pop ", ""])),
            strings(&["Pop"])
        );
    }

    #[test]
    fn query_genres_can_end_up_empty() {
        assert!(query_genres(&strings(&["Music"])).is_empty());
    }

    #[test]
    fn release_date_reads_a_full_day() {
        assert_eq!(
            parse_release_date("1988-08-25"),
            NaiveDate::from_ymd_opt(1988, 8, 25)
        );
    }

    #[test]
    fn release_date_with_only_a_year_is_january_first() {
        assert_eq!(
            parse_release_date("1975"),
            NaiveDate::from_ymd_opt(1975, 1, 1)
        );
    }

    #[test]
    fn release_date_that_is_neither_is_unknown() {
        assert_eq!(parse_release_date("1975-13"), None);
        assert_eq!(parse_release_date("soon"), None);
        assert_eq!(parse_release_date(""), None);
    }

    #[test]
    fn a_found_row_keeps_the_query_fields() {
        let song = SongMetadata {
            id: "1".into(),
            title: "One".into(),
            artist_name: "Metallica".into(),
            album_name: Some("...And Justice for All".into()),
            album_id: Some("10".into()),
            duration_ms: Some(447_260),
            artwork_url: Some("https://example.com/a.jpg".into()),
            genre_names: strings(&["Metal", "Music"]),
            release_date: Some("1988-08-25".into()),
            isrc: Some("USUM71703326".into()),
            content_rating: Some("explicit".into()),
        };

        let row = found_row(&song, Utc::now().fixed_offset());

        assert_eq!(row.found, Set(true));
        assert_eq!(row.name, Set(Some("One".into())));
        assert_eq!(row.album_id, Set(Some("10".into())));
        assert_eq!(row.duration_in_millis, Set(Some(447_260)));
        assert_eq!(row.genre_names, Set(strings(&["Metal"])));
        assert_eq!(row.release_date, Set(NaiveDate::from_ymd_opt(1988, 8, 25)));
        assert_eq!(row.content_rating, Set(Some("explicit".into())));
    }

    #[test]
    fn a_duration_too_long_for_the_column_is_unknown() {
        let song = SongMetadata {
            id: "1".into(),
            title: "t".into(),
            artist_name: "a".into(),
            album_name: None,
            album_id: None,
            duration_ms: Some(u64::from(u32::MAX)),
            artwork_url: None,
            genre_names: Vec::new(),
            release_date: None,
            isrc: None,
            content_rating: None,
        };

        assert_eq!(
            found_row(&song, Utc::now().fixed_offset()).duration_in_millis,
            Set(None)
        );
    }

    #[test]
    fn a_not_found_row_has_no_metadata() {
        let row = not_found_row("1", Utc::now().fixed_offset());
        assert_eq!(row.found, Set(false));
        assert_eq!(row.name, Set(None));
        assert_eq!(row.genre_names, Set(Vec::new()));
    }

    /// postgres will not compare or assign a bare text value to an enum column, so every
    /// status has to go out cast to metadata_crawl_status
    #[test]
    fn status_updates_cast_to_the_enum() {
        let requeue = requeue_done_albums_statement(&strings(&["1"]))
            .build(DbBackend::Postgres)
            .to_string();
        assert_eq!(
            requeue.matches(r#"AS "metadata_crawl_status""#).count(),
            2,
            "{requeue}"
        );

        let reset = reset_in_flight_albums_statement()
            .build(DbBackend::Postgres)
            .to_string();
        assert_eq!(
            reset.matches(r#"AS "metadata_crawl_status""#).count(),
            2,
            "{reset}"
        );
    }

    fn metadata(id: &str, album_id: &str) -> SongMetadata {
        SongMetadata {
            id: id.into(),
            title: id.into(),
            artist_name: "artist".into(),
            album_name: None,
            album_id: Some(album_id.into()),
            duration_ms: None,
            artwork_url: None,
            genre_names: Vec::new(),
            release_date: None,
            isrc: None,
            content_rating: None,
        }
    }

    #[test]
    fn one_per_song_keeps_the_last_copy_of_a_found_song() {
        let found = vec![
            metadata("a", "standard"),
            metadata("b", "standard"),
            metadata("a", "deluxe"),
        ];
        let (found, not_found) = one_per_song(&found, &[]);

        let kept: Vec<(&str, &str)> = found
            .iter()
            .map(|song| (song.id.as_str(), song.album_id.as_deref().unwrap()))
            .collect();
        assert_eq!(kept, vec![("b", "standard"), ("a", "deluxe")]);
        assert!(not_found.is_empty());
    }

    #[test]
    fn one_per_song_counts_a_song_found_and_not_found_as_found() {
        let found = vec![metadata("a", "x")];
        let not_found = strings(&["a", "b", "b", "c"]);
        let (found, not_found) = one_per_song(&found, &not_found);

        assert_eq!(found.len(), 1);
        assert_eq!(not_found, vec!["b", "c"]);
    }

    #[test]
    fn distinct_keeps_input_order() {
        assert_eq!(
            distinct(&strings(&["b", "a", "b", "c", "a"])),
            strings(&["b", "a", "c"])
        );
    }

    // ----- these run against a real database -----
    //
    // Each one works in a transaction that is never committed, so nothing it writes stays.
    // They need DATABASE_URL and the tables from sql/metadata_tags.sql, and run with
    // `cargo test -- --ignored`.

    use sea_orm::{Database, DatabaseTransaction, TransactionTrait};

    async fn scratch() -> DatabaseTransaction {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let db = Database::connect(url).await.expect("connect");
        db.begin().await.expect("begin")
    }

    fn song(id: &str, album_id: Option<&str>) -> SongMetadata {
        SongMetadata {
            id: id.into(),
            title: format!("title {id}"),
            artist_name: "artist".into(),
            album_name: Some("album".into()),
            album_id: album_id.map(str::to_owned),
            duration_ms: Some(200_000),
            artwork_url: None,
            genre_names: strings(&["Rock", "Music"]),
            release_date: Some("1999".into()),
            isrc: None,
            content_rating: None,
        }
    }

    /// Test ids no real catalog id can collide with.
    fn test_id(name: &str) -> String {
        format!("test-metadata-tags-{name}")
    }

    #[derive(Debug, FromQueryResult)]
    struct AlbumState {
        status: String,
        attempts: i32,
    }

    async fn album_state(txn: &DatabaseTransaction, album_id: &str) -> Option<AlbumState> {
        AlbumState::find_by_statement(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT status::text AS status, attempts FROM metadata_albums WHERE album_id = $1",
            [album_id.into()],
        ))
        .one(txn)
        .await
        .unwrap()
    }

    /// Puts an album first in line, ahead of anything the database already has queued.
    async fn make_oldest(txn: &DatabaseTransaction, album_id: &str) {
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE metadata_albums SET queued_at = '1970-01-01' WHERE album_id = $1",
            [album_id.into()],
        ))
        .await
        .unwrap();
    }

    #[tokio::test]
    #[ignore]
    async fn stored_songs_stop_being_missing_and_a_restore_replaces_them() {
        let txn = scratch().await;
        let (a, b, c) = (test_id("a"), test_id("b"), test_id("c"));
        let ids = vec![a.clone(), b.clone(), c.clone()];

        assert_eq!(get_songs_without_metadata(&txn, &ids).await.unwrap(), ids);

        store_song_metadata(&txn, &[song(&a, Some("10"))], std::slice::from_ref(&b))
            .await
            .unwrap();
        assert_eq!(
            get_songs_without_metadata(&txn, &ids).await.unwrap(),
            vec![c.clone()],
            "found and not found both count as stored"
        );
        assert_eq!(
            get_stored_album_id(&txn, &a).await.unwrap().as_deref(),
            Some("10")
        );
        assert_eq!(get_stored_album_id(&txn, &b).await.unwrap(), None);
        assert_eq!(get_stored_album_id(&txn, &c).await.unwrap(), None);

        // storing again replaces the row rather than failing on the primary key
        store_song_metadata(&txn, &[song(&a, Some("11"))], &[])
            .await
            .unwrap();
        assert_eq!(
            get_stored_album_id(&txn, &a).await.unwrap().as_deref(),
            Some("11")
        );
    }

    /// The album crawl can pass the same song twice in one call, when it is on two of the
    /// albums one pass crawls. A single insert with it twice is refused by postgres, which
    /// used to fail the whole pass.
    #[tokio::test]
    #[ignore]
    async fn a_song_passed_twice_in_one_call_is_stored_once() {
        let txn = scratch().await;
        let shared = test_id("shared-track");

        store_song_metadata(
            &txn,
            &[
                song(&shared, Some("standard")),
                song(&shared, Some("deluxe")),
            ],
            std::slice::from_ref(&shared),
        )
        .await
        .unwrap();

        let row = get_song_metadata(&txn, &shared).await.unwrap().unwrap();
        assert!(row.found);
        assert_eq!(row.album_id.as_deref(), Some("deluxe"));
    }

    #[tokio::test]
    #[ignore]
    async fn a_stored_row_has_the_query_shape() {
        let txn = scratch().await;
        let a = test_id("shape");
        store_song_metadata(&txn, &[song(&a, Some("10"))], &[])
            .await
            .unwrap();

        assert!(
            get_song_metadata(&txn, &test_id("never-stored"))
                .await
                .unwrap()
                .is_none()
        );
        let row = get_song_metadata(&txn, &a).await.unwrap().unwrap();
        assert!(row.found);
        assert_eq!(row.genre_names, strings(&["Rock"]));
        assert_eq!(row.release_date, NaiveDate::from_ymd_opt(1999, 1, 1));
        assert_eq!(row.duration_in_millis, Some(200_000));
    }

    #[tokio::test]
    #[ignore]
    async fn queueing_never_disturbs_an_album_already_known() {
        let txn = scratch().await;
        let album = test_id("album-queue");

        queue_albums(&txn, &[album.clone(), album.clone()])
            .await
            .unwrap();
        assert_eq!(album_state(&txn, &album).await.unwrap().status, "pending");

        make_oldest(&txn, &album).await;
        assert_eq!(
            claim_pending_albums(&txn, 1).await.unwrap(),
            vec![album.clone()]
        );
        finish_albums(&txn, std::slice::from_ref(&album))
            .await
            .unwrap();

        queue_albums(&txn, std::slice::from_ref(&album))
            .await
            .unwrap();
        assert_eq!(album_state(&txn, &album).await.unwrap().status, "done");
    }

    #[tokio::test]
    #[ignore]
    async fn only_a_done_album_is_requeued() {
        let txn = scratch().await;
        let (done, pending) = (test_id("requeue-done"), test_id("requeue-pending"));
        queue_albums(&txn, &[done.clone(), pending.clone()])
            .await
            .unwrap();
        make_oldest(&txn, &done).await;
        claim_pending_albums(&txn, 1).await.unwrap();
        finish_albums(&txn, std::slice::from_ref(&done))
            .await
            .unwrap();

        requeue_done_albums(&txn, &[done.clone(), pending.clone()])
            .await
            .unwrap();

        let state = album_state(&txn, &done).await.unwrap();
        assert_eq!(state.status, "pending");
        assert_eq!(state.attempts, 0, "attempts start over");
        assert_eq!(album_state(&txn, &pending).await.unwrap().status, "pending");
    }

    #[tokio::test]
    #[ignore]
    async fn a_claim_counts_an_attempt_and_a_counted_failure_can_fail_the_album() {
        let txn = scratch().await;
        let album = test_id("album-fail");
        queue_albums(&txn, std::slice::from_ref(&album))
            .await
            .unwrap();
        let ids = std::slice::from_ref(&album);

        // two tries allowed: the first failure goes back to pending, the second fails it
        make_oldest(&txn, &album).await;
        assert_eq!(claim_pending_albums(&txn, 1).await.unwrap(), ids);
        assert_eq!(album_state(&txn, &album).await.unwrap().status, "in_flight");
        release_albums(&txn, ids, true, 2).await.unwrap();
        let state = album_state(&txn, &album).await.unwrap();
        assert_eq!((state.status.as_str(), state.attempts), ("pending", 1));

        make_oldest(&txn, &album).await;
        assert_eq!(claim_pending_albums(&txn, 1).await.unwrap(), ids);
        release_albums(&txn, ids, true, 2).await.unwrap();
        let state = album_state(&txn, &album).await.unwrap();
        assert_eq!((state.status.as_str(), state.attempts), ("failed", 2));
    }

    #[tokio::test]
    #[ignore]
    async fn an_uncounted_release_takes_the_attempt_back() {
        let txn = scratch().await;
        let album = test_id("album-rate-limited");
        queue_albums(&txn, std::slice::from_ref(&album))
            .await
            .unwrap();
        make_oldest(&txn, &album).await;
        claim_pending_albums(&txn, 1).await.unwrap();

        release_albums(&txn, std::slice::from_ref(&album), false, 1)
            .await
            .unwrap();

        let state = album_state(&txn, &album).await.unwrap();
        assert_eq!((state.status.as_str(), state.attempts), ("pending", 0));
    }

    #[tokio::test]
    #[ignore]
    async fn an_album_left_in_flight_is_handed_back() {
        let txn = scratch().await;
        let album = test_id("album-stuck");
        queue_albums(&txn, std::slice::from_ref(&album))
            .await
            .unwrap();
        make_oldest(&txn, &album).await;
        claim_pending_albums(&txn, 1).await.unwrap();

        assert!(reset_in_flight_albums(&txn).await.unwrap() >= 1);
        assert_eq!(album_state(&txn, &album).await.unwrap().status, "pending");
    }

    #[tokio::test]
    #[ignore]
    async fn the_library_walk_skips_songs_with_a_row() {
        let txn = scratch().await;
        let user_id: sea_orm::prelude::Uuid = txn
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                "select id from auth.users limit 1",
            ))
            .await
            .unwrap()
            .expect("the database needs at least one user for this test")
            .try_get_by_index(0)
            .unwrap();
        let (stored, unstored) = (test_id("lib-stored"), test_id("lib-unstored"));

        // added in the future, so they are the newest in the library
        for song_id in [&stored, &unstored] {
            txn.execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO user_songs (song_id, user_id, created_at) VALUES ($1, $2, now() + interval '1 day')",
                [song_id.clone().into(), user_id.into()],
            ))
            .await
            .unwrap();
        }
        store_song_metadata(&txn, &[], std::slice::from_ref(&stored))
            .await
            .unwrap();

        let walk = get_library_songs_without_metadata(&txn, 1).await.unwrap();
        assert_eq!(walk, vec![unstored]);
    }

    async fn a_user(txn: &DatabaseTransaction) -> sea_orm::prelude::Uuid {
        txn.query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            "select id from auth.users limit 1",
        ))
        .await
        .unwrap()
        .expect("the database needs at least one user for this test")
        .try_get_by_index(0)
        .unwrap()
    }

    async fn total_plays(txn: &DatabaseTransaction, song_id: &str) -> i64 {
        get_song_metadata(txn, song_id)
            .await
            .unwrap()
            .unwrap()
            .total_plays
    }

    #[tokio::test]
    #[ignore]
    async fn a_new_row_counts_its_plays_from_the_log_and_a_restore_keeps_them() {
        let txn = scratch().await;
        let user_id = a_user(&txn).await;
        let (played, unplayed) = (test_id("plays-played"), test_id("plays-unplayed"));

        // two counted plays and a skip, logged before the song had a row
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
            INSERT INTO listening_events (user_id, event_type, song_id, occurred_at, client_event_id)
            VALUES ($1, 'play_counted', $2, now(), 'test-plays-1'),
                   ($1, 'play_counted', $2, now(), 'test-plays-2'),
                   ($1, 'skip', $2, now(), 'test-plays-3')
            "#,
            [user_id.into(), played.clone().into()],
        ))
        .await
        .unwrap();

        store_song_metadata(&txn, &[song(&played, None), song(&unplayed, None)], &[])
            .await
            .unwrap();
        assert_eq!(total_plays(&txn, &played).await, 2, "skips do not count");
        assert_eq!(total_plays(&txn, &unplayed).await, 0);

        add_total_plays(&txn, &[(played.as_str(), 3)])
            .await
            .unwrap();
        store_song_metadata(&txn, &[song(&played, Some("10"))], &[])
            .await
            .unwrap();
        assert_eq!(
            total_plays(&txn, &played).await,
            5,
            "storing again keeps the count rather than recounting or resetting it"
        );
    }

    #[tokio::test]
    #[ignore]
    async fn added_plays_land_on_existing_rows_and_skip_missing_ones() {
        let txn = scratch().await;
        let (a, b, missing) = (test_id("add-a"), test_id("add-b"), test_id("add-missing"));
        store_song_metadata(&txn, &[song(&a, None), song(&b, None)], &[])
            .await
            .unwrap();

        add_total_plays(
            &txn,
            &[(a.as_str(), 2), (b.as_str(), 1), (missing.as_str(), 4)],
        )
        .await
        .unwrap();
        add_total_plays(&txn, &[(a.as_str(), 1)]).await.unwrap();

        assert_eq!(total_plays(&txn, &a).await, 3);
        assert_eq!(total_plays(&txn, &b).await, 1);
        assert!(get_song_metadata(&txn, &missing).await.unwrap().is_none());
    }

    #[tokio::test]
    #[ignore]
    async fn counting_a_play_moves_total_plays_too() {
        let txn = scratch().await;
        let user_id = a_user(&txn).await;
        let song_id = test_id("record-play");
        store_song_metadata(&txn, &[song(&song_id, None)], &[])
            .await
            .unwrap();

        let at = Utc::now();
        crate::db::activity_tags::record_plays_within(
            &txn,
            user_id,
            &[(song_id.clone(), at), (song_id.clone(), at)],
        )
        .await
        .unwrap();

        assert_eq!(total_plays(&txn, &song_id).await, 2);
    }
}
