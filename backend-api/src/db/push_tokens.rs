//! Expo push tokens, one row per phone install, over the generated
//! `push_tokens` entity. See `sql/push_tokens.sql`.
//!
//! [`upsert_push_token`] and [`delete_user_push_token`] are the phone signing
//! in and out. [`users_push_tokens`] is what a push reads.
//! [`delete_push_tokens`] drops tokens Expo says are dead.

use chrono::Utc;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QuerySelect,
    prelude::Uuid, sea_query::OnConflict,
};

use crate::db::entity::push_tokens::{ActiveModel, Column, Entity};
use crate::err::CadenzaError;

/// Stores `token` for `user_id`. A token another user registered moves to
/// `user_id`, since one phone install is signed in as one user at a time.
/// Registering the same token again only bumps `updated_at`.
pub async fn upsert_push_token(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    token: &str,
) -> Result<(), CadenzaError> {
    let now = Utc::now().fixed_offset();
    Entity::insert(ActiveModel {
        token: Set(token.to_owned()),
        user_id: Set(user_id),
        created_at: Set(now),
        updated_at: Set(now),
    })
    .on_conflict(
        OnConflict::column(Column::Token)
            .update_columns([Column::UserId, Column::UpdatedAt])
            .to_owned(),
    )
    .exec_without_returning(db)
    .await?;
    Ok(())
}

/// Deletes `token` when it belongs to `user_id`. A token that is missing or
/// belongs to someone else is left alone, and is not an error.
pub async fn delete_user_push_token(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    token: &str,
) -> Result<(), CadenzaError> {
    Entity::delete_many()
        .filter(Column::Token.eq(token))
        .filter(Column::UserId.eq(user_id))
        .exec(db)
        .await?;
    Ok(())
}

/// Every token any of `user_ids` registered, in no order.
pub async fn users_push_tokens(
    db: &impl ConnectionTrait,
    user_ids: &[Uuid],
) -> Result<Vec<String>, CadenzaError> {
    if user_ids.is_empty() {
        return Ok(Vec::new());
    }
    Ok(Entity::find()
        .select_only()
        .column(Column::Token)
        .filter(Column::UserId.is_in(user_ids.iter().copied()))
        .into_tuple::<String>()
        .all(db)
        .await?)
}

/// Deletes these tokens whoever owns them. Returns how many rows went.
pub async fn delete_push_tokens(
    db: &impl ConnectionTrait,
    tokens: &[String],
) -> Result<u64, CadenzaError> {
    if tokens.is_empty() {
        return Ok(0);
    }
    let result = Entity::delete_many()
        .filter(Column::Token.is_in(tokens.iter().cloned()))
        .exec(db)
        .await?;
    Ok(result.rows_affected)
}
