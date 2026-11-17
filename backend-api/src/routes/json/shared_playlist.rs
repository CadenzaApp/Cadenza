use chrono::{DateTime, Utc};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};

use crate::db::shared_playlists::{
    PlaylistAction, PlaylistDetail, PlaylistEntry, PlaylistMember, PlaylistRole, PlaylistSummary,
    allowed,
};

/// [`allowed`] for each action the app gates on, so it never keeps its own
/// table.
#[derive(Serialize)]
pub struct PlaylistPermissions {
    pub edit_songs: bool,
    pub edit_details: bool,
    pub manage_members: bool,
    pub make_invite: bool,
    pub delete: bool,
}

impl From<PlaylistRole> for PlaylistPermissions {
    fn from(role: PlaylistRole) -> Self {
        let can = |action| allowed(role, action);
        Self {
            edit_songs: can(PlaylistAction::EditSongs),
            edit_details: can(PlaylistAction::EditDetails),
            manage_members: can(PlaylistAction::ManageMembers),
            make_invite: can(PlaylistAction::MakeInvite),
            delete: can(PlaylistAction::Delete),
        }
    }
}

#[derive(Serialize)]
pub struct SharedPlaylistSummary {
    pub playlist_id: i64,
    pub name: String,
    pub description: String,
    pub owner: Person,
    /// The caller's role.
    pub role: PlaylistRole,
    pub can: PlaylistPermissions,
    pub song_count: i64,
    pub member_count: i64,
    /// The first four songs, for a cover mosaic. Catalog ids.
    pub cover_song_ids: Vec<String>,
    pub version: i64,
    pub updated_at: DateTime<Utc>,
}

impl From<PlaylistSummary> for SharedPlaylistSummary {
    fn from(row: PlaylistSummary) -> Self {
        Self {
            playlist_id: row.playlist_id,
            name: row.name,
            description: row.description,
            owner: Person {
                user_id: row.owner_id,
                username: row.owner_username,
            },
            role: row.role,
            can: row.role.into(),
            song_count: row.song_count,
            member_count: row.member_count,
            cover_song_ids: row.cover_song_ids,
            version: row.version,
            updated_at: row.updated_at.with_timezone(&Utc),
        }
    }
}

#[derive(Serialize)]
pub struct Person {
    pub user_id: Uuid,
    pub username: String,
}

#[derive(Serialize)]
pub struct SharedPlaylistsResponse {
    pub playlists: Vec<SharedPlaylistSummary>,
}

/// `GET /shared-playlists/users/{user_id}`. `playlists` is null when hidden.
#[derive(Serialize)]
pub struct ProfilePlaylistsResponse {
    pub playlists: Option<Vec<SharedPlaylistSummary>>,
}

#[derive(Serialize)]
pub struct SharedPlaylistMember {
    pub user_id: Uuid,
    pub username: String,
    pub role: PlaylistRole,
    pub joined_at: DateTime<Utc>,
}

impl From<PlaylistMember> for SharedPlaylistMember {
    fn from(row: PlaylistMember) -> Self {
        Self {
            user_id: row.user_id,
            username: row.username,
            role: row.role,
            joined_at: row.joined_at.with_timezone(&Utc),
        }
    }
}

/// One song in the playlist. Titles come from Apple Music by `song_id`.
#[derive(Serialize)]
pub struct SharedPlaylistEntry {
    pub entry_id: i64,
    pub song_id: String,
    pub position: i32,
    pub added_by: Option<Uuid>,
    pub added_at: DateTime<Utc>,
}

impl From<PlaylistEntry> for SharedPlaylistEntry {
    fn from(row: PlaylistEntry) -> Self {
        Self {
            entry_id: row.entry_id,
            song_id: row.song_id,
            position: row.position,
            added_by: row.added_by,
            added_at: row.added_at.with_timezone(&Utc),
        }
    }
}

#[derive(Serialize)]
pub struct SharedPlaylistDetail {
    pub playlist_id: i64,
    pub owner_id: Uuid,
    pub name: String,
    pub description: String,
    pub version: i64,
    pub my_role: PlaylistRole,
    pub can: PlaylistPermissions,
    pub members: Vec<SharedPlaylistMember>,
    pub entries: Vec<SharedPlaylistEntry>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<PlaylistDetail> for SharedPlaylistDetail {
    fn from(detail: PlaylistDetail) -> Self {
        Self {
            playlist_id: detail.header.playlist_id,
            owner_id: detail.header.owner_id,
            name: detail.header.name,
            description: detail.header.description,
            version: detail.header.version,
            my_role: detail.my_role,
            can: detail.my_role.into(),
            members: detail.members.into_iter().map(Into::into).collect(),
            entries: detail.entries.into_iter().map(Into::into).collect(),
            created_at: detail.header.created_at.with_timezone(&Utc),
            updated_at: detail.header.updated_at.with_timezone(&Utc),
        }
    }
}

#[derive(Deserialize)]
pub struct CreateSharedPlaylist {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub song_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct CreatedSharedPlaylist {
    pub playlist_id: i64,
}

#[derive(Deserialize)]
pub struct PatchSharedPlaylist {
    pub name: Option<String>,
    pub description: Option<String>,
    pub expected_version: Option<i64>,
}

#[derive(Deserialize)]
pub struct AddSharedPlaylistSongs {
    pub song_ids: Vec<String>,
    /// Where to insert, 0 based. Missing means the end.
    pub position: Option<i32>,
    pub expected_version: Option<i64>,
}

#[derive(Deserialize)]
pub struct MoveSharedPlaylistSong {
    pub position: i32,
    pub expected_version: Option<i64>,
}

#[derive(Deserialize)]
pub struct ExpectedVersion {
    pub expected_version: Option<i64>,
}

#[derive(Deserialize)]
pub struct AddSharedPlaylistMember {
    pub user_id: Uuid,
    /// `viewer` or `editor`.
    pub role: PlaylistRole,
}

#[derive(Deserialize)]
pub struct SetSharedPlaylistRole {
    /// `viewer` or `editor`.
    pub role: PlaylistRole,
}

/// What a write left the playlist at. `deleted` when the owner left.
#[derive(Serialize)]
pub struct PlaylistVersion {
    pub version: Option<i64>,
    pub deleted: bool,
}
