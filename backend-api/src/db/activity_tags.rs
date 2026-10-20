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
//!
//! Two of them are derived rather than stored: In My Library and Tagged are worked
//! out from `user_songs` and the user's own applied tags whenever they are read or
//! queried, so they never have a row in `user_tags_applied` and are never stale.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, Statement, TransactionTrait, prelude::Uuid,
};

use crate::db::entity::sea_orm_active_enums::TagType;
use crate::db::entity::{tags, user_songs, user_tags_applied};
use crate::db::metadata_tags::add_total_plays;
use crate::err::CadenzaError;
use crate::services::analytics::EventType;

/// The color every activity tag is shown in. [`get_activity_tags`] creates rows
/// with it and recolors any row that has another, so changing it here is all a
/// recolor takes.
pub const ACTIVITY_TAG_COLOR: &str = "#b5742f";

/// Every activity tag the api knows about. Adding one means adding a variant
/// here and teaching [`record_play`] (or another writer) to fill it in, or making
/// it [`derived`](ActivityTag::is_derived).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ActivityTag {
    /// How many times the user has played the song. A number.
    MyPlays,
    /// When the user first played the song. A datetime.
    FirstPlayed,
    /// When the user last played the song. A datetime.
    LastPlayed,
    /// Whether the song is in the user's Apple Music library, which is whether it
    /// has a `user_songs` row. A checkbox. Derived.
    InMyLibrary,
    /// Whether the user favorited the song in Cadenza. A checkbox, set from their
    /// latest `song_favorited` or `song_unfavorited` event by
    /// [`set_favorites_within`]. Apple Music owns favorites, so one made outside
    /// Cadenza is not known here.
    Favorited,
    /// Whether the user put any tag of their own on the song, a suggested tag they
    /// adopted included. A checkbox. Derived.
    Tagged,
}

impl ActivityTag {
    /// In display order.
    pub const ALL: [ActivityTag; 6] = [
        Self::MyPlays,
        Self::FirstPlayed,
        Self::LastPlayed,
        Self::InMyLibrary,
        Self::Favorited,
        Self::Tagged,
    ];

    /// The tags a play moves, which [`record_plays_within`] writes.
    const PLAY_TAGS: [ActivityTag; 3] = [Self::MyPlays, Self::FirstPlayed, Self::LastPlayed];

    /// The name the tag row is looked up by.
    pub fn name(self) -> &'static str {
        match self {
            Self::MyPlays => "My Plays",
            Self::FirstPlayed => "First Played",
            Self::LastPlayed => "Last Played",
            Self::InMyLibrary => "In My Library",
            Self::Favorited => "Favorited",
            Self::Tagged => "Tagged",
        }
    }

    fn tag_type(self) -> TagType {
        match self {
            Self::MyPlays => TagType::Number,
            Self::FirstPlayed | Self::LastPlayed => TagType::Datetime,
            Self::InMyLibrary | Self::Favorited | Self::Tagged => TagType::Checkbox,
        }
    }

    /// The value a song the user never interacted with has for this tag. Reads
    /// fill it in, and the query compiler treats a missing row as this value.
    /// `None` means a missing row stays empty, which is right for dates. The
    /// checkboxes are never empty: a song that is not favorited reads `false`.
    pub fn default_value(self) -> Option<&'static str> {
        match self {
            Self::MyPlays => Some("0"),
            Self::FirstPlayed | Self::LastPlayed => None,
            Self::InMyLibrary | Self::Favorited | Self::Tagged => Some("false"),
        }
    }

    /// Whether the value is worked out from other tables whenever it is read, rather
    /// than stored in `user_tags_applied`. In My Library reads `user_songs`, and
    /// Tagged reads the user's own applied tags, so neither can go stale.
    pub fn is_derived(self) -> bool {
        matches!(self, Self::InMyLibrary | Self::Tagged)
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|tag| tag.name() == name)
    }
}

/// Every activity tag row, in [`ActivityTag::ALL`] order, creating any that
/// are missing and recoloring any that is not [`ACTIVITY_TAG_COLOR`].
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
                    ACTIVITY_TAG_COLOR.into(),
                    tag_type_name(tag.tag_type()).into(),
                ],
            ))
            .await?;
        }
        found = find_activity_tags(db).await?;
    }

    // rows made before the color changed keep the old one until this runs once
    if found.values().any(|row| row.color != ACTIVITY_TAG_COLOR) {
        db.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE tags SET color = $1 WHERE is_activity AND color IS DISTINCT FROM $1",
            [ACTIVITY_TAG_COLOR.into()],
        ))
        .await?;
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

/// The enum's name as the `tag_type` column spells it.
///
/// Public because `db::analytics` needs the inverse, and two hand-written
/// mappings over a generated enum are free to drift.
pub fn tag_type_name(tag_type: TagType) -> &'static str {
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
/// Each play also adds to the song's `total_plays` in `metadata_song_tags_applied`, every
/// user's plays together, so the Total Plays metadata tag moves with My Plays.
///
/// The writes have to land together, so this must never be called on a bare
/// connection.
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

    for tag in ActivityTag::PLAY_TAGS {
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
            _ => unreachable!("only the play tags are written here"),
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
                    _ => unreachable!("only the play tags are written here"),
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

    // every user's plays of the song together, for its Total Plays metadata tag
    let total_plays: Vec<(&str, i64)> = folded
        .iter()
        .map(|(song_id, (count, ..))| (*song_id, *count))
        .collect();
    add_total_plays(db, &total_plays).await?;

    Ok(())
}

/// Sets Favorited on each song from the user's latest `song_favorited` or
/// `song_unfavorited` event for it: a row holding `true` after a favorite, and no
/// row, which reads `false`, after an unfavorite.
///
/// Reads the log rather than trusting the events in hand, so a favorite flushed
/// late from an offline queue cannot undo an unfavorite that happened after it.
/// Events with the same `occurred_at` go to the one stored last.
///
/// Must run in the transaction that stored the events, the same as
/// [`record_plays_within`].
pub async fn set_favorites_within(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<(), CadenzaError> {
    if song_ids.is_empty() {
        return Ok(());
    }

    let favorited = get_activity_tags(db)
        .await?
        .into_iter()
        .find(|(tag, _)| *tag == ActivityTag::Favorited)
        .map(|(_, model)| model.tag_id)
        .ok_or_else(|| {
            CadenzaError::DatabaseError("the Favorited activity tag is missing".to_string())
        })?;

    let mut values: Vec<sea_orm::Value> = vec![
        user_id.into(),
        favorited.into(),
        EventType::SongFavorited.name().into(),
        EventType::SongUnfavorited.name().into(),
    ];
    let song_params = song_ids
        .iter()
        .map(|song_id| {
            values.push(song_id.clone().into());
            format!("${}", values.len())
        })
        .collect::<Vec<_>>()
        .join(", ");
    // each song's latest favorite event, by the time it happened, then the order
    // it was stored in
    let latest = format!(
        "SELECT DISTINCT ON (song_id) song_id, event_type
         FROM listening_events
         WHERE user_id=$1 AND event_type IN ($3, $4) AND song_id IN ({song_params})
         ORDER BY song_id, occurred_at DESC, event_id DESC"
    );

    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        format!(
            "INSERT INTO user_tags_applied (song_id, user_id, tag_id, value)
             SELECT latest.song_id, $1, $2, 'true'
             FROM ({latest}) AS latest
             WHERE latest.event_type=$3
             ON CONFLICT (song_id, user_id, tag_id) DO UPDATE SET value='true'"
        ),
        values.clone(),
    ))
    .await?;
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        format!(
            "DELETE FROM user_tags_applied
             WHERE user_id=$1 AND tag_id=$2 AND song_id IN (
                 SELECT latest.song_id FROM ({latest}) AS latest WHERE latest.event_type=$4
             )"
        ),
        values,
    ))
    .await?;

    Ok(())
}

/// Which of `song_ids` are in the user's library, and which carry a tag of the
/// user's own, for the derived In My Library and Tagged tags.
async fn derived_activity(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<(HashSet<String>, HashSet<String>), CadenzaError> {
    let in_library: HashSet<String> = user_songs::Entity::find()
        .select_only()
        .column(user_songs::Column::SongId)
        .filter(user_songs::Column::UserId.eq(user_id))
        .filter(user_songs::Column::SongId.is_in(song_ids.iter().map(String::as_str)))
        .into_tuple::<String>()
        .all(db)
        .await?
        .into_iter()
        .collect();

    let mut values: Vec<sea_orm::Value> = vec![user_id.into()];
    let song_params = song_ids
        .iter()
        .map(|song_id| {
            values.push(song_id.clone().into());
            format!("${}", values.len())
        })
        .collect::<Vec<_>>()
        .join(", ");
    // the user's own tags have their user id; activity and default tags have none
    let tagged: HashSet<String> = db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            format!(
                "SELECT DISTINCT applied.song_id
                 FROM user_tags_applied AS applied
                 JOIN tags ON tags.tag_id=applied.tag_id
                 WHERE applied.user_id=$1 AND tags.user_id=$1
                     AND applied.song_id IN ({song_params})"
            ),
            values,
        ))
        .await?
        .into_iter()
        .map(|row| row.try_get_by_index::<String>(0))
        .collect::<Result<_, _>>()?;

    Ok((in_library, tagged))
}

/// Every activity tag on each requested song for this user, paired with its
/// value, in [`ActivityTag::ALL`] order. Every requested song gets every
/// activity tag: a song the user never played gets each tag's
/// [`ActivityTag::default_value`], so My Plays reads `"0"`, the dates read
/// `None`, and the checkboxes read `"false"`. In My Library and Tagged are worked
/// out here rather than read from a row.
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
    let (in_library, tagged) = derived_activity(db, user_id, song_ids).await?;

    Ok(song_ids
        .iter()
        .map(|song_id| {
            let tags = activity_tags
                .iter()
                .map(|(tag, model)| {
                    let derived = match tag {
                        ActivityTag::InMyLibrary => Some(in_library.contains(song_id)),
                        ActivityTag::Tagged => Some(tagged.contains(song_id)),
                        _ => None,
                    };
                    let value = match derived {
                        Some(on) => Some(on.to_string()),
                        None => values
                            .get(&(song_id.clone(), model.tag_id))
                            .cloned()
                            .flatten()
                            .or_else(|| tag.default_value().map(str::to_owned)),
                    };
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
    fn counts_and_checkboxes_have_a_default_and_dates_do_not() {
        assert_eq!(ActivityTag::MyPlays.default_value(), Some("0"));
        assert_eq!(ActivityTag::FirstPlayed.default_value(), None);
        assert_eq!(ActivityTag::LastPlayed.default_value(), None);
        for tag in [
            ActivityTag::InMyLibrary,
            ActivityTag::Favorited,
            ActivityTag::Tagged,
        ] {
            assert_eq!(tag.default_value(), Some("false"), "{}", tag.name());
            assert_eq!(tag.tag_type(), TagType::Checkbox, "{}", tag.name());
        }
    }

    #[test]
    fn only_library_and_tagged_are_derived() {
        let derived: Vec<_> = ActivityTag::ALL
            .into_iter()
            .filter(|tag| tag.is_derived())
            .collect();
        assert_eq!(derived, [ActivityTag::InMyLibrary, ActivityTag::Tagged]);
    }

    /// A play writes My Plays and the two dates, and nothing else. Writing the
    /// checkboxes from a play would mark every played song favorited.
    #[test]
    fn a_play_only_moves_the_play_tags() {
        assert_eq!(
            ActivityTag::PLAY_TAGS,
            [
                ActivityTag::MyPlays,
                ActivityTag::FirstPlayed,
                ActivityTag::LastPlayed
            ]
        );
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

    /// A row left with an old color is recolored by the next lookup.
    #[tokio::test]
    #[ignore]
    async fn an_old_color_is_replaced() {
        let (txn, _) = scratch().await;
        get_activity_tags(&txn).await.expect("create");
        txn.execute_raw(Statement::from_string(
            DbBackend::Postgres,
            "UPDATE tags SET color = '#000000' WHERE is_activity",
        ))
        .await
        .expect("make stale");

        for (tag, row) in get_activity_tags(&txn).await.expect("read") {
            assert_eq!(row.color, ACTIVITY_TAG_COLOR, "{tag:?}");
        }
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

    /// Stores favorite events for one song, the way `POST /events` would, then
    /// sets Favorited from them.
    async fn favorite_events(
        txn: &sea_orm::DatabaseTransaction,
        user_id: Uuid,
        song: &str,
        events: &[(EventType, &str)],
    ) {
        let events: Vec<crate::db::events::NewEvent> = events
            .iter()
            .map(|(event_type, occurred_at)| crate::db::events::NewEvent {
                event_type: *event_type,
                song_id: Some(song.to_owned()),
                occurred_at: at(occurred_at),
                client_tz: "UTC".to_owned(),
                session_id: None,
                client_event_id: format!("fav-{}", Uuid::new_v4()),
                payload: serde_json::json!({}),
            })
            .collect();
        crate::db::events::insert_events(txn, user_id, &events)
            .await
            .unwrap();
        set_favorites_within(txn, user_id, &[song.to_owned()])
            .await
            .unwrap();
    }

    /// Favorited follows the latest favorite event by when it happened, so one
    /// flushed late from an offline queue cannot undo a later change.
    #[tokio::test]
    #[ignore]
    async fn favorited_follows_the_latest_favorite_event() {
        let (txn, user_id) = scratch().await;
        let song = format!("fav-test-{}", Uuid::new_v4());
        let favorited = |txn| value_of(txn, user_id, &song, ActivityTag::Favorited);

        assert_eq!(
            favorited(&txn).await,
            Some("false".to_owned()),
            "never favorited"
        );

        favorite_events(
            &txn,
            user_id,
            &song,
            &[(EventType::SongFavorited, "2026-09-10T12:00:00Z")],
        )
        .await;
        assert_eq!(favorited(&txn).await, Some("true".to_owned()));

        favorite_events(
            &txn,
            user_id,
            &song,
            &[(EventType::SongUnfavorited, "2026-09-11T12:00:00Z")],
        )
        .await;
        assert_eq!(favorited(&txn).await, Some("false".to_owned()));

        // older than the unfavorite, so it changes nothing
        favorite_events(
            &txn,
            user_id,
            &song,
            &[(EventType::SongFavorited, "2026-09-09T12:00:00Z")],
        )
        .await;
        assert_eq!(
            favorited(&txn).await,
            Some("false".to_owned()),
            "a late favorite"
        );

        // and within one batch the latest wins too
        favorite_events(
            &txn,
            user_id,
            &song,
            &[
                (EventType::SongFavorited, "2026-09-13T12:00:00Z"),
                (EventType::SongUnfavorited, "2026-09-12T12:00:00Z"),
            ],
        )
        .await;
        assert_eq!(favorited(&txn).await, Some("true".to_owned()));
    }

    /// In My Library and Tagged are read from `user_songs` and the user's own tags,
    /// never from an activity row, so an activity row of their own does not count.
    #[tokio::test]
    #[ignore]
    async fn library_and_tagged_are_read_from_their_tables() {
        let (txn, user_id) = scratch().await;
        let in_library = format!("lib-test-{}", Uuid::new_v4());
        let own_tagged = format!("tagged-test-{}", Uuid::new_v4());
        let only_played = format!("played-test-{}", Uuid::new_v4());

        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO user_songs (song_id, user_id) VALUES ($1, $2)",
            [in_library.clone().into(), user_id.into()],
        ))
        .await
        .unwrap();
        let tag_id: i64 = txn
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO tags (name, color, user_id) VALUES ('tagged-test', '#000000', $1) RETURNING tag_id",
                [user_id.into()],
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get_by_index(0)
            .unwrap();
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO user_tags_applied (song_id, user_id, tag_id) VALUES ($1, $2, $3)",
            [own_tagged.clone().into(), user_id.into(), tag_id.into()],
        ))
        .await
        .unwrap();
        // a play writes activity rows, which are not the user's own tags
        record_plays_within(
            &txn,
            user_id,
            &[(only_played.clone(), at("2026-09-10T12:00:00Z"))],
        )
        .await
        .unwrap();

        for (song, library, tagged) in [
            (&in_library, "true", "false"),
            (&own_tagged, "false", "true"),
            (&only_played, "false", "false"),
        ] {
            assert_eq!(
                value_of(&txn, user_id, song, ActivityTag::InMyLibrary)
                    .await
                    .as_deref(),
                Some(library),
                "{song} in library"
            );
            assert_eq!(
                value_of(&txn, user_id, song, ActivityTag::Tagged)
                    .await
                    .as_deref(),
                Some(tagged),
                "{song} tagged"
            );
        }
        // and a play leaves Favorited alone
        assert_eq!(
            value_of(&txn, user_id, &only_played, ActivityTag::Favorited)
                .await
                .as_deref(),
            Some("false")
        );
    }

    #[tokio::test]
    #[ignore]
    async fn an_empty_batch_does_nothing() {
        let (txn, user_id) = scratch().await;
        record_plays_within(&txn, user_id, &[]).await.unwrap();
    }
}
