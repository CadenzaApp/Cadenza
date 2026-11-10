//! Invite codes in `invite_codes`. Target agnostic: redeeming checks and counts
//! a code and says what it points at. Joining is the shared playlist or live
//! session code's job, so this never needs to know about either.

use chrono::{DateTime, Duration, Utc};
use sea_orm::{
    ActiveValue::Set, ConnectionTrait, DatabaseConnection, DbBackend, DbErr, EntityTrait,
    RuntimeErr, Statement, prelude::Uuid,
};

use crate::db::entity::{invite_codes, sea_orm_active_enums::InviteTarget};
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
    pub grants_role: Option<String>,
}

/// Options for a new code.
#[derive(Clone, Debug, Default)]
pub struct NewInvite {
    /// `viewer` or `editor` for a playlist. Ignored for a session.
    pub grants_role: Option<String>,
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
        InviteTargetRef::SharedPlaylist(_) => match options.grants_role.as_deref() {
            None | Some("viewer") => Some("viewer".to_owned()),
            Some("editor") => Some("editor".to_owned()),
            Some(other) => {
                return Err(CadenzaError::InvalidRequestBody(format!(
                    "a playlist code grants viewer or editor, not '{other}'"
                )));
            }
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

/// Whether a code can still be used at `now`.
pub fn is_usable(code: &invite_codes::Model, now: DateTime<Utc>) -> bool {
    code.revoked_at.is_none()
        && code
            .expires_at
            .is_none_or(|at| at.with_timezone(&Utc) > now)
        && code.max_uses.is_none_or(|max| code.uses < max)
}

/// Checks `code`, counts one use, and returns what it points at.
/// `InviteCodeInvalid` for a code that does not exist, expired, ran out, or was
/// revoked. All four look the same, so a guess learns nothing.
pub async fn redeem_invite(db: &DatabaseConnection, code: &str) -> Result<Redeemed, CadenzaError> {
    // one statement, so two redeems of a one use code cannot both pass
    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
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

    let kind: String = row.try_get("", "target_kind")?;
    let target_id: String = row.try_get("", "target_id")?;
    let grants_role: Option<String> = row.try_get("", "grants_role")?;
    let kind = match kind.as_str() {
        "shared_playlist" => InviteTarget::SharedPlaylist,
        "live_session" => InviteTarget::LiveSession,
        other => {
            return Err(CadenzaError::DatabaseError(format!(
                "unknown invite target '{other}'"
            )));
        }
    };
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
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
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

    fn code(uses: i32, max_uses: Option<i32>) -> invite_codes::Model {
        invite_codes::Model {
            code: "ABCDEFGH".into(),
            target_kind: InviteTarget::LiveSession,
            target_id: Uuid::nil().to_string(),
            grants_role: None,
            created_by: Uuid::nil(),
            created_at: Utc::now().fixed_offset(),
            expires_at: None,
            max_uses,
            uses,
            revoked_at: None,
        }
    }

    #[test]
    fn a_code_runs_out_expires_and_revokes() {
        let now = Utc::now();
        assert!(is_usable(&code(0, None), now));
        assert!(is_usable(&code(2, Some(3)), now));
        assert!(!is_usable(&code(3, Some(3)), now));

        let mut expired = code(0, None);
        expired.expires_at = Some((now - Duration::minutes(1)).fixed_offset());
        assert!(!is_usable(&expired, now));

        let mut revoked = code(0, None);
        revoked.revoked_at = Some(now.fixed_offset());
        assert!(!is_usable(&revoked, now));
    }

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
