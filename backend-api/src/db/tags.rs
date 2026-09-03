use std::collections::HashMap;

use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    ColumnTrait, Condition, DatabaseConnection, EntityTrait, FromQueryResult, ModelTrait,
    QueryFilter, QuerySelect,
    prelude::Uuid,
};

use crate::db::entity::*;
use crate::err::CadenzaError;

pub fn is_global_tag(tag: &tags::Model) -> bool {
    tag.user_id.is_none()
}

pub async fn get_all_local_tags(
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
    Ok(tags::Entity::find()
        .filter(tags::Column::TagId.eq(tag_id))
        .one(db)
        .await?)
}

#[derive(FromQueryResult)]
struct LocalTagUsageCount {
    id: i64,
    count: u64,
}

pub async fn get_local_tag_usage_counts(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> Result<HashMap<i64, usize>, CadenzaError> {
    let tag_usage_counts = tags_applied::Entity::find()
        .select_only()
        .column(tags_applied::Column::TagId)
        .column_as(tags_applied::Column::TagId.count(), "count")
        .filter(tags_applied::Column::UserId.eq(user_id))
        .group_by(tags_applied::Column::TagId)
        .into_model::<LocalTagUsageCount>()
        .all(db)
        .await?;

    let mut res = HashMap::new();
    for LocalTagUsageCount { id, count } in tag_usage_counts {
        res.insert(id, count as usize);
    }

    Ok(res)
}

pub async fn get_tags_on_song(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_id: &str,
) -> Result<Vec<tags::Model>, CadenzaError> {
    Ok(tags::Entity::find()
        .inner_join(tags_applied::Entity)
        .filter(tags_applied::Column::SongId.eq(song_id))
        .filter(
            Condition::any()
                .add(tags_applied::Column::UserId.eq(user_id))
                .add(tags_applied::Column::UserId.is_null()),
        )
        .all(db)
        .await?)
}

pub async fn get_tags_on_songs(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_ids: &[String],
) -> Result<HashMap<String, Vec<tags::Model>>, CadenzaError> {
    if song_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = tags_applied::Entity::find()
        .filter(tags_applied::Column::SongId.is_in(song_ids.iter().cloned()))
        .filter(
            Condition::any()
                .add(tags_applied::Column::UserId.eq(user_id))
                .add(tags_applied::Column::UserId.is_null()),
        )
        .find_also_related(tags::Entity)
        .all(db)
        .await?;

    let mut result: HashMap<String, Vec<tags::Model>> = HashMap::new();
    for (application, tag) in rows {
        if let Some(tag) = tag {
            result.entry(application.song_id).or_default().push(tag);
        }
    }
    Ok(result)
}

pub async fn get_songs_with_tag(
    db: &DatabaseConnection,
    user_id: Uuid,
    tag_id: i64,
) -> Result<Vec<String>, CadenzaError> {
    let song_ids: Vec<String> = tags_applied::Entity::find()
        .filter(tags_applied::Column::TagId.eq(tag_id))
        .filter(
            Condition::any()
                .add(tags_applied::Column::UserId.eq(user_id))
                .add(tags_applied::Column::UserId.is_null()),
        )
        .select_only()
        .column(tags_applied::Column::SongId)
        .into_tuple()
        .all(db)
        .await?;

    Ok(song_ids)
}

pub async fn new_local_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    name: String,
    color: String,
) -> Result<i64, CadenzaError> {
    let new_tag = tags::ActiveModel {
        user_id: Set(Some(user_id)),
        tag_id: NotSet,
        name: Set(name),
        color: Set(color),
    };
    let new_tag = new_tag.insert(&db).await?;

    Ok(new_tag.tag_id)
}

pub async fn delete_local_tag(
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

pub async fn apply_local_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    song_id: String,
    tag_id: i64,
) -> Result<(), CadenzaError> {
    let new_tag_relation = tags_applied::ActiveModel {
        user_id: Set(user_id),
        song_id: Set(song_id),
        tag_id: Set(tag_id),
    };

    new_tag_relation.insert(&db).await?;
    Ok(())
}

pub async fn unapply_local_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    song_id: String,
    tag_id: i64,
) -> Result<(), CadenzaError> {
    let applied_tag = tags_applied::Entity::find()
        .filter(tags_applied::Column::SongId.eq(song_id))
        .filter(tags_applied::Column::UserId.eq(user_id))
        .filter(tags_applied::Column::TagId.eq(tag_id))
        .one(&db)
        .await?;

    if let Some(applied_tag) = applied_tag {
        applied_tag.delete(&db).await?;
    }

    Ok(())
}
