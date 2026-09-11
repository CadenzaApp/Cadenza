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

use crate::db::entity::*;
use crate::err::CadenzaError;

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

pub async fn get_user_tags_on_song(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_id: &str,
) -> Result<Vec<tags::Model>, CadenzaError> {
    Ok(tags::Entity::find()
        .inner_join(user_tags_applied::Entity)
        .filter(user_tags_applied::Column::SongId.eq(song_id))
        .filter(user_tags_applied::Column::UserId.eq(user_id))
        .all(db)
        .await?)
}

/// Same as `get_user_tags_on_song`, for many songs at once. Every requested
/// song gets an entry, so songs with no tags come back as an empty list.
pub async fn get_user_tags_on_songs(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<HashMap<String, Vec<tags::Model>>, CadenzaError> {
    let mut tags_by_song: HashMap<String, Vec<tags::Model>> = song_ids
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
        tags_by_song
            .entry(applied_tag.song_id)
            .or_default()
            .push(tag);
    }

    Ok(tags_by_song)
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
