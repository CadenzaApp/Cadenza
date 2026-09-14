use std::collections::{HashMap, HashSet};

use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, FromQueryResult,
    JoinType, ModelTrait, QueryFilter, QuerySelect, Statement, TransactionTrait,
    prelude::Uuid,
    sea_query::OnConflict,
};
use serde::Serialize;

use crate::db::entity::*;
use crate::err::CadenzaError;
use crate::services::tag_generation::TagSpecs;

pub async fn get_all_user_tags(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> Result<Vec<tags::Model>, CadenzaError> {
    Ok(tags::Entity::find()
        .filter(tags::Column::UserId.eq(user_id))
        .all(db)
        .await?)
}

pub async fn get_tag(
    db: &DatabaseConnection,
    tag_id: i64,
) -> Result<Option<tags::Model>, CadenzaError> {
    Ok(tags::Entity::find_by_id(tag_id).one(db).await?)
}

#[derive(FromQueryResult)]
struct TagCount {
    tag_id: i64,
    count: Option<i64>,
}

#[derive(Serialize)]
pub struct TagMetadata {
    count: usize,
}

pub async fn get_user_tags_metadata(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> Result<HashMap<i64, TagMetadata>, CadenzaError> {
    let tag_usage_counts = tags::Entity::find()
        .join_rev(
            JoinType::LeftJoin,
            user_tags_applied::Entity::belongs_to(tags::Entity)
                .from(user_tags_applied::Column::TagId)
                .to(tags::Column::TagId)
                .into(),
        )
        .select_only()
        .column(tags::Column::TagId)
        .column_as(user_tags_applied::Column::SongId.count(), "count")
        .filter(tags::Column::UserId.eq(user_id))
        .group_by(tags::Column::TagId)
        .into_model::<TagCount>()
        .all(db)
        .await?;

    let mut res = HashMap::new();
    for TagCount { tag_id, count } in tag_usage_counts {
        res.insert(
            tag_id,
            TagMetadata {
                count: count.unwrap_or(0) as usize,
            },
        );
    }

    Ok(res)
}

/// Returns the tags on each requested song. A song with none of the user's tags
/// gets the user's copies of its default tags instead (see
/// [`copy_default_tags_to_user`]), so later reads find them as the user's own.
/// Every requested song gets an entry, so a song with no tags of either kind
/// comes back as an empty list.
pub async fn get_user_tags_on_songs(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<HashMap<String, Vec<tags::Model>>, CadenzaError> {
    // start every requested song off with no tags
    let mut songs_to_tags: HashMap<String, Vec<tags::Model>> = song_ids
        .iter()
        .map(|song_id| (song_id.clone(), Vec::new()))
        .collect();

    // no songs requested, so nothing to look up
    if songs_to_tags.is_empty() {
        return Ok(songs_to_tags);
    }

    // fill in the tags the user put on each song
    let applied = user_tags_applied::Entity::find()
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .filter(user_tags_applied::Column::SongId.is_in(song_ids.iter().map(String::as_str)))
        .find_also_related(tags::Entity)
        .all(db)
        .await?;

    for (applied_tag, tag) in applied {
        let Some(tag) = tag else { continue };
        songs_to_tags
            .entry(applied_tag.song_id)
            .or_default()
            .push(tag);
    }

    // if user doesn't have any tags for these songs, get the default ones
    let songs_without_user_tags: Vec<String> = songs_to_tags
        .iter()
        .filter(|(_, tags)| tags.is_empty())
        .map(|(song_id, _)| song_id.clone())
        .collect();

    if !songs_without_user_tags.is_empty() {
        let default_tags = get_default_tags_on_songs(db, &songs_without_user_tags).await?;

        // make the default tags the user's own, and return the copies in their place
        if !default_tags.is_empty() {
            let copied_tags = copy_default_tags_to_user(db, user_id, default_tags).await?;
            songs_to_tags.extend(copied_tags);
        }
    }

    Ok(songs_to_tags)
}

/// Copies default tags into the user's own tags and applies the copies to the
/// songs, returning the copies per song. A default tag reuses the user's tag with
/// the same name when they have one, and otherwise becomes a new tag of theirs
/// with the default's name and color.
async fn copy_default_tags_to_user(
    db: &DatabaseConnection,
    user_id: Uuid,
    default_tags: HashMap<String, Vec<tags::Model>>,
) -> Result<HashMap<String, Vec<tags::Model>>, CadenzaError> {
    let txn = db.begin().await?;

    // hold a per-user lock until commit, so two racing reads can't both create the
    // same tag for this user
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT pg_advisory_xact_lock(hashtext('copy_default_tags'), hashtext($1))",
        [user_id.to_string().into()],
    ))
    .await?;

    // find the user's tags that already have a default tag's name
    let default_names: HashSet<&str> = default_tags
        .values()
        .flatten()
        .map(|tag| tag.name.as_str())
        .collect();

    let mut name_to_user_tag: HashMap<String, tags::Model> = tags::Entity::find()
        .filter(tags::Column::UserId.eq(user_id))
        .filter(tags::Column::Name.is_in(default_names.iter().copied()))
        .all(&txn)
        .await?
        .into_iter()
        .map(|tag| (tag.name.clone(), tag))
        .collect();

    // create a tag for the user for each default name they don't have yet, once per name
    let new_tags: HashMap<&str, tags::ActiveModel> = default_tags
        .values()
        .flatten()
        .filter(|tag| !name_to_user_tag.contains_key(&tag.name))
        .map(|tag| {
            let new_tag = tags::ActiveModel {
                tag_id: NotSet,
                user_id: Set(Some(user_id)),
                name: Set(tag.name.clone()),
                color: Set(tag.color.clone()),
            };
            (tag.name.as_str(), new_tag)
        })
        .collect();

    let created = tags::Entity::insert_many(new_tags.into_values())
        .exec_with_returning(&txn)
        .await?;
    name_to_user_tag.extend(created.into_iter().map(|tag| (tag.name.clone(), tag)));

    // swap each song's default tags for the user's copies
    let copied_tags: HashMap<String, Vec<tags::Model>> = default_tags
        .into_iter()
        .map(|(song_id, defaults)| {
            let copies = defaults
                .iter()
                .filter_map(|tag| name_to_user_tag.get(&tag.name).cloned())
                .collect();
            (song_id, copies)
        })
        .collect();

    // put the copies on the songs. rows that already exist are skipped
    let applied = copied_tags.iter().flat_map(|(song_id, copies)| {
        copies.iter().map(|tag| user_tags_applied::ActiveModel {
            song_id: Set(song_id.clone()),
            user_id: Set(user_id),
            tag_id: Set(tag.tag_id),
        })
    });

    user_tags_applied::Entity::insert_many(applied)
        .on_conflict(
            OnConflict::columns([
                user_tags_applied::Column::SongId,
                user_tags_applied::Column::UserId,
                user_tags_applied::Column::TagId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec_without_returning(&txn)
        .await?;

    txn.commit().await?;

    Ok(copied_tags)
}

/// Returns the requested songs that have no tags at all, meaning none of the
/// user's tags and no default tags. Keeps the order the ids were given in.
pub async fn get_untagged_songs(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<Vec<String>, CadenzaError> {
    // tags on each song, already falling back to default tags
    let tags_by_song = get_user_tags_on_songs(db, user_id, song_ids).await?;

    // keep the songs that came back with none
    Ok(song_ids
        .iter()
        .filter(|song_id| tags_by_song.get(*song_id).is_none_or(Vec::is_empty))
        .cloned()
        .collect())
}

pub async fn get_songs_with_user_tag(
    db: &DatabaseConnection,
    user_id: Uuid,
    tag_id: i64,
) -> Result<Vec<String>, CadenzaError> {
    let song_ids: Vec<String> = user_tags_applied::Entity::find()
        .filter(user_tags_applied::Column::TagId.eq(tag_id))
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .select_only()
        .column(user_tags_applied::Column::SongId)
        .into_tuple()
        .all(db)
        .await?;

    Ok(song_ids)
}

pub async fn new_user_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    name: String,
    color: String,
) -> Result<i64, CadenzaError> {
    let new_tag = tags::ActiveModel {
        tag_id: NotSet,
        user_id: Set(Some(user_id)),
        name: Set(name),
        color: Set(color),
    };
    let new_tag = new_tag.insert(&db).await?;

    Ok(new_tag.tag_id)
}

pub async fn delete_user_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    tag_id: i64,
) -> Result<(), CadenzaError> {
    let tag = tags::Entity::find_by_id(tag_id)
        .filter(tags::Column::UserId.eq(user_id))
        .one(&db)
        .await?;

    if let Some(tag) = tag {
        tag.delete(&db).await?;
    }

    Ok(())
}

pub async fn apply_user_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    song_id: String,
    tag_id: i64,
) -> Result<(), CadenzaError> {
    let new_tag_relation = user_tags_applied::ActiveModel {
        user_id: Set(user_id),
        song_id: Set(song_id),
        tag_id: Set(tag_id),
    };

    new_tag_relation.insert(&db).await?;
    Ok(())
}

pub async fn unapply_user_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    song_id: String,
    tag_id: i64,
) -> Result<(), CadenzaError> {
    let applied_tag = user_tags_applied::Entity::find()
        .filter(user_tags_applied::Column::SongId.eq(song_id))
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .filter(user_tags_applied::Column::TagId.eq(tag_id))
        .one(&db)
        .await?;

    if let Some(applied_tag) = applied_tag {
        applied_tag.delete(&db).await?;
    }

    Ok(())
}


pub async fn get_default_tags_on_songs(
    db: &DatabaseConnection,
    song_ids: &[String],
) -> Result<HashMap<String, Vec<tags::Model>>, CadenzaError> {
    let applied = default_tags_applied::Entity::find()
        .filter(default_tags_applied::Column::SongId.is_in(song_ids))
        .find_also_related(tags::Entity)
        .all(db)
        .await?;

    let mut res: HashMap<String, Vec<tags::Model>> = HashMap::new();
    for (applied, tag) in applied {
        if let Some(tag) = tag {
            res.entry(applied.song_id).or_default().push(tag);
        }
    }

    Ok(res)
}

/// replaces the default tags on each given song with the given tags,
/// creating tags that don't exist yet. returns the applied tags per song id.
pub async fn set_default_tags_on_songs(
    db: &DatabaseConnection,
    song_to_tags: HashMap<String, Vec<TagSpecs>>,
) -> Result<HashMap<String, Vec<tags::Model>>, CadenzaError> {
    let song_ids: Vec<&String> = song_to_tags.keys().collect();
    let new_tags: HashMap<&str, &TagSpecs> = song_to_tags
        .values()
        .flatten()
        .map(|tag| (tag.name.as_str(), tag))
        .collect();

    let mut name_to_tag: HashMap<&str, tags::Model> = tags::Entity::find()
        .filter(tags::Column::UserId.is_null())
        .filter(tags::Column::Name.is_in(new_tags.keys().copied()))
        .all(db)
        .await?
        .into_iter()
        .filter_map(|tag| Some((*new_tags.get_key_value(tag.name.as_str())?.0, tag)))
        .collect();

    for (name, new_tag) in new_tags {
        if name_to_tag.contains_key(name) {
            continue;
        }

        let created = tags::ActiveModel {
            tag_id: NotSet,
            user_id: Set(None),
            name: Set(new_tag.name.clone()),
            color: Set(new_tag.color.clone()),
        }
        .insert(db)
        .await?;

        name_to_tag.insert(name, created);
    }

    default_tags_applied::Entity::delete_many()
        .filter(default_tags_applied::Column::SongId.is_in(song_ids))
        .exec(db)
        .await?;

    let res: HashMap<String, Vec<tags::Model>> = song_to_tags
        .iter()
        .map(|(song_id, tags)| {
            let tags = tags
                .iter()
                .filter_map(|tag| name_to_tag.get(tag.name.as_str()).cloned())
                .collect();
            (song_id.clone(), tags)
        })
        .collect();

    let new_relations = res.iter().flat_map(|(song_id, tags)| {
        tags.iter().map(|tag| default_tags_applied::ActiveModel {
            song_id: Set(song_id.clone()),
            tag_id: Set(tag.tag_id),
        })
    });

    default_tags_applied::Entity::insert_many(new_relations)
        .on_conflict(
            OnConflict::columns([
                default_tags_applied::Column::SongId,
                default_tags_applied::Column::TagId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec_without_returning(db)
        .await?;

    Ok(res)
}
