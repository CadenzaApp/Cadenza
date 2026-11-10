use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::db::{entity::invite_codes, invites::InviteTargetRef};

/// Options for a new code. All optional.
#[derive(Deserialize, Default)]
pub struct CreateInvite {
    /// Playlists only: `viewer` (default) or `editor`.
    pub role: Option<String>,
    pub expires_in_hours: Option<i64>,
    pub max_uses: Option<i32>,
}

#[derive(Serialize)]
pub struct Invite {
    pub code: String,
    /// `cadenza://join/{code}`, for the share sheet.
    pub link: String,
    pub grants_role: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub max_uses: Option<i32>,
}

impl From<invite_codes::Model> for Invite {
    fn from(model: invite_codes::Model) -> Self {
        Self {
            link: format!("cadenza://join/{}", model.code),
            code: model.code,
            grants_role: model.grants_role,
            expires_at: model.expires_at.map(|at| at.with_timezone(&Utc)),
            max_uses: model.max_uses,
        }
    }
}

/// What a redeemed code joined. `id` is the playlist id as a string or the
/// session uuid.
#[derive(Serialize)]
pub struct Redeemed {
    pub kind: &'static str,
    pub id: String,
}

impl From<InviteTargetRef> for Redeemed {
    fn from(target: InviteTargetRef) -> Self {
        match target {
            InviteTargetRef::SharedPlaylist(id) => Self {
                kind: "shared_playlist",
                id: id.to_string(),
            },
            InviteTargetRef::LiveSession(id) => Self {
                kind: "live_session",
                id: id.to_string(),
            },
        }
    }
}
