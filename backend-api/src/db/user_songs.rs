use std::collections::HashSet;

use sea_orm::{
    ActiveValue::{NotSet, Set},
    ColumnTrait, DatabaseConnection, DbBackend, EntityTrait, FromQueryResult, QueryFilter,
    Statement, TransactionTrait,
    prelude::Uuid,
    sea_query::OnConflict,
};

use crate::db::entity::user_songs;
use crate::err::CadenzaError;

/// Adds and removes songs from the user's library, in one transaction.
///
/// A song already in the library, or already absent, is left alone rather than erroring.
/// Removals are applied before additions, so a song id sent in both ends up in the library.
///
/// Nothing but the library rows is touched: a removed song keeps the user's tags on it, and
/// keeps its default tags.
pub async fn edit_user_songs(
    db: &DatabaseConnection,
    user_id: Uuid,
    add: &[String],
    remove: &[String],
) -> Result<(), CadenzaError> {
    if add.is_empty() && remove.is_empty() {
        return Ok(());
    }

    let txn = db.begin().await?;

    if !remove.is_empty() {
        user_songs::Entity::delete_many()
            .filter(user_songs::Column::UserId.eq(user_id))
            .filter(user_songs::Column::SongId.is_in(remove.iter().map(String::as_str)))
            .exec(&txn)
            .await?;
    }

    if !add.is_empty() {
        let rows = add.iter().map(|song_id| user_songs::ActiveModel {
            song_id: Set(song_id.clone()),
            user_id: Set(user_id),
            // left out of the insert so the column's now() default stamps the
            // row, rather than the api's clock deciding when a song was added
            created_at: NotSet,
        });

        // a song the user already has is left alone rather than erroring, which is also
        // what makes a repeated id in one payload harmless
        user_songs::Entity::insert_many(rows)
            .on_conflict(
                OnConflict::columns([user_songs::Column::SongId, user_songs::Column::UserId])
                    .do_nothing()
                    .to_owned(),
            )
            .exec_without_returning(&txn)
            .await?;
    }

    txn.commit().await?;
    Ok(())
}

/// One song id per row, the only column the backfill query selects.
#[derive(FromQueryResult)]
struct UngeneratedSong {
    song_id: String,
}

/// Song ids in someone's library that have never had default tags generated,
/// most recently added first, at most `limit` of them.
///
/// Asks `default_tags_generation` rather than `default_tags_applied` on purpose.
/// A song Apple Music has no catalog entry for ends up with no applied tags but
/// is still marked done, and selecting on applied rows would hand those
/// back on every call while never reaching the songs that need generating.
///
/// Any row counts, `in_flight` included, so a pass does not pick up a song a live
/// read is already generating for.
///
/// Ordered by `created_at` alone rather than grouped by song id, so the ordering
/// can walk `user_songs_created_at_idx` instead of aggregating the whole table
/// first. One song held by several users can therefore take more than one row of
/// `limit`; the duplicates are dropped here and the rest come back next call.
pub async fn get_recent_songs_without_generated_default_tags(
    db: &DatabaseConnection,
    limit: u64,
) -> Result<Vec<String>, CadenzaError> {
    if limit == 0 {
        return Ok(Vec::new());
    }

    let rows = UngeneratedSong::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r#"
        SELECT us.song_id
        FROM user_songs AS us
        LEFT JOIN default_tags_generation AS dtg ON dtg.song_id = us.song_id
        WHERE dtg.song_id IS NULL
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
