use serde::{Deserialize, Serialize};

use crate::db::{
    audience::Audience as DbAudience, entity::privacy_settings, privacy::PrivacyPatch,
};

/// Who can see one part of a user's listening.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Audience {
    Everyone,
    Friends,
    Nobody,
}

impl From<DbAudience> for Audience {
    fn from(audience: DbAudience) -> Self {
        match audience {
            DbAudience::Everyone => Self::Everyone,
            DbAudience::Friends => Self::Friends,
            DbAudience::Nobody => Self::Nobody,
        }
    }
}

impl From<Audience> for DbAudience {
    fn from(audience: Audience) -> Self {
        match audience {
            Audience::Everyone => Self::Everyone,
            Audience::Friends => Self::Friends,
            Audience::Nobody => Self::Nobody,
        }
    }
}

/// The signed-in user's privacy settings as the api returns them.
#[derive(Serialize)]
pub struct PrivacySettings {
    pub now_playing: Audience,
    pub listening_history: Audience,
    pub session_join: Audience,
    pub playlist_add: Audience,
    /// The phone opens a listener only live session whenever this user plays.
    pub listen_along: bool,
}

impl From<privacy_settings::Model> for PrivacySettings {
    fn from(model: privacy_settings::Model) -> Self {
        Self {
            now_playing: model.now_playing.into(),
            listening_history: model.listening_history.into(),
            session_join: model.session_join.into(),
            playlist_add: model.playlist_add.into(),
            listen_along: model.listen_along,
        }
    }
}

/// `PATCH /settings/privacy` body. A missing key is left alone.
#[derive(Deserialize, Default)]
pub struct PatchPrivacySettings {
    pub now_playing: Option<Audience>,
    pub listening_history: Option<Audience>,
    pub session_join: Option<Audience>,
    pub playlist_add: Option<Audience>,
    pub listen_along: Option<bool>,
}

impl From<PatchPrivacySettings> for PrivacyPatch {
    fn from(body: PatchPrivacySettings) -> Self {
        Self {
            now_playing: body.now_playing.map(Into::into),
            listening_history: body.listening_history.map(Into::into),
            session_join: body.session_join.map(Into::into),
            playlist_add: body.playlist_add.map(Into::into),
            listen_along: body.listen_along,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn patch_reads_lowercase_and_rejects_unknown() {
        let body: PatchPrivacySettings =
            serde_json::from_value(json!({ "now_playing": "nobody" })).unwrap();
        assert_eq!(body.now_playing, Some(Audience::Nobody));
        assert_eq!(body.playlist_add, None);
        assert!(
            serde_json::from_value::<PatchPrivacySettings>(json!({ "now_playing": "public" }))
                .is_err()
        );
    }
}
