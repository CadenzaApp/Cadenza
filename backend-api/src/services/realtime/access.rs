//! Subscription and delivery checks. Membership, blocks and privacy are rechecked
//! before delivery, including playback events and events queued before revocation.

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
        Topic::Inbox(owner) => Ok(*owner == user_id),
    }
}

pub async fn can_receive(
    db: &DatabaseConnection,
    user_id: Uuid,
    topic: &Topic,
    ended: bool,
) -> Result<bool, CadenzaError> {
    if let Topic::LiveSession(id) = topic {
        if ended {
            return crate::db::live_sessions::can_receive_end(db, *id, user_id).await;
        }
    }
    can_subscribe(db, user_id, topic).await
}
