use sea_orm::{
    ActiveValue::Set,
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QuerySelect, Select,
    prelude::Uuid,
    sea_query::{LockBehavior, LockType, OnConflict},
};

use crate::db::entity::tag_scores_metadata;
use crate::err::CadenzaError;

/// Records `week` as the user's last decay week, but only when the user has no
/// row yet. Returns whether it wrote one.
///
/// Two servers racing to record the same new user cannot both win: the second
/// insert waits on the first at the primary key, then does nothing.
pub async fn insert_decay_week_if_missing(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    week: i32,
) -> Result<bool, CadenzaError> {
    let row = tag_scores_metadata::ActiveModel {
        user_id: Set(user_id),
        last_decay_week: Set(week),
    };

    let inserted = tag_scores_metadata::Entity::insert(row)
        .on_conflict(
            OnConflict::column(tag_scores_metadata::Column::UserId)
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(db)
        .await?;

    Ok(inserted == 1)
}

/// The user's last decay week, with the row locked for the rest of the caller's
/// transaction.
///
/// `None` when the user has no row, or when another transaction already holds
/// the lock. It skips a locked row rather than waiting on it, so two servers
/// walking the same users split them instead of queueing behind each other.
pub async fn lock_decay_week(
    db: &impl ConnectionTrait,
    user_id: Uuid,
) -> Result<Option<i32>, CadenzaError> {
    let row = lock_decay_week_select(user_id).one(db).await?;
    Ok(row.map(|row| row.last_decay_week))
}

/// Returns the select behind [`lock_decay_week`].
fn lock_decay_week_select(user_id: Uuid) -> Select<tag_scores_metadata::Entity> {
    tag_scores_metadata::Entity::find()
        .filter(tag_scores_metadata::Column::UserId.eq(user_id))
        .lock_with_behavior(LockType::Update, LockBehavior::SkipLocked)
}

/// Moves the user's last decay week on to `week`.
pub async fn set_decay_week(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    week: i32,
) -> Result<(), CadenzaError> {
    tag_scores_metadata::Entity::update_many()
        .col_expr(tag_scores_metadata::Column::LastDecayWeek, week.into())
        .filter(tag_scores_metadata::Column::UserId.eq(user_id))
        .exec(db)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{DbBackend, QueryTrait};

    use super::*;

    #[test]
    fn lock_decay_week_select_skips_a_row_another_transaction_holds() {
        let sql = lock_decay_week_select(Uuid::nil())
            .build(DbBackend::Postgres)
            .to_string();

        assert_eq!(
            sql,
            r#"SELECT "tag_scores_metadata"."user_id", "tag_scores_metadata"."last_decay_week" FROM "tag_scores_metadata" WHERE "tag_scores_metadata"."user_id" = '00000000-0000-0000-0000-000000000000' FOR UPDATE SKIP LOCKED"#
        );
    }
}
