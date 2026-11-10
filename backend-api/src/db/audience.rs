//! Who may see one part of a user's listening. The one audience check every
//! social listening feature goes through: now playing, recent plays, live
//! session joins, and shared playlist adds.
//!
//! `everyone` lets anyone in, `friends` needs a `complete` row in
//! `friendships`, and `nobody` lets no one in. The owner always sees their own.
//! An invite code skips this check for the one thing it points at, and is
//! checked elsewhere.

use sea_orm::{DatabaseConnection, DbBackend, FromQueryResult, Statement, prelude::Uuid};

pub use crate::db::entity::sea_orm_active_enums::Audience;
use crate::db::{entity::privacy_settings, privacy::get_privacy, social::is_friend};
use crate::err::CadenzaError;

/// One audience setting in `privacy_settings`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrivacyField {
    /// The song playing right now.
    NowPlaying,
    /// Recent plays, from `listening_events`.
    ListeningHistory,
    /// Joining a live session without a code.
    SessionJoin,
    /// Being added to a shared playlist without a code.
    PlaylistAdd,
}

impl PrivacyField {
    /// The `privacy_settings` column this field is stored in.
    pub fn column(self) -> &'static str {
        match self {
            Self::NowPlaying => "now_playing",
            Self::ListeningHistory => "listening_history",
            Self::SessionJoin => "session_join",
            Self::PlaylistAdd => "playlist_add",
        }
    }

    /// What a user with no row gets. Matches the column defaults in
    /// `sql/social_privacy.sql`.
    pub fn default_audience(self) -> Audience {
        Audience::Friends
    }

    /// This field's value on a stored row.
    pub fn read(self, row: &privacy_settings::Model) -> Audience {
        match self {
            Self::NowPlaying => row.now_playing.clone(),
            Self::ListeningHistory => row.listening_history.clone(),
            Self::SessionJoin => row.session_join.clone(),
            Self::PlaylistAdd => row.playlist_add.clone(),
        }
    }
}

/// Stored name of an audience, as the `audience` enum spells it.
pub fn audience_name(audience: &Audience) -> &'static str {
    match audience {
        Audience::Everyone => "everyone",
        Audience::Friends => "friends",
        Audience::Nobody => "nobody",
    }
}

/// The rule itself, once friendship is known.
pub fn allows(audience: &Audience, is_owner: bool, is_friend: bool) -> bool {
    is_owner
        || match audience {
            Audience::Everyone => true,
            Audience::Friends => is_friend,
            Audience::Nobody => false,
        }
}

/// Whether `viewer` passes `audience` on something `owner` owns. Only looks up
/// the friendship when the answer depends on it.
pub async fn can_see(
    db: &DatabaseConnection,
    viewer: Uuid,
    owner: Uuid,
    audience: &Audience,
) -> Result<bool, CadenzaError> {
    let is_owner = viewer == owner;
    let needs_friendship = !is_owner && *audience == Audience::Friends;
    let friends = needs_friendship && is_friend(db, viewer, owner).await?;
    Ok(allows(audience, is_owner, friends))
}

/// Whether `viewer` may see `field` of `owner`, by `owner`'s privacy settings.
pub async fn can_see_field(
    db: &DatabaseConnection,
    viewer: Uuid,
    owner: Uuid,
    field: PrivacyField,
) -> Result<bool, CadenzaError> {
    if viewer == owner {
        return Ok(true);
    }
    let settings = get_privacy(db, owner).await?;
    can_see(db, viewer, owner, &field.read(&settings)).await
}

#[derive(FromQueryResult)]
struct UserIdRow {
    user_id: Uuid,
}

/// `viewer`'s completed friends whose `field` lets a friend see it, in one
/// query, for lists like who is listening now. Friends only: someone who sets
/// `everyone` is not listed to strangers, they can only open that user.
pub async fn visible_friend_ids(
    db: &DatabaseConnection,
    viewer: Uuid,
    field: PrivacyField,
) -> Result<Vec<Uuid>, CadenzaError> {
    let sql = format!(
        "SELECT CASE WHEN f.user1 = $1 THEN f.user2 ELSE f.user1 END AS user_id
         FROM friendships f
         LEFT JOIN privacy_settings ps
           ON ps.user_id = CASE WHEN f.user1 = $1 THEN f.user2 ELSE f.user1 END
         WHERE (f.user1 = $1 OR f.user2 = $1)
           AND f.status = 'complete'
           AND COALESCE(ps.{column}, '{default}'::audience) <> 'nobody'",
        column = field.column(),
        default = audience_name(&field.default_audience()),
    );
    let rows = UserIdRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        vec![viewer.into()],
    ))
    .all(db)
    .await?;
    Ok(rows.into_iter().map(|row| row.user_id).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_always_sees_their_own() {
        for audience in [Audience::Everyone, Audience::Friends, Audience::Nobody] {
            assert!(allows(&audience, true, false));
        }
    }

    #[test]
    fn friends_need_a_friendship_and_nobody_lets_no_one_in() {
        assert!(allows(&Audience::Everyone, false, false));
        assert!(allows(&Audience::Friends, false, true));
        assert!(!allows(&Audience::Friends, false, false));
        assert!(!allows(&Audience::Nobody, false, true));
    }

    #[test]
    fn every_field_has_its_own_column() {
        let fields = [
            PrivacyField::NowPlaying,
            PrivacyField::ListeningHistory,
            PrivacyField::SessionJoin,
            PrivacyField::PlaylistAdd,
        ];
        let columns: std::collections::HashSet<_> =
            fields.iter().map(|field| field.column()).collect();
        assert_eq!(columns.len(), fields.len());
    }
}
