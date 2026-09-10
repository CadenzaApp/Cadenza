use std::collections::HashMap;

use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    ColumnTrait, DatabaseConnection, DbBackend, EntityTrait, FromQueryResult, JoinType, ModelTrait,
    QueryFilter, QuerySelect, RelationTrait,
    prelude::Uuid,
    sea_query::{Expr, IntoCondition},
};
use serde::Serialize;

use crate::db::entity::sea_orm_active_enums::TagType;
use crate::db::entity::*;
use crate::err::CadenzaError;
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

pub async fn apply_user_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    song_id: String,
    tag_id: i64,
    value: Option<String>,
) -> Result<(), CadenzaError> {
    let tag = get_owned_tag(&db, user_id, tag_id).await?;
    let value = canonicalize_tag_value(&tag.r#type, value)?;

    let new_tag_relation = user_tags_applied::ActiveModel {
        user_id: Set(user_id),
        song_id: Set(song_id),
        tag_id: Set(tag_id),
        value: Set(value),
    };

    new_tag_relation.insert(&db).await?;
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
