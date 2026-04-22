use sea_orm::ColumnTrait;
use sea_orm::ModelTrait;
use sea_orm::QueryFilter;
use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    DatabaseConnection, EntityTrait,
    prelude::Uuid,
};

use crate::err::CadenzaError;
use crate::db::entity::*;


pub async fn new_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    name: String,
    color: String,
) -> Result<i64, CadenzaError> {
    let new_tag = tags::ActiveModel {
        user_id: Set(user_id),
        tag_id: NotSet,
        name: Set(name),
        color: Set(color),
    };
    let new_tag = new_tag.insert(&db).await?;

    Ok(new_tag.tag_id)
}

pub async fn delete_tag(
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

pub async fn apply_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    song_id: i64,
    tag_id: i64,
) -> Result<(), CadenzaError> {
    let new_tag_relation = applied_tags::ActiveModel {
        user_id: Set(user_id),
        song_id: Set(song_id),
        tag_id: Set(tag_id),
    };

    new_tag_relation.insert(&db).await?;
    Ok(())
}

pub async fn remove_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    song_id: i64,
    tag_id: i64,
) -> Result<(), CadenzaError> {
    let applied_tag = applied_tags::Entity::find()
        .filter(applied_tags::Column::UserId.eq(user_id))
        .filter(applied_tags::Column::SongId.eq(song_id))
        .filter(applied_tags::Column::TagId.eq(tag_id))
        .one(&db)
        .await?;

    if let Some(applied_tag) = applied_tag {
        applied_tag.delete(&db).await?;
    }

    Ok(())
}
