//! Invite codes in `invite_codes`. Target agnostic: redeeming checks and counts
//! a code and says what it points at. Joining is the shared playlist or live
//! session code's job, so this never needs to know about either.

use chrono::{Duration, Utc};
use sea_orm::{
    ActiveEnum, ActiveValue::Set, ConnectionTrait, DbErr, EntityTrait, RuntimeErr, prelude::Uuid,
};

use crate::db::entity::{
    invite_codes,
    sea_orm_active_enums::{InviteTarget, PlaylistRole},
};
use crate::db::{Db, stmt};
use crate::err::CadenzaError;
use crate::services::invite_codes::generate_code;

/// Tries before giving up on finding an unused code. Collisions are
/// astronomically rare at 31^8; this only stops an endless loop.
const MAX_CODE_ATTEMPTS: usize = 5;

/// What a code points at.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InviteTargetRef {
    SharedPlaylist(i64),
    LiveSession(Uuid),
}

impl InviteTargetRef {
    fn kind(&self) -> InviteTarget {
        match self {
            Self::SharedPlaylist(_) => InviteTarget::SharedPlaylist,
            Self::LiveSession(_) => InviteTarget::LiveSession,
        }
    }

    fn id_text(&self) -> String {
        match self {
            Self::SharedPlaylist(id) => id.to_string(),
            Self::LiveSession(id) => id.to_string(),
        }
    }

    fn from_row(kind: &InviteTarget, id: &str) -> Result<Self, CadenzaError> {
        let bad = || CadenzaError::DatabaseError(format!("invite code target '{id}' is not valid"));
        match kind {
            InviteTarget::SharedPlaylist => id.parse().map(Self::SharedPlaylist).map_err(|_| bad()),
            InviteTarget::LiveSession => id.parse().map(Self::LiveSession).map_err(|_| bad()),
        }
    }
}

/// A redeemed code: what it points at, and for a playlist, the role it grants.
#[derive(Clone, Debug)]
pub struct Redeemed {
    pub target: InviteTargetRef,
    pub grants_role: Option<PlaylistRole>,
}

/// Options for a new code.
#[derive(Clone, Debug, Default)]
pub struct NewInvite {
    /// Viewer (the default) or editor for a playlist. Ignored for a session.
    pub grants_role: Option<PlaylistRole>,
    pub expires_in: Option<Duration>,
    pub max_uses: Option<i32>,
}

/// Makes a code for `target`. The caller has already checked the user may.
pub async fn create_invite<C: ConnectionTrait>(
    db: &C,
    created_by: Uuid,
    target: &InviteTargetRef,
    options: NewInvite,
) -> Result<invite_codes::Model, CadenzaError> {
    if options.max_uses.is_some_and(|uses| uses <= 0) {
        return Err(CadenzaError::InvalidRequestBody(
            "max_uses must be at least 1".into(),
        ));
    }
    let grants_role = match target {
        InviteTargetRef::SharedPlaylist(_) => match options.grants_role {
            Some(PlaylistRole::Owner) => {
                return Err(CadenzaError::InvalidRequestBody(
                    "a playlist code grants viewer or editor".into(),
                ));
            }
            role => Some(role.unwrap_or(PlaylistRole::Viewer).to_value()),
        },
        InviteTargetRef::LiveSession(_) => None,
    };
    let now = Utc::now();

    for _ in 0..MAX_CODE_ATTEMPTS {
        let row = invite_codes::ActiveModel {
            code: Set(generate_code()),
            target_kind: Set(target.kind()),
            target_id: Set(target.id_text()),
            grants_role: Set(grants_role.clone()),
            created_by: Set(created_by),
            created_at: Set(now.fixed_offset()),
            expires_at: Set(options.expires_in.map(|d| (now + d).fixed_offset())),
            max_uses: Set(options.max_uses),
            uses: Set(0),
            revoked_at: Set(None),
        };
        match invite_codes::Entity::insert(row)
            .exec_with_returning(db)
            .await
        {
            Ok(model) => return Ok(model),
            Err(err) if is_unique_violation(&err) => continue,
            Err(err) => return Err(err.into()),
        }
    }
    Err(CadenzaError::DatabaseError(
        "could not find an unused invite code".into(),
    ))
}

fn is_unique_violation(err: &DbErr) -> bool {
    matches!(err, DbErr::Query(RuntimeErr::SqlxError(sqlx))
        if sqlx.as_database_error().and_then(|e| e.code()).as_deref() == Some("23505"))
}

/// Checks `code`, counts one use, and returns what it points at.
/// `InviteCodeInvalid` for a code that does not exist, expired, ran out, or was
/// revoked. All four look the same, so a guess learns nothing.
pub async fn redeem_invite(db: &impl Db, code: &str) -> Result<Redeemed, CadenzaError> {
    // one statement, so two redeems of a one use code cannot both pass
    let row = db
        .query_one_raw(stmt(
            "UPDATE invite_codes
             SET uses = uses + 1
             WHERE code = $1
               AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at > now())
               AND (max_uses IS NULL OR uses < max_uses)
             RETURNING target_kind::text AS target_kind, target_id, grants_role",
            vec![code.into()],
        ))
        .await?
        .ok_or(CadenzaError::InviteCodeInvalid)?;

    let kind: InviteTarget = row.try_get("", "target_kind")?;
    let target_id: String = row.try_get("", "target_id")?;
    let grants_role: Option<PlaylistRole> = row.try_get("", "grants_role")?;
    Ok(Redeemed {
        target: InviteTargetRef::from_row(&kind, &target_id)?,
        grants_role,
    })
}

/// Revokes every live code for `target`, for when it is deleted or ended.
pub async fn revoke_invites_for<C: ConnectionTrait>(
    db: &C,
    target: &InviteTargetRef,
) -> Result<(), CadenzaError> {
    db.execute_raw(stmt(
        "UPDATE invite_codes SET revoked_at = now()
         WHERE target_kind = $1::invite_target AND target_id = $2 AND revoked_at IS NULL",
        vec![
            match target {
                InviteTargetRef::SharedPlaylist(_) => "shared_playlist",
                InviteTargetRef::LiveSession(_) => "live_session",
            }
            .into(),
            target.id_text().into(),
        ],
    ))
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_round_trip_through_their_row() {
        let session = InviteTargetRef::LiveSession(Uuid::from_u128(9));
        assert_eq!(
            InviteTargetRef::from_row(&session.kind(), &session.id_text()).unwrap(),
            session
        );
        let playlist = InviteTargetRef::SharedPlaylist(42);
        assert_eq!(
            InviteTargetRef::from_row(&playlist.kind(), &playlist.id_text()).unwrap(),
            playlist
        );
    }
}
