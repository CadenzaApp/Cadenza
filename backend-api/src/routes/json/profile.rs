use sea_orm::prelude::Uuid;
use serde::Serialize;

use crate::db::entity::profile;

/// A public profile as the api returns it.
#[derive(Serialize)]
pub struct Profile {
    pub uid: Uuid,
    pub username: String,
    pub bio: String,
}

impl From<profile::Model> for Profile {
    fn from(model: profile::Model) -> Self {
        Self {
            uid: model.uid,
            username: model.username,
            bio: model.bio,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn profile_serializes_uid_username_and_bio() {
        let uid = Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap();
        let body = serde_json::to_value(Profile {
            uid,
            username: "alice".to_owned(),
            bio: "hi".to_owned(),
        })
        .unwrap();

        assert_eq!(
            body,
            json!({
                "uid": "11111111-1111-1111-1111-111111111111",
                "username": "alice",
                "bio": "hi",
            })
        );
    }
}
