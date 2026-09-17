use std::collections::{HashMap, HashSet};

use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, FromQueryResult, JoinType,
    ModelTrait, QueryFilter, QueryOrder, QuerySelect, TransactionTrait,
    prelude::Uuid,
    sea_query::OnConflict,
};
use serde::Serialize;

use crate::db::entity::sea_orm_active_enums::TagType;
use crate::db::entity::*;
use crate::db::tag_votes::{TagVote, TagVoteCache, record_tag_vote};
use crate::err::CadenzaError;
use crate::services::tag_generation::TagSpecs;
use crate::services::tag_values::canonicalize_tag_value;

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

/// Fetches a tag belonging to the given user. Applying a tag needs its type in
/// order to validate the value, so this doubles as the ownership check.
async fn get_owned_tag(
    db: &DatabaseConnection,
    user_id: Uuid,
    tag_id: i64,
) -> Result<tags::Model, CadenzaError> {
    tags::Entity::find_by_id(tag_id)
        .filter(tags::Column::UserId.eq(user_id))
        .one(db)
        .await?
        .ok_or(CadenzaError::NotFound)
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

/// Returns each tag on the song paired with the value it was applied with.
/// The value is always `None` for basic tags.
pub async fn get_user_tags_on_song(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_id: &str,
) -> Result<Vec<(tags::Model, Option<String>)>, CadenzaError> {
    let tags_with_applications = tags::Entity::find()
        .find_also_related(user_tags_applied::Entity)
        .filter(user_tags_applied::Column::SongId.eq(song_id))
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .all(db)
        .await?;

    Ok(tags_with_applications
        .into_iter()
        .map(|(tag, applied)| (tag, applied.and_then(|applied| applied.value)))
        .collect())
}

/// Same as `get_user_tags_on_song`, for many songs at once, so each tag comes
/// back paired with the value it was applied with. Every requested song gets an
/// entry, so songs with no tags come back as an empty list.
pub async fn get_user_tags_on_songs(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<HashMap<String, Vec<(tags::Model, Option<String>)>>, CadenzaError> {
    let mut tags_by_song: HashMap<String, Vec<(tags::Model, Option<String>)>> = song_ids
        .iter()
        .map(|song_id| (song_id.clone(), Vec::new()))
        .collect();

    if tags_by_song.is_empty() {
        return Ok(tags_by_song);
    }

    let applied = user_tags_applied::Entity::find()
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .filter(user_tags_applied::Column::SongId.is_in(song_ids.iter().map(String::as_str)))
        .find_also_related(tags::Entity)
        .all(db)
        .await?;

    for (applied_tag, tag) in applied {
        let Some(tag) = tag else { continue };
        let user_tags_applied::Model { song_id, value, .. } = applied_tag;
        tags_by_song.entry(song_id).or_default().push((tag, value));
    }

    Ok(tags_by_song)
}

/// Returns the requested songs that do not have default tags, preserving input
/// order.
pub async fn get_songs_without_default_tags(
    db: &DatabaseConnection,
    song_ids: &[String],
) -> Result<Vec<String>, CadenzaError> {
    if song_ids.is_empty() {
        return Ok(Vec::new());
    }

    let with_default_tags: HashSet<String> = default_tags_applied::Entity::find()
        .filter(default_tags_applied::Column::SongId.is_in(song_ids.iter().map(String::as_str)))
        .select_only()
        .column(default_tags_applied::Column::SongId)
        .distinct()
        .into_tuple::<String>()
        .all(db)
        .await?
        .into_iter()
        .collect();

    Ok(song_ids
        .iter()
        .filter(|song_id| !with_default_tags.contains(*song_id))
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
    tag_type: TagType,
) -> Result<i64, CadenzaError> {
    let new_tag = tags::ActiveModel {
        tag_id: NotSet,
        user_id: Set(Some(user_id)),
        name: Set(name),
        color: Set(color),
        r#type: Set(tag_type),
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

/// Puts one of the user's tags on a song and votes yes on its name, which can
/// make the name a default tag there (see [`record_tag_vote`]).
pub async fn apply_user_tag(
    db: DatabaseConnection,
    votes: &TagVoteCache,
    user_id: Uuid,
    song_id: String,
    tag_id: i64,
    value: Option<String>,
) -> Result<(), CadenzaError> {
    let tag = get_owned_tag(&db, user_id, tag_id).await?;
    let value = canonicalize_tag_value(&tag.r#type, value)?;
    let txn = db.begin().await?;

    let new_tag_relation = user_tags_applied::ActiveModel {
        user_id: Set(user_id),
        song_id: Set(song_id.clone()),
        tag_id: Set(tag_id),
        value: Set(value),
    };
    new_tag_relation.insert(&txn).await?;

    // the user put this tag on the song, so its name gets a yes vote
    let recorded = record_tag_vote(&txn, votes, user_id, &song_id, &tag, TagVote::Yes).await?;

    txn.commit().await?;

    // update the vote cache only once the vote is committed
    votes.remember(recorded);
    Ok(())
}

/// Sets (or, with `None`, clears) the value of a tag already applied to a song.
pub async fn set_user_tag_value(
    db: DatabaseConnection,
    user_id: Uuid,
    song_id: String,
    tag_id: i64,
    value: Option<String>,
) -> Result<(), CadenzaError> {
    let tag = get_owned_tag(&db, user_id, tag_id).await?;
    let value = canonicalize_tag_value(&tag.r#type, value)?;

    let applied_tag = user_tags_applied::Entity::find()
        .filter(user_tags_applied::Column::SongId.eq(song_id))
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .filter(user_tags_applied::Column::TagId.eq(tag_id))
        .one(&db)
        .await?
        .ok_or(CadenzaError::NotFound)?;

    let mut applied_tag: user_tags_applied::ActiveModel = applied_tag.into();
    applied_tag.value = Set(value);
    applied_tag.update(&db).await?;

    Ok(())
}

/// Takes one of the user's tags off a song, and votes no on the tag's name for
/// the song (see [`record_tag_vote`]). No-ops if the tag isn't on the song.
pub async fn unapply_user_tag(
    db: DatabaseConnection,
    votes: &TagVoteCache,
    user_id: Uuid,
    song_id: String,
    tag_id: i64,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;

    // the tag on the song, along with the tag itself for its name
    let applied = user_tags_applied::Entity::find()
        .filter(user_tags_applied::Column::SongId.eq(song_id.as_str()))
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .filter(user_tags_applied::Column::TagId.eq(tag_id))
        .find_also_related(tags::Entity)
        .one(&txn)
        .await?;

    // the vote this request cast, if it is the one that removed the tag
    let mut recorded = None;
    if let Some((applied_tag, tag)) = applied {
        // a racing request may have removed it first, so only vote if this delete did
        let deleted = applied_tag.delete(&txn).await?;
        if let (1.., Some(tag)) = (deleted.rows_affected, tag) {
            recorded =
                Some(record_tag_vote(&txn, votes, user_id, &song_id, &tag, TagVote::No).await?);
        }
    }

    txn.commit().await?;

    // update the vote cache only once the vote is committed
    if let Some(recorded) = recorded {
        votes.remember(recorded);
    }
    Ok(())
}

/// Puts the default tag with the given name on the song, creating that default
/// tag with the given color if there isn't one. Only touches default tags, so
/// it is not copied to users. Songs that already have it are left alone.
pub async fn add_default_tag_to_song(
    db: &impl ConnectionTrait,
    song_id: &str,
    name: &str,
    color: &str,
) -> Result<(), CadenzaError> {
    // reuse the default tag with this name, the oldest if there are several
    let existing = tags::Entity::find()
        .filter(tags::Column::UserId.is_null())
        .filter(tags::Column::Name.eq(name))
        .order_by_asc(tags::Column::TagId)
        .one(db)
        .await?;

    // or create it
    let tag_id = match existing {
        Some(tag) => tag.tag_id,
        None => {
            let created = tags::ActiveModel {
                tag_id: NotSet,
                user_id: Set(None),
                name: Set(name.to_owned()),
                color: Set(color.to_owned()),
                r#type: NotSet,
            }
            .insert(db)
            .await?;
            created.tag_id
        }
    };

    default_tags_applied::Entity::insert(default_tags_applied::ActiveModel {
        song_id: Set(song_id.to_owned()),
        tag_id: Set(tag_id),
    })
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

    Ok(())
}

/// Returns the default tags on each given song, keyed by song id. Songs with no
/// default tags are left out.
pub async fn get_default_tags_on_songs(
    db: &impl ConnectionTrait,
    song_ids: &[String],
) -> Result<HashMap<String, Vec<tags::Model>>, CadenzaError> {
    // no songs, so nothing to look up
    if song_ids.is_empty() {
        return Ok(HashMap::new());
    }

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
            r#type: NotSet,
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
