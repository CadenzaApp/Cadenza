use sea_orm::{
    ActiveValue::{NotSet, Set},
    ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait,
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
