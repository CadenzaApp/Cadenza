//! Favorite friends and blocked accounts, both one direction: what one user
//! chose about another, never shown to that other person. See
//! `sql/friend_favorites_blocks.sql`.

use std::collections::HashSet;

use sea_orm::{
    ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait, FromQueryResult,
    PaginatorTrait, QueryFilter, QuerySelect, prelude::Uuid, sea_query::OnConflict,
};

use crate::db::entity::{friend_favorites, friendships, user_blocks};
use crate::db::social::{FriendPerson, is_friend};
use crate::db::{Db, stmt};
use crate::err::CadenzaError;

/// A `WHERE` clause piece that drops a post when its author `p.user_id` and
/// the viewer `$1` blocked each other either way. For every post read.
pub const NOT_BLOCKED_AUTHOR: &str = "NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id = $1 AND b.blocked_id = p.user_id)
       OR (b.blocker_id = p.user_id AND b.blocked_id = $1)
)";

#[derive(FromQueryResult)]
struct PersonRow {
    user_id: Uuid,
    username: String,
}

/// Marks `friend_id` a favorite. Friends only; marking one twice is a no-op.
pub async fn favorite_friend(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    friend_id: Uuid,
) -> Result<(), CadenzaError> {
    if !is_friend(db, user_id, friend_id).await? {
        return Err(CadenzaError::NotFound);
    }
    friend_favorites::Entity::insert(friend_favorites::ActiveModel {
        user_id: Set(user_id),
        friend_id: Set(friend_id),
        ..Default::default()
    })
    .on_conflict(
        OnConflict::columns([
            friend_favorites::Column::UserId,
            friend_favorites::Column::FriendId,
        ])
        .do_nothing()
        .to_owned(),
    )
    .exec_without_returning(db)
    .await?;
    Ok(())
}

/// Drops a favorite. A missing one is a no-op.
pub async fn unfavorite_friend(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    friend_id: Uuid,
) -> Result<(), CadenzaError> {
    friend_favorites::Entity::delete_by_id((user_id, friend_id))
        .exec(db)
        .await?;
    Ok(())
}

/// The friends `user_id` marked a favorite.
pub async fn favorite_ids(
    db: &impl ConnectionTrait,
    user_id: Uuid,
) -> Result<HashSet<Uuid>, CadenzaError> {
    let ids: Vec<Uuid> = friend_favorites::Entity::find()
        .select_only()
        .column(friend_favorites::Column::FriendId)
        .filter(friend_favorites::Column::UserId.eq(user_id))
        .into_tuple()
        .all(db)
        .await?;
    Ok(ids.into_iter().collect())
}

/// Drops both directions of favorite between the pair. For when a friendship
/// ends, so a refriended person does not come back starred.
pub async fn clear_favorites_between(
    db: &impl ConnectionTrait,
    a: Uuid,
    b: Uuid,
) -> Result<(), CadenzaError> {
    friend_favorites::Entity::delete_many()
        .filter(
            Condition::any()
                .add(favorite_from(a, b))
                .add(favorite_from(b, a)),
        )
        .exec(db)
        .await?;
    Ok(())
}

/// Blocks `blocked_id`: ends any friendship or request between the pair and
/// both favorites, in one transaction. Blocking twice is a no-op.
pub async fn block_user(
    db: &impl Db,
    blocker_id: Uuid,
    blocked_id: Uuid,
) -> Result<(), CadenzaError> {
    if blocker_id == blocked_id {
        return Err(CadenzaError::InvalidRequestBody(
            "you cannot block yourself".into(),
        ));
    }
    let txn = db.begin().await?;
    user_blocks::Entity::insert(user_blocks::ActiveModel {
        blocker_id: Set(blocker_id),
        blocked_id: Set(blocked_id),
        ..Default::default()
    })
    .on_conflict(
        OnConflict::columns([
            user_blocks::Column::BlockerId,
            user_blocks::Column::BlockedId,
        ])
        .do_nothing()
        .to_owned(),
    )
    .exec_without_returning(&txn)
    .await?;
    // a friendship row keeps the smaller id in user1
    friendships::Entity::delete_by_id((blocker_id.min(blocked_id), blocker_id.max(blocked_id)))
        .exec(&txn)
        .await?;
    clear_favorites_between(&txn, blocker_id, blocked_id).await?;
    txn.commit().await?;
    Ok(())
}

/// Lifts a block. It does not bring back the friendship it ended.
pub async fn unblock_user(
    db: &impl ConnectionTrait,
    blocker_id: Uuid,
    blocked_id: Uuid,
) -> Result<(), CadenzaError> {
    user_blocks::Entity::delete_by_id((blocker_id, blocked_id))
        .exec(db)
        .await?;
    Ok(())
}

/// Whether `blocker_id` blocked `other_id`.
pub async fn has_blocked(
    db: &impl ConnectionTrait,
    blocker_id: Uuid,
    other_id: Uuid,
) -> Result<bool, CadenzaError> {
    Ok(user_blocks::Entity::find_by_id((blocker_id, other_id))
        .one(db)
        .await?
        .is_some())
}

/// Whether either of the pair blocked the other.
pub async fn blocked_either_way(
    db: &impl ConnectionTrait,
    a: Uuid,
    b: Uuid,
) -> Result<bool, CadenzaError> {
    let blocks = user_blocks::Entity::find()
        .filter(Condition::any().add(block_from(a, b)).add(block_from(b, a)))
        .count(db)
        .await?;
    Ok(blocks > 0)
}

/// The accounts `user_id` blocked, username order.
pub async fn blocked_people(
    db: &impl ConnectionTrait,
    user_id: Uuid,
) -> Result<Vec<FriendPerson>, CadenzaError> {
    let rows = PersonRow::find_by_statement(stmt(
        "SELECT b.blocked_id AS user_id, COALESCE(p.username, 'unknown') AS username
         FROM user_blocks b
         LEFT JOIN profile p ON p.uid = b.blocked_id
         WHERE b.blocker_id = $1
         ORDER BY username, user_id",
        vec![user_id.into()],
    ))
    .all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| FriendPerson {
            user_id: row.user_id,
            username: row.username,
        })
        .collect())
}

fn favorite_from(user_id: Uuid, friend_id: Uuid) -> Condition {
    Condition::all()
        .add(friend_favorites::Column::UserId.eq(user_id))
        .add(friend_favorites::Column::FriendId.eq(friend_id))
}

fn block_from(blocker_id: Uuid, blocked_id: Uuid) -> Condition {
    Condition::all()
        .add(user_blocks::Column::BlockerId.eq(blocker_id))
        .add(user_blocks::Column::BlockedId.eq(blocked_id))
}
