//! Favorite friends and blocked accounts, both one direction: what one user
//! chose about another, never shown to that other person. See
//! `sql/friend_favorites_blocks.sql`.

use std::collections::HashSet;

use sea_orm::{ConnectionTrait, DbBackend, FromQueryResult, Statement, prelude::Uuid};

use crate::db::Db;
use crate::db::social::{FriendPerson, is_friend};
use crate::err::CadenzaError;

/// A `WHERE` clause piece that drops a post when its author `p.user_id` and
/// the viewer `$1` blocked each other either way. For every post read.
pub const NOT_BLOCKED_AUTHOR: &str = "NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id = $1 AND b.blocked_id = p.user_id)
       OR (b.blocker_id = p.user_id AND b.blocked_id = $1)
)";

fn stmt(sql: &str, values: Vec<sea_orm::Value>) -> Statement {
    Statement::from_sql_and_values(DbBackend::Postgres, sql, values)
}

#[derive(FromQueryResult)]
struct UserIdRow {
    user_id: Uuid,
}

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
    db.execute_raw(stmt(
        "INSERT INTO friend_favorites (user_id, friend_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING",
        vec![user_id.into(), friend_id.into()],
    ))
    .await?;
    Ok(())
}

/// Drops a favorite. A missing one is a no-op.
pub async fn unfavorite_friend(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    friend_id: Uuid,
) -> Result<(), CadenzaError> {
    db.execute_raw(stmt(
        "DELETE FROM friend_favorites WHERE user_id = $1 AND friend_id = $2",
        vec![user_id.into(), friend_id.into()],
    ))
    .await?;
    Ok(())
}

/// The friends `user_id` marked a favorite.
pub async fn favorite_ids(
    db: &impl ConnectionTrait,
    user_id: Uuid,
) -> Result<HashSet<Uuid>, CadenzaError> {
    let rows = UserIdRow::find_by_statement(stmt(
        "SELECT friend_id AS user_id FROM friend_favorites WHERE user_id = $1",
        vec![user_id.into()],
    ))
    .all(db)
    .await?;
    Ok(rows.into_iter().map(|row| row.user_id).collect())
}

/// Drops both directions of favorite between the pair. For when a friendship
/// ends, so a refriended person does not come back starred.
pub async fn clear_favorites_between(
    db: &impl ConnectionTrait,
    a: Uuid,
    b: Uuid,
) -> Result<(), CadenzaError> {
    db.execute_raw(stmt(
        "DELETE FROM friend_favorites
         WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
        vec![a.into(), b.into()],
    ))
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
    txn.execute_raw(stmt(
        "INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING",
        vec![blocker_id.into(), blocked_id.into()],
    ))
    .await?;
    txn.execute_raw(stmt(
        "DELETE FROM friendships WHERE user1 = LEAST($1, $2) AND user2 = GREATEST($1, $2)",
        vec![blocker_id.into(), blocked_id.into()],
    ))
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
    db.execute_raw(stmt(
        "DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2",
        vec![blocker_id.into(), blocked_id.into()],
    ))
    .await?;
    Ok(())
}

/// Whether `blocker_id` blocked `other_id`.
pub async fn has_blocked(
    db: &impl ConnectionTrait,
    blocker_id: Uuid,
    other_id: Uuid,
) -> Result<bool, CadenzaError> {
    let row = db
        .query_one_raw(stmt(
            "SELECT EXISTS (
                 SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2
             )",
            vec![blocker_id.into(), other_id.into()],
        ))
        .await?;
    Ok(match row {
        Some(row) => row.try_get_by_index(0)?,
        None => false,
    })
}

/// Whether either of the pair blocked the other.
pub async fn blocked_either_way(
    db: &impl ConnectionTrait,
    a: Uuid,
    b: Uuid,
) -> Result<bool, CadenzaError> {
    let row = db
        .query_one_raw(stmt(
            "SELECT EXISTS (
                 SELECT 1 FROM user_blocks
                 WHERE (blocker_id = $1 AND blocked_id = $2)
                    OR (blocker_id = $2 AND blocked_id = $1)
             )",
            vec![a.into(), b.into()],
        ))
        .await?;
    Ok(match row {
        Some(row) => row.try_get_by_index(0)?,
        None => false,
    })
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
