//! Per user privacy settings: who can see each part of their listening, and
//! who can listen along without being invited. A user
//! with no row reads the defaults, and the row is created on their first
//! change. The check that reads these is `db::audience`.

use chrono::Utc;
use sea_orm::{
    ActiveValue::Set, ConnectionTrait, DatabaseConnection, EntityTrait, Iterable, prelude::Uuid,
    sea_query::OnConflict,
};

use crate::db::audience::{Audience, PrivacyField};
use crate::db::entity::privacy_settings::{self, Column};
use crate::err::CadenzaError;

/// A partial change. `None` leaves a field alone.
#[derive(Debug, Default)]
pub struct PrivacyPatch {
    pub now_playing: Option<Audience>,
    pub listening_history: Option<Audience>,
    pub session_join: Option<Audience>,
    pub playlist_add: Option<Audience>,
    pub listen_along: Option<Audience>,
    pub profile_playlists: Option<Audience>,
    pub profile_queries: Option<Audience>,
}

/// The settings a user with no row gets.
fn default_privacy(user_id: Uuid) -> privacy_settings::Model {
    privacy_settings::Model {
        user_id,
        now_playing: PrivacyField::NowPlaying.default_audience(),
        listening_history: PrivacyField::ListeningHistory.default_audience(),
        session_join: PrivacyField::SessionJoin.default_audience(),
        playlist_add: PrivacyField::PlaylistAdd.default_audience(),
        updated_at: Utc::now().fixed_offset(),
        listen_along: PrivacyField::ListenAlong.default_audience(),
        profile_playlists: PrivacyField::ProfilePlaylists.default_audience(),
        profile_queries: PrivacyField::ProfileQueries.default_audience(),
    }
}

/// Returns the user's privacy settings, or the defaults when they have never
/// changed one.
pub async fn get_privacy(
    db: &impl ConnectionTrait,
    user_id: Uuid,
) -> Result<privacy_settings::Model, CadenzaError> {
    Ok(privacy_settings::Entity::find_by_id(user_id)
        .one(db)
        .await?
        .unwrap_or_else(|| default_privacy(user_id)))
}

/// Applies `patch` and returns the full settings after it. Creates the row on
/// the first change. `InvalidRequestBody` when the patch is empty.
pub async fn update_privacy(
    db: &DatabaseConnection,
    user_id: Uuid,
    patch: PrivacyPatch,
) -> Result<privacy_settings::Model, CadenzaError> {
    // the insert half of the upsert needs every column, so it starts from the
    // defaults. the update half only writes what the patch names
    let defaults = default_privacy(user_id);
    let row = privacy_settings::ActiveModel {
        user_id: Set(user_id),
        now_playing: Set(patch.now_playing.clone().unwrap_or(defaults.now_playing)),
        listening_history: Set(patch
            .listening_history
            .clone()
            .unwrap_or(defaults.listening_history)),
        session_join: Set(patch.session_join.clone().unwrap_or(defaults.session_join)),
        playlist_add: Set(patch.playlist_add.clone().unwrap_or(defaults.playlist_add)),
        updated_at: Set(Utc::now().fixed_offset()),
        listen_along: Set(patch.listen_along.clone().unwrap_or(defaults.listen_along)),
        profile_playlists: Set(patch
            .profile_playlists
            .clone()
            .unwrap_or(defaults.profile_playlists)),
        profile_queries: Set(patch
            .profile_queries
            .clone()
            .unwrap_or(defaults.profile_queries)),
    };

    let changed = changed_columns(&patch);
    if changed.len() == 1 {
        return Err(CadenzaError::InvalidRequestBody(
            "set at least one privacy setting".to_string(),
        ));
    }
    Ok(privacy_settings::Entity::insert(row)
        .on_conflict(
            OnConflict::column(Column::UserId)
                .update_columns(changed)
                .to_owned(),
        )
        .exec_with_returning(db)
        .await?)
}

/// The columns a conflict should update: what the patch names, and `updated_at`.
fn changed_columns(patch: &PrivacyPatch) -> Vec<Column> {
    Column::iter()
        .filter(|column| match column {
            Column::NowPlaying => patch.now_playing.is_some(),
            Column::ListeningHistory => patch.listening_history.is_some(),
            Column::SessionJoin => patch.session_join.is_some(),
            Column::PlaylistAdd => patch.playlist_add.is_some(),
            Column::ListenAlong => patch.listen_along.is_some(),
            Column::ProfilePlaylists => patch.profile_playlists.is_some(),
            Column::ProfileQueries => patch.profile_queries.is_some(),
            Column::UpdatedAt => true,
            Column::UserId => false,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changed_columns_lists_what_the_patch_names_and_updated_at() {
        assert!(matches!(
            changed_columns(&PrivacyPatch::default())[..],
            [Column::UpdatedAt]
        ));
        let patch = PrivacyPatch {
            now_playing: Some(Audience::Nobody),
            ..Default::default()
        };
        let changed = changed_columns(&patch);
        assert_eq!(changed.len(), 2);
        assert!(changed.iter().any(|c| matches!(c, Column::NowPlaying)));
        assert!(!changed.iter().any(|c| matches!(c, Column::UserId)));
    }
}
