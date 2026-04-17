use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, DatabaseConnection, DbErr, EntityTrait, QueryFilter,
};
use sea_orm::{ColumnTrait, ModelTrait, prelude::Uuid};

use crate::err::CadenzaError;

use super::entity::*;

pub async fn add_song_to_library(
    db: DatabaseConnection,
    user_id: Uuid,
    song_id: usize,
) -> Result<(), CadenzaError> {
    let new_song = songs::ActiveModel {
        song_id: Set(song_id as i64),
        user_id: Set(user_id),
    };

    new_song.insert(&db).await?;

    Ok(())
}

pub async fn remove_song_from_library(
    db: DatabaseConnection,
    user_id: Uuid,
    song_id: usize,
) -> Result<(), CadenzaError> {
    let song = songs::Entity::find()
        .filter(songs::Column::SongId.eq(song_id as i64))
        .filter(songs::Column::UserId.eq(user_id))
        .one(&db)
        .await?;

    if let Some(song) = song {
        song.delete(&db).await?;
    }

    Ok(())
}
