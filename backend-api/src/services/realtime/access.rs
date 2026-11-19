//! Who may subscribe to what. Checked once per subscribe; an event carries no
//! private data, so a stale subscription leaks nothing the next HTTP read would
//! not refuse anyway.

use sea_orm::{DatabaseConnection, prelude::Uuid};

use super::Topic;
use crate::db::{
    audience::{PrivacyField, can_see_field},
    live_sessions::is_participant,
    shared_playlists::member_role,
};
use crate::err::CadenzaError;

pub async fn can_subscribe(
    db: &DatabaseConnection,
    user_id: Uuid,
    topic: &Topic,
) -> Result<bool, CadenzaError> {
    match topic {
        Topic::User(owner) => can_see_field(db, user_id, *owner, PrivacyField::NowPlaying).await,
        Topic::LiveSession(session_id) => is_participant(db, *session_id, user_id).await,
        Topic::SharedPlaylist(playlist_id) => {
            Ok(member_role(db, *playlist_id, user_id).await?.is_some())
        }
    }
}
