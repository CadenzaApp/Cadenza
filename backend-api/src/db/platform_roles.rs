//! Platform roles. Identity-row locks serialize changes even when no role row exists.
use crate::{
    db::{Db, stmt},
    err::CadenzaError,
    routes::json::admin::{PlatformRole, RoleAccess},
};
use sea_orm::{ConnectionTrait, DatabaseConnection, prelude::Uuid};

pub async fn role(db: &impl ConnectionTrait, user: Uuid) -> Result<PlatformRole, CadenzaError> {
    let row = db
        .query_one_raw(stmt(
            "select role from platform_roles where user_id = $1",
            vec![user.into()],
        ))
        .await?;
    match row {
        None => Ok(PlatformRole::User),
        Some(row) => match row.try_get_by_index::<String>(0)?.as_str() {
            "owner" => Ok(PlatformRole::Owner),
            "admin" => Ok(PlatformRole::Admin),
            "moderator" => Ok(PlatformRole::Moderator),
            _ => Err(CadenzaError::Forbidden("Unknown platform role".into())),
        },
    }
}

pub async fn access(
    db: &DatabaseConnection,
    actor: Uuid,
    target: Uuid,
) -> Result<RoleAccess, CadenzaError> {
    let actor_role = role(db, actor).await?;
    if actor != target && !actor_role.dashboard() {
        return Err(CadenzaError::Forbidden(
            "Role management requires an admin".into(),
        ));
    }
    if db
        .query_one_raw(stmt(
            "select id from auth.users where id = $1",
            vec![target.into()],
        ))
        .await?
        .is_none()
    {
        return Err(CadenzaError::NotFound);
    }
    let target_role = role(db, target).await?;
    let allowed_roles = [
        PlatformRole::User,
        PlatformRole::Moderator,
        PlatformRole::Admin,
    ]
    .into_iter()
    .filter(|desired| actor != target && actor_role.can_change(target_role, *desired))
    .collect();
    Ok(RoleAccess {
        role: target_role,
        dashboard: target_role.dashboard(),
        allowed_roles,
    })
}

pub async fn change(
    db: &impl Db,
    actor: Uuid,
    target: Uuid,
    expected: PlatformRole,
    desired: PlatformRole,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;
    // All role mutations take these locks in UUID order, including absent-role users.
    let identities = txn
        .query_all_raw(stmt(
            "select id from auth.users where id in ($1, $2) order by id for update",
            vec![actor.into(), target.into()],
        ))
        .await?;
    if identities.len() != 2 || actor == target {
        return Err(CadenzaError::Forbidden(
            "Cannot change this account's role".into(),
        ));
    }
    let actor_role = role(&txn, actor).await?;
    let current = role(&txn, target).await?;
    if !actor_role.can_change(current, desired) {
        return Err(CadenzaError::Forbidden("Role change is not allowed".into()));
    }
    if current != expected {
        return Err(CadenzaError::PlatformRoleConflict);
    }
    if current != desired {
        if desired == PlatformRole::User {
            txn.execute_raw(stmt(
                "delete from platform_roles where user_id = $1",
                vec![target.into()],
            ))
            .await?;
        } else {
            txn.execute_raw(stmt("insert into platform_roles(user_id, role, assigned_by) values ($1, $2, $3) on conflict(user_id) do update set role = excluded.role, assigned_by = excluded.assigned_by, assigned_at = now()", vec![target.into(), desired.name().into(), actor.into()])).await?;
        }
        txn.execute_raw(stmt("insert into platform_role_changes(actor_id, target_id, previous_role, new_role) values ($1, $2, $3, $4)", vec![actor.into(), target.into(), current.name().into(), desired.name().into()])).await?;
    }
    txn.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{Database, TransactionTrait};

    /// Identity rows are only read/locked. Role and audit writes go to temporary
    /// tables inside the rolled-back transaction, never to application tables.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL and two registered users"]
    async fn platform_role_changes_are_authorized_and_audited() {
        dotenvy::dotenv().ok();
        let db = Database::connect(std::env::var("DATABASE_URL").unwrap())
            .await
            .unwrap();
        let tx = db.begin().await.unwrap();
        let users = tx
            .query_all_raw(stmt(
                "select id from auth.users order by id limit 2",
                vec![],
            ))
            .await
            .unwrap();
        assert_eq!(
            users.len(),
            2,
            "test needs two registered identities; does not create accounts"
        );
        let owner: Uuid = users[0].try_get_by_index(0).unwrap();
        let target: Uuid = users[1].try_get_by_index(0).unwrap();
        tx.execute_raw(stmt("create temp table platform_roles(user_id uuid primary key,role text,assigned_by uuid,assigned_at timestamptz default now()) on commit drop",vec![])).await.unwrap();
        tx.execute_raw(stmt("create temp table platform_role_changes(actor_id uuid,target_id uuid,previous_role text,new_role text) on commit drop",vec![])).await.unwrap();
        tx.execute_raw(stmt(
            "insert into platform_roles(user_id,role) values ($1,'owner')",
            vec![owner.into()],
        ))
        .await
        .unwrap();
        use PlatformRole::*;
        change(&tx, owner, target, User, Admin).await.unwrap();
        assert_eq!(role(&tx, target).await.unwrap(), Admin);
        assert!(matches!(
            change(&tx, target, owner, Owner, User).await,
            Err(CadenzaError::Forbidden(_))
        ));
        assert!(matches!(
            change(&tx, owner, target, User, Moderator).await,
            Err(CadenzaError::PlatformRoleConflict)
        ));
        assert!(matches!(
            change(&tx, target, target, Admin, User).await,
            Err(CadenzaError::Forbidden(_))
        ));
        change(&tx, owner, target, Admin, Moderator).await.unwrap();
        change(&tx, owner, target, Moderator, User).await.unwrap();
        assert_eq!(role(&tx, target).await.unwrap(), User);
        let audit = tx
            .query_all_raw(stmt(
                "select previous_role,new_role from platform_role_changes",
                vec![],
            ))
            .await
            .unwrap();
        assert_eq!(
            audit.len(),
            3,
            "denied requests must never mutate roles or write audits"
        );
        tx.rollback().await.unwrap();
    }
}
