use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    DatabaseConnection, DbErr,
};

use super::entity::*;



pub async fn apply_tag(
    db: DatabaseConnection,
    song_id: usize,
    tag_name: &str,
) -> Result<(), DbErr> {

    let new_tag = tags::ActiveModel {
        tag_id: NotSet,
        name: Set(tag_name.to_string()),
    };

    new_tag.insert(&db).await?;

    Ok(())
}
