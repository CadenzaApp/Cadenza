//! Activity tags: shared tag definitions whose values the api writes per user
//! as they listen, rather than the user applying them.
//!
//! Each one is a single row in `tags` with `is_activity = true` and a null
//! `user_id`, shared by every user. Its values are ordinary rows in
//! `user_tags_applied`, keyed on the listening user, so the query compiler and
//! every other reader of that table see them like any other tag value.
//!
//! Tag ids are never hardcoded. Every lookup goes by `is_activity` and name,
//! and a missing row is created on the spot, so a wiped `tags` table heals on
//! the next request.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, QueryFilter,
    QueryOrder, Statement, TransactionTrait, prelude::Uuid,
};

use crate::db::entity::sea_orm_active_enums::TagType;
use crate::db::entity::{tags, user_tags_applied};
use crate::err::CadenzaError;

/// Every activity tag the api knows about. Adding one means adding a variant
/// here and teaching [`record_play`] (or another writer) to fill it in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ActivityTag {
    /// How many times the user has played the song. A number.
    MyPlays,
    /// When the user first played the song. A datetime.
    FirstPlayed,
    /// When the user last played the song. A datetime.
    LastPlayed,
}

impl ActivityTag {
    /// In display order.
    pub const ALL: [ActivityTag; 3] = [Self::MyPlays, Self::FirstPlayed, Self::LastPlayed];

    /// The name the tag row is looked up by.
    pub fn name(self) -> &'static str {
        match self {
            Self::MyPlays => "My Plays",
            Self::FirstPlayed => "First Played",
            Self::LastPlayed => "Last Played",
        }
    }

    fn tag_type(self) -> TagType {
        match self {
            Self::MyPlays => TagType::Number,
            Self::FirstPlayed | Self::LastPlayed => TagType::Datetime,
        }
    }

    /// Only used when the row has to be created.
    fn color(self) -> &'static str {
        match self {
            Self::MyPlays => "#0ea5e9",
            Self::FirstPlayed => "#22c55e",
            Self::LastPlayed => "#f59e0b",
        }
    }

    /// The value a song the user never interacted with has for this tag. Reads
    /// fill it in, and the query compiler treats a missing row as this value.
    /// `None` means a missing row stays empty, which is right for dates.
    pub fn default_value(self) -> Option<&'static str> {
        match self {
            Self::MyPlays => Some("0"),
            Self::FirstPlayed | Self::LastPlayed => None,
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|tag| tag.name() == name)
    }
}

/// Every activity tag row, in [`ActivityTag::ALL`] order, creating any that
/// are missing.
///
/// Found by `is_activity` and name, never by id, since the id changes if the
/// row is ever deleted and made again.
pub async fn get_activity_tags(
    db: &impl ConnectionTrait,
) -> Result<Vec<(ActivityTag, tags::Model)>, CadenzaError> {
    let mut found = find_activity_tags(db).await?;

    if found.len() < ActivityTag::ALL.len() {
        for tag in ActivityTag::ALL {
            if found.contains_key(&tag) {
                continue;
            }
            // Two requests can both see the row missing. The partial unique
            // index on (name) WHERE is_activity makes the second insert a no-op.
            db.execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO tags (name, color, user_id, type, is_activity)
                 VALUES ($1, $2, NULL, $3::tag_type, true)
                 ON CONFLICT (name) WHERE is_activity DO NOTHING",
                [
                    tag.name().into(),
                    tag.color().into(),
                    tag_type_name(tag.tag_type()).into(),
                ],
            ))
            .await?;
        }
        found = find_activity_tags(db).await?;
    }

    ActivityTag::ALL
        .into_iter()
        .map(|tag| {
            found.remove(&tag).map(|model| (tag, model)).ok_or_else(|| {
                CadenzaError::DatabaseError(format!(
                    "activity tag '{}' is missing and could not be created",
                    tag.name()
                ))
            })
        })
        .collect()
}

async fn find_activity_tags(
    db: &impl ConnectionTrait,
) -> Result<HashMap<ActivityTag, tags::Model>, CadenzaError> {
    let rows = tags::Entity::find()
        .filter(tags::Column::IsActivity.eq(true))
        .filter(tags::Column::Name.is_in(ActivityTag::ALL.map(ActivityTag::name)))
        // newest first, so when old data left a duplicate the oldest row is
        // collected last and wins
        .order_by_desc(tags::Column::TagId)
        .all(db)
        .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| Some((ActivityTag::from_name(&row.name)?, row)))
        .collect())
}

fn tag_type_name(tag_type: TagType) -> &'static str {
    match tag_type {
        TagType::Basic => "basic",
        TagType::Text => "text",
        TagType::Datetime => "datetime",
        TagType::Number => "number",
        TagType::Checkbox => "checkbox",
        TagType::Date => "date",
    }
}

/// Counts one play of the song for the user at `played_at`: adds 1 to My
/// Plays, sets First Played if this is earlier than what is there (or nothing
/// is), and sets Last Played if this is later.
pub async fn record_play(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_id: &str,
    played_at: DateTime<Utc>,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;
    record_plays_within(&txn, user_id, &[(song_id.to_owned(), played_at)]).await?;
    txn.commit().await?;
    Ok(())
}

/// Counts many plays at once, for a caller that already has a transaction.
///
/// Three statements whatever the batch size, not three per play. A client coming
/// back from a long offline stretch can flush hundreds of plays in one request,
/// and a select plus three upserts each would be hundreds of round trips inside
/// one transaction, which is how a statement timeout rolls the whole batch back
/// and sends the client round to retry exactly the same work.
///
/// Plays of the same song are folded first: My Plays adds the number of plays,
/// First Played takes the earliest and Last Played the latest. Folding also
/// keeps one song to one row per statement, which `ON CONFLICT DO UPDATE`
/// requires: it refuses to touch the same row twice in one command.
///
/// The three upserts have to land together, so this must never be called on a
/// bare connection.
pub async fn record_plays_within(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    plays: &[(String, DateTime<Utc>)],
) -> Result<(), CadenzaError> {
    if plays.is_empty() {
        return Ok(());
    }

    // song id -> how many plays, and the earliest and latest of them
    let mut folded: HashMap<&str, (i64, DateTime<Utc>, DateTime<Utc>)> = HashMap::new();
    for (song_id, played_at) in plays {
        folded
            .entry(song_id.as_str())
            .and_modify(|(count, first, last)| {
                *count += 1;
                *first = (*first).min(*played_at);
                *last = (*last).max(*played_at);
            })
            .or_insert((1, *played_at, *played_at));
    }

    let tag_ids: HashMap<ActivityTag, i64> = get_activity_tags(db)
        .await?
        .into_iter()
        .map(|(tag, model)| (tag, model.tag_id))
        .collect();

    for tag in ActivityTag::ALL {
        // EXCLUDED.value is the incoming text, so My Plays adds the batch's
        // count rather than a hardcoded 1
        let on_conflict = match tag {
            ActivityTag::MyPlays => {
                "(COALESCE(NULLIF(user_tags_applied.value, '')::numeric, 0) \
                 + EXCLUDED.value::numeric)::bigint::text"
            }
            ActivityTag::FirstPlayed => {
                "CASE WHEN user_tags_applied.value IS NULL
                        OR EXCLUDED.value::timestamptz < user_tags_applied.value::timestamptz
                    THEN EXCLUDED.value ELSE user_tags_applied.value END"
            }
            ActivityTag::LastPlayed => {
                "CASE WHEN user_tags_applied.value IS NULL
                        OR EXCLUDED.value::timestamptz > user_tags_applied.value::timestamptz
                    THEN EXCLUDED.value ELSE user_tags_applied.value END"
            }
        };

        let mut values: Vec<sea_orm::Value> = Vec::with_capacity(folded.len() * 4);
        let mut rows = Vec::with_capacity(folded.len());
        for (song_id, (count, first, last)) in &folded {
            let base = rows.len() * 4;
            rows.push(format!(
                "(${}, ${}, ${}, ${})",
                base + 1,
                base + 2,
                base + 3,
                base + 4
            ));
            values.push((*song_id).into());
            values.push(user_id.into());
            values.push(tag_ids[&tag].into());
            values.push(
                match tag {
                    ActivityTag::MyPlays => count.to_string(),
                    // the same canonical form `services::tag_values` stores
                    // datetimes in
                    ActivityTag::FirstPlayed => first.to_rfc3339(),
                    ActivityTag::LastPlayed => last.to_rfc3339(),
                }
                .into(),
            );
        }

        db.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            format!(
                "INSERT INTO user_tags_applied (song_id, user_id, tag_id, value)
                 VALUES {}
                 ON CONFLICT (song_id, user_id, tag_id) DO UPDATE SET value = {on_conflict}",
                rows.join(", ")
            ),
            values,
        ))
        .await?;
    }

    Ok(())
}

/// Every activity tag on each requested song for this user, paired with its
/// value, in [`ActivityTag::ALL`] order. Every requested song gets every
/// activity tag: a song the user never played gets each tag's
/// [`ActivityTag::default_value`], so My Plays reads `"0"` and the dates read
/// `None`.
pub async fn get_activity_tags_on_songs(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<HashMap<String, Vec<(tags::Model, Option<String>)>>, CadenzaError> {
    if song_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let activity_tags = get_activity_tags(db).await?;

    // (song id, tag id) -> value
    let values: HashMap<(String, i64), Option<String>> = user_tags_applied::Entity::find()
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .filter(user_tags_applied::Column::SongId.is_in(song_ids.iter().map(String::as_str)))
        .filter(
            user_tags_applied::Column::TagId
                .is_in(activity_tags.iter().map(|(_, model)| model.tag_id)),
        )
        .all(db)
        .await?
        .into_iter()
        .map(|row| ((row.song_id, row.tag_id), row.value))
        .collect();

    Ok(song_ids
        .iter()
        .map(|song_id| {
            let tags = activity_tags
                .iter()
                .map(|(tag, model)| {
                    let value = values
                        .get(&(song_id.clone(), model.tag_id))
                        .cloned()
                        .flatten()
                        .or_else(|| tag.default_value().map(str::to_owned));
                    (model.clone(), value)
                })
                .collect();
            (song_id.clone(), tags)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip() {
        for tag in ActivityTag::ALL {
            assert_eq!(ActivityTag::from_name(tag.name()), Some(tag));
        }
        assert_eq!(ActivityTag::from_name("my plays"), None);
    }

    #[test]
    fn only_counts_have_a_default() {
        assert_eq!(ActivityTag::MyPlays.default_value(), Some("0"));
        assert_eq!(ActivityTag::FirstPlayed.default_value(), None);
        assert_eq!(ActivityTag::LastPlayed.default_value(), None);
    }

    // ----- these need the database -----

    fn at(iso: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(iso)
            .unwrap()
            .with_timezone(&Utc)
    }

    /// A transaction that is never committed, and a user that really exists so
    /// the foreign key holds. Dropping it undoes everything.
    async fn scratch() -> (sea_orm::DatabaseTransaction, Uuid) {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let db = sea_orm::Database::connect(url).await.expect("connect");
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

    /// The value of one activity tag on one song, as the api would read it.
    async fn value_of(
        db: &impl ConnectionTrait,
        user_id: Uuid,
        song_id: &str,
        tag: ActivityTag,
    ) -> Option<String> {
        get_activity_tags_on_songs(db, user_id, &[song_id.to_owned()])
            .await
            .expect("read")
            .remove(song_id)
            .expect("the song is always present")
            .into_iter()
            .find(|(model, _)| ActivityTag::from_name(&model.name) == Some(tag))
            .and_then(|(_, value)| value)
    }

    /// Folding is the part that could get the arithmetic wrong: one statement
    /// per tag has to add up the same as one statement per play did.
    #[tokio::test]
    #[ignore]
    async fn a_batch_counts_every_play_and_keeps_the_outer_dates() {
        let (txn, user_id) = scratch().await;
        let song = format!("batch-test-{}", Uuid::new_v4());

        // three plays of one song, deliberately out of order
        let plays = vec![
            (song.clone(), at("2026-09-10T12:00:00Z")),
            (song.clone(), at("2026-09-08T09:00:00Z")),
            (song.clone(), at("2026-09-12T20:00:00Z")),
        ];
        record_plays_within(&txn, user_id, &plays).await.unwrap();

        assert_eq!(
            value_of(&txn, user_id, &song, ActivityTag::MyPlays).await,
            Some("3".to_owned()),
            "all three plays counted, not just one"
        );
        let first = value_of(&txn, user_id, &song, ActivityTag::FirstPlayed)
            .await
            .expect("first played");
        let last = value_of(&txn, user_id, &song, ActivityTag::LastPlayed)
            .await
            .expect("last played");
        assert_eq!(at(&first), at("2026-09-08T09:00:00Z"), "the earliest wins");
        assert_eq!(at(&last), at("2026-09-12T20:00:00Z"), "the latest wins");
    }

    /// A second batch has to add to the first, not replace it, and the dates
    /// must not go backwards.
    #[tokio::test]
    #[ignore]
    async fn a_later_batch_adds_to_what_is_there() {
        let (txn, user_id) = scratch().await;
        let song = format!("batch-test-{}", Uuid::new_v4());

        record_plays_within(&txn, user_id, &[(song.clone(), at("2026-09-10T12:00:00Z"))])
            .await
            .unwrap();
        record_plays_within(
            &txn,
            user_id,
            &[
                (song.clone(), at("2026-09-11T12:00:00Z")),
                (song.clone(), at("2026-09-09T12:00:00Z")),
            ],
        )
        .await
        .unwrap();

        assert_eq!(
            value_of(&txn, user_id, &song, ActivityTag::MyPlays).await,
            Some("3".to_owned())
        );
        let first = value_of(&txn, user_id, &song, ActivityTag::FirstPlayed)
            .await
            .unwrap();
        let last = value_of(&txn, user_id, &song, ActivityTag::LastPlayed)
            .await
            .unwrap();
        assert_eq!(at(&first), at("2026-09-09T12:00:00Z"), "moved earlier");
        assert_eq!(at(&last), at("2026-09-11T12:00:00Z"), "moved later");
    }

    #[tokio::test]
    #[ignore]
    async fn many_songs_in_one_batch_each_get_their_own_count() {
        let (txn, user_id) = scratch().await;
        let a = format!("batch-a-{}", Uuid::new_v4());
        let b = format!("batch-b-{}", Uuid::new_v4());

        record_plays_within(
            &txn,
            user_id,
            &[
                (a.clone(), at("2026-09-10T12:00:00Z")),
                (a.clone(), at("2026-09-10T13:00:00Z")),
                (b.clone(), at("2026-09-10T14:00:00Z")),
            ],
        )
        .await
        .unwrap();

        assert_eq!(
            value_of(&txn, user_id, &a, ActivityTag::MyPlays).await,
            Some("2".to_owned())
        );
        assert_eq!(
            value_of(&txn, user_id, &b, ActivityTag::MyPlays).await,
            Some("1".to_owned())
        );
    }

    #[tokio::test]
    #[ignore]
    async fn an_empty_batch_does_nothing() {
        let (txn, user_id) = scratch().await;
        record_plays_within(&txn, user_id, &[]).await.unwrap();
    }
}
