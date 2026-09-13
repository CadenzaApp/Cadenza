use std::collections::{HashMap, HashSet};

use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    ColumnTrait, DatabaseConnection, EntityTrait, FromQueryResult, JoinType, ModelTrait,
    QueryFilter, QuerySelect,
    prelude::Uuid,
    sea_query::OnConflict,
};
use serde::Serialize;

use crate::db::entity::*;
use crate::err::CadenzaError;
use crate::services::tag_generation::GeneratedTag;

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
/// gets its default tags instead. Every requested song gets an entry, so a song
/// with no tags of either kind comes back as an empty list.
pub async fn get_user_tags_on_songs(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<HashMap<String, Vec<tags::Model>>, CadenzaError> {
    // start every requested song off with no tags
    let mut tags_by_song: HashMap<String, Vec<tags::Model>> = song_ids
        .iter()
        .map(|song_id| (song_id.clone(), Vec::new()))
        .collect();

    // no songs requested, so nothing to look up
    if tags_by_song.is_empty() {
        return Ok(tags_by_song);
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
        tags_by_song
            .entry(applied_tag.song_id)
            .or_default()
            .push(tag);
    }

    // songs the user hasn't tagged fall back to their default tags, if they have any
    let songs_without_user_tags: Vec<String> = tags_by_song
        .iter()
        .filter(|(_, tags)| tags.is_empty())
        .map(|(song_id, _)| song_id.clone())
        .collect();

    if !songs_without_user_tags.is_empty() {
        tags_by_song.extend(get_default_tags_on_songs(db, &songs_without_user_tags).await?);
    }

    Ok(tags_by_song)
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
    tags_per_song: HashMap<String, Vec<GeneratedTag>>,
) -> Result<HashMap<String, Vec<tags::Model>>, CadenzaError> {
    let song_ids: Vec<&String> = tags_per_song.keys().collect();
    let new_tags: HashMap<&str, &GeneratedTag> = tags_per_song
        .values()
        .flatten()
        .map(|tag| (tag.name.as_str(), tag))
        .collect();

    let mut tags_by_name: HashMap<&str, tags::Model> = tags::Entity::find()
        .filter(tags::Column::UserId.is_null())
        .filter(tags::Column::Name.is_in(new_tags.keys().copied()))
        .all(db)
        .await?
        .into_iter()
        .filter_map(|tag| Some((*new_tags.get_key_value(tag.name.as_str())?.0, tag)))
        .collect();

    for (name, new_tag) in new_tags {
        if tags_by_name.contains_key(name) {
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

        tags_by_name.insert(name, created);
    }

    default_tags_applied::Entity::delete_many()
        .filter(default_tags_applied::Column::SongId.is_in(song_ids))
        .exec(db)
        .await?;

    let res: HashMap<String, Vec<tags::Model>> = tags_per_song
        .iter()
        .map(|(song_id, tags)| {
            let tags = tags
                .iter()
                .filter_map(|tag| tags_by_name.get(tag.name.as_str()).cloned())
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
        .on_empty_do_nothing()
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
