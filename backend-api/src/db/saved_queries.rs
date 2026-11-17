//! Queries a user saved by name, listed under Queries in the Library tab, and the songs
//! each one holds. A saved query's songs are what it matched when it was saved or last
//! rerun, not a live result. See `services::saved_queries` for how they are stored.

use std::collections::HashMap;

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ActiveValue::Set, ColumnTrait, ConnectionTrait,
    DatabaseConnection, EntityTrait, FromQueryResult, QueryFilter, QueryOrder, QuerySelect,
    TransactionTrait, prelude::Expr, prelude::Uuid, sea_query::OnConflict,
};

use crate::db::audience::{PrivacyField, can_see_field};
use crate::db::entity::{saved_queries, saved_query_songs};
use crate::err::CadenzaError;

/// The most artwork urls a saved query's cover holds.
pub const MAX_ARTWORK_URLS: usize = 4;

/// Rows written per insert, well under postgres' bind parameter limit.
const INSERT_BATCH: usize = 1000;

/// What a new saved query holds. `query` is already checked to parse as a
/// `routes::json::query::Query`.
pub struct NewSavedQuery {
    pub name: String,
    pub query: serde_json::Value,
    pub consider_default_tags: bool,
    pub library_or_tagged: bool,
    pub favorite: bool,
    pub artwork_urls: Option<Vec<String>>,
}

/// A partial change. `None` leaves a field alone.
#[derive(Default)]
pub struct SavedQueryPatch {
    pub name: Option<String>,
    pub favorite: Option<bool>,
    pub artwork_urls: Option<Vec<String>>,
    pub shared: Option<bool>,
}

/// The most shared queries a profile shows.
pub const MAX_PROFILE_QUERIES: u64 = 5;

/// One song a saved query holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedSong {
    pub song_id: String,
    /// In the user's library or carrying one of their tags when it was stored.
    pub certain: bool,
}

/// Every query the user saved, favorites first, then newest first.
pub async fn list_saved_queries(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> Result<Vec<saved_queries::Model>, CadenzaError> {
    Ok(saved_queries::Entity::find()
        .filter(saved_queries::Column::UserId.eq(user_id))
        .order_by_desc(saved_queries::Column::Favorite)
        .order_by_desc(saved_queries::Column::CreatedAt)
        .order_by_desc(saved_queries::Column::SavedQueryId)
        .all(db)
        .await?)
}

#[derive(FromQueryResult)]
struct SongCount {
    saved_query_id: i64,
    count: i64,
}

/// How many songs each of `ids` holds. An id with none is left out.
pub async fn count_songs(
    db: &DatabaseConnection,
    ids: &[i64],
) -> Result<HashMap<i64, i64>, CadenzaError> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let counts = saved_query_songs::Entity::find()
        .select_only()
        .column(saved_query_songs::Column::SavedQueryId)
        .column_as(saved_query_songs::Column::SongId.count(), "count")
        .filter(saved_query_songs::Column::SavedQueryId.is_in(ids.iter().copied()))
        .group_by(saved_query_songs::Column::SavedQueryId)
        .into_model::<SongCount>()
        .all(db)
        .await?;
    Ok(counts
        .into_iter()
        .map(|row| (row.saved_query_id, row.count))
        .collect())
}

/// One of the user's saved queries. `NotFound` when they have none by that id.
pub async fn get_saved_query(
    db: &DatabaseConnection,
    user_id: Uuid,
    saved_query_id: i64,
) -> Result<saved_queries::Model, CadenzaError> {
    saved_queries::Entity::find_by_id(saved_query_id)
        .filter(saved_queries::Column::UserId.eq(user_id))
        .one(db)
        .await?
        .ok_or(CadenzaError::NotFound)
}

/// A saved query `viewer` may read: one of their own, or one its owner shared on their
/// profile when their `profile_queries` setting lets `viewer` see it. `NotFound`
/// otherwise, so an id does not leak that it exists.
pub async fn get_viewable_saved_query(
    db: &impl ConnectionTrait,
    viewer: Uuid,
    saved_query_id: i64,
) -> Result<saved_queries::Model, CadenzaError> {
    let saved = saved_queries::Entity::find_by_id(saved_query_id)
        .one(db)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    if saved.user_id == viewer {
        return Ok(saved);
    }
    if saved.shared
        && can_see_field(db, viewer, saved.user_id, PrivacyField::ProfileQueries).await?
    {
        return Ok(saved);
    }
    Err(CadenzaError::NotFound)
}

/// The queries `owner` shared on their profile, favorites first, then newest first, at
/// most [`MAX_PROFILE_QUERIES`]. `None` when their `profile_queries` setting hides them
/// from `viewer`.
pub async fn profile_queries(
    db: &impl ConnectionTrait,
    viewer: Uuid,
    owner: Uuid,
) -> Result<Option<Vec<saved_queries::Model>>, CadenzaError> {
    if !can_see_field(db, viewer, owner, PrivacyField::ProfileQueries).await? {
        return Ok(None);
    }
    Ok(Some(
        saved_queries::Entity::find()
            .filter(saved_queries::Column::UserId.eq(owner))
            .filter(saved_queries::Column::Shared.eq(true))
            .order_by_desc(saved_queries::Column::Favorite)
            .order_by_desc(saved_queries::Column::CreatedAt)
            .order_by_desc(saved_queries::Column::SavedQueryId)
            .limit(MAX_PROFILE_QUERIES)
            .all(db)
            .await?,
    ))
}

/// Stores a query under a name, with no songs yet. `QueryNameAlreadyTaken` when the user
/// already has one by that name.
pub async fn create_saved_query(
    db: &DatabaseConnection,
    user_id: Uuid,
    new: NewSavedQuery,
) -> Result<saved_queries::Model, CadenzaError> {
    Ok(saved_queries::ActiveModel {
        saved_query_id: NotSet,
        user_id: Set(user_id),
        name: Set(new.name),
        query: Set(new.query),
        consider_default_tags: Set(new.consider_default_tags),
        library_or_tagged: Set(new.library_or_tagged),
        created_at: NotSet,
        favorite: Set(new.favorite),
        artwork_urls: Set(new.artwork_urls.map(artwork_json)),
        songs_stored_at: Set(None),
        shared: NotSet,
    }
    .insert(db)
    .await?)
}

/// Applies `patch` to one of the user's saved queries and returns it. `NotFound` when
/// they have none by that id, `QueryNameAlreadyTaken` for a name they already use.
pub async fn update_saved_query(
    db: &DatabaseConnection,
    user_id: Uuid,
    saved_query_id: i64,
    patch: SavedQueryPatch,
) -> Result<saved_queries::Model, CadenzaError> {
    let saved = get_saved_query(db, user_id, saved_query_id).await?;
    let mut row: saved_queries::ActiveModel = saved.into();
    if let Some(name) = patch.name {
        row.name = Set(name);
    }
    if let Some(favorite) = patch.favorite {
        row.favorite = Set(favorite);
    }
    if let Some(urls) = patch.artwork_urls {
        row.artwork_urls = Set(Some(artwork_json(urls)));
    }
    if let Some(shared) = patch.shared {
        row.shared = Set(shared);
    }
    Ok(row.update(db).await?)
}

/// Deletes one of the user's saved queries and its songs. `NotFound` when they have none
/// by that id.
pub async fn delete_saved_query(
    db: &DatabaseConnection,
    user_id: Uuid,
    saved_query_id: i64,
) -> Result<(), CadenzaError> {
    let result = saved_queries::Entity::delete_many()
        .filter(saved_queries::Column::UserId.eq(user_id))
        .filter(saved_queries::Column::SavedQueryId.eq(saved_query_id))
        .exec(db)
        .await?;
    if result.rows_affected == 0 {
        return Err(CadenzaError::NotFound);
    }
    Ok(())
}

/// The songs a saved query holds, in order.
pub async fn get_saved_songs(
    db: &DatabaseConnection,
    saved_query_id: i64,
) -> Result<Vec<SavedSong>, CadenzaError> {
    let rows = saved_query_songs::Entity::find()
        .filter(saved_query_songs::Column::SavedQueryId.eq(saved_query_id))
        .order_by_asc(saved_query_songs::Column::Position)
        .all(db)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| SavedSong {
            song_id: row.song_id,
            certain: row.certain,
        })
        .collect())
}

/// Replaces a saved query's songs with `songs`, in that order, and stamps when.
pub async fn replace_saved_songs(
    db: &DatabaseConnection,
    saved_query_id: i64,
    songs: &[SavedSong],
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;
    saved_query_songs::Entity::delete_many()
        .filter(saved_query_songs::Column::SavedQueryId.eq(saved_query_id))
        .exec(&txn)
        .await?;
    insert_songs(&txn, saved_query_id, songs, 0).await?;
    saved_queries::Entity::update_many()
        .col_expr(
            saved_queries::Column::SongsStoredAt,
            Expr::value(Utc::now().fixed_offset()),
        )
        .filter(saved_queries::Column::SavedQueryId.eq(saved_query_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

/// Adds `songs` to the end of a saved query, leaving any it already holds where they
/// are.
pub async fn append_saved_songs(
    db: &DatabaseConnection,
    saved_query_id: i64,
    songs: &[SavedSong],
) -> Result<(), CadenzaError> {
    if songs.is_empty() {
        return Ok(());
    }
    let txn = db.begin().await?;
    let last: Option<i32> = saved_query_songs::Entity::find()
        .select_only()
        .column_as(saved_query_songs::Column::Position.max(), "last")
        .filter(saved_query_songs::Column::SavedQueryId.eq(saved_query_id))
        .into_tuple::<Option<i32>>()
        .one(&txn)
        .await?
        .flatten();
    insert_songs(&txn, saved_query_id, songs, last.map_or(0, |last| last + 1)).await?;
    txn.commit().await?;
    Ok(())
}

async fn insert_songs(
    db: &impl ConnectionTrait,
    saved_query_id: i64,
    songs: &[SavedSong],
    first_position: i32,
) -> Result<(), CadenzaError> {
    for (batch_index, batch) in songs.chunks(INSERT_BATCH).enumerate() {
        let offset = first_position + (batch_index * INSERT_BATCH) as i32;
        let rows = batch
            .iter()
            .enumerate()
            .map(|(index, song)| saved_query_songs::ActiveModel {
                saved_query_id: Set(saved_query_id),
                song_id: Set(song.song_id.clone()),
                position: Set(offset + index as i32),
                certain: Set(song.certain),
            });
        // a song already held keeps its place
        saved_query_songs::Entity::insert_many(rows)
            .on_conflict(
                OnConflict::columns([
                    saved_query_songs::Column::SavedQueryId,
                    saved_query_songs::Column::SongId,
                ])
                .do_nothing()
                .to_owned(),
            )
            .exec_without_returning(db)
            .await?;
    }
    Ok(())
}

/// The cover urls as stored, at most [`MAX_ARTWORK_URLS`] of them.
fn artwork_json(urls: Vec<String>) -> serde_json::Value {
    serde_json::Value::from(
        urls.into_iter()
            .filter(|url| !url.is_empty())
            .take(MAX_ARTWORK_URLS)
            .collect::<Vec<_>>(),
    )
}

/// Reads a stored cover back. Anything that is not a list of strings reads as none.
pub fn read_artwork_urls(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|value| value.as_array())
        .map(|urls| {
            urls.iter()
                .filter_map(|url| url.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, DbBackend, Statement};

    use super::*;

    fn song(id: &str, certain: bool) -> SavedSong {
        SavedSong {
            song_id: id.to_owned(),
            certain,
        }
    }

    /// Stores, appends, counts, and deletes one saved query against the real database.
    /// Deletes what it made, even when an assert fails partway.
    #[tokio::test]
    #[ignore]
    async fn songs_append_after_the_last_and_replace_starts_over() {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let db = sea_orm::Database::connect(url).await.expect("connect");
        let row = db
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                "select id from auth.users limit 1",
            ))
            .await
            .expect("query users")
            .expect("the database needs at least one user for this test");
        let user_id: Uuid = row.try_get_by_index(0).expect("user id");

        let saved = create_saved_query(
            &db,
            user_id,
            NewSavedQuery {
                name: format!("test {}", Uuid::new_v4()),
                query: serde_json::json!({ "where": { "and": [] } }),
                consider_default_tags: false,
                library_or_tagged: true,
                favorite: false,
                artwork_urls: Some(vec!["a".into(), "".into(), "b".into()]),
            },
        )
        .await
        .expect("create");
        let id = saved.saved_query_id;

        let result = async {
            assert_eq!(read_artwork_urls(saved.artwork_urls.as_ref()), ["a", "b"]);
            replace_saved_songs(&db, id, &[song("1", true), song("2", false)]).await?;
            append_saved_songs(&db, id, &[song("2", true), song("3", true)]).await?;
            let songs = get_saved_songs(&db, id).await?;
            assert_eq!(songs, [song("1", true), song("2", false), song("3", true)]);
            assert_eq!(count_songs(&db, &[id]).await?.get(&id), Some(&3));

            replace_saved_songs(&db, id, &[song("9", true)]).await?;
            assert_eq!(get_saved_songs(&db, id).await?, [song("9", true)]);
            let stored = get_saved_query(&db, user_id, id).await?;
            assert!(stored.songs_stored_at.is_some());
            Ok::<_, CadenzaError>(())
        }
        .await;
        delete_saved_query(&db, user_id, id).await.expect("delete");
        result.expect("steps");
        assert_eq!(get_saved_songs(&db, id).await.expect("read"), []);
    }
}
