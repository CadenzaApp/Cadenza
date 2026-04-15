use sea_orm::ColumnTrait;
use sea_orm::ModelTrait;
use sea_orm::QueryFilter;
use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    DatabaseConnection, DbErr, EntityTrait,
    prelude::Uuid,
};

use super::entity::*;

/// ensures tag with the given name exists, then applies it for that song for that user
pub async fn apply_tag(
    db: DatabaseConnection,
    user_id: Uuid,
    song_id: i64,
    tag_name: &str,
) -> Result<(), DbErr> {
    // get the tag that matches this tag_name...
    let existing_tag = tags::Entity::find()
        .filter(tags::Column::Name.eq(tag_name))
        .one(&db)
        .await?;

    // ...or insert a new one if it doesnt exist
    let tag_id = match existing_tag {
        Some(existing_tag) => existing_tag.tag_id,
        None => {
            let new_tag = tags::ActiveModel {
                tag_id: NotSet,
                name: Set(tag_name.to_string()),
            };
            let new_tag = new_tag.insert(&db).await?;
            new_tag.tag_id
        }
    };

    // apply this tag to this song under this user
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
) -> Result<(), DbErr> {
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

