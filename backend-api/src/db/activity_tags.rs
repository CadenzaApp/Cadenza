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
///
/// All three are upserts in one transaction, so two plays landing at once both
/// count and neither date goes backwards.
pub async fn record_play(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_id: &str,
    played_at: DateTime<Utc>,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;
    let tag_ids: HashMap<ActivityTag, i64> = get_activity_tags(&txn)
        .await?
        .into_iter()
        .map(|(tag, model)| (tag, model.tag_id))
        .collect();

    // same canonical form `services::tag_values` stores datetimes in
    let played_at = played_at.to_rfc3339();

    for tag in ActivityTag::ALL {
        let (initial, on_conflict) = match tag {
            ActivityTag::MyPlays => (
                "1".to_owned(),
                "(COALESCE(NULLIF(user_tags_applied.value, '')::numeric, 0) + 1)::bigint::text",
            ),
            ActivityTag::FirstPlayed => (
                played_at.clone(),
                "CASE WHEN user_tags_applied.value IS NULL
                        OR EXCLUDED.value::timestamptz < user_tags_applied.value::timestamptz
                    THEN EXCLUDED.value ELSE user_tags_applied.value END",
            ),
            ActivityTag::LastPlayed => (
                played_at.clone(),
                "CASE WHEN user_tags_applied.value IS NULL
                        OR EXCLUDED.value::timestamptz > user_tags_applied.value::timestamptz
                    THEN EXCLUDED.value ELSE user_tags_applied.value END",
            ),
        };

        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            format!(
                "INSERT INTO user_tags_applied (song_id, user_id, tag_id, value)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (song_id, user_id, tag_id) DO UPDATE SET value = {on_conflict}"
            ),
            [
                song_id.into(),
                user_id.into(),
                tag_ids[&tag].into(),
                initial.into(),
            ],
        ))
        .await?;
    }

    txn.commit().await?;
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
}
