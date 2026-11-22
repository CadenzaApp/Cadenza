//! Shared playlists: `shared_playlists`, `shared_playlist_members`, and
//! `shared_playlist_songs`.
//!
//! Every write is one transaction: lock the playlist row `FOR UPDATE`, check the
//! caller's role, check `expected_version` when given, write, renumber
//! positions, bump `version`. Reads need membership. A non member gets
//! `NotFound`, so a playlist id does not leak that it exists.
//!
//! The owner leaving deletes the playlist. Handing it to an editor was the
//! other option; deleting is simpler and nothing depended on it surviving.
//!
//! A catalog song is in a playlist once. The row's key is `(playlist_id, song_id)`.

use std::collections::HashSet;

use chrono::{DateTime, FixedOffset};
use sea_orm::{ActiveEnum, ConnectionTrait, DatabaseTransaction, FromQueryResult, prelude::Uuid};

use crate::db::collab::{check_name, moved_order, write_song_order};
use crate::db::{Db, stmt};
use crate::db::{
    audience::{PrivacyField, can_see_field},
    entity::invite_codes,
    invites::{InviteTargetRef, NewInvite, create_invite, find_live_invite, revoke_invites_for},
    now_playing::is_catalog_id,
};
use crate::err::CadenzaError;

/// The most songs one playlist holds, and one add can carry.
pub const MAX_PLAYLIST_SONGS: usize = 1000;
pub const MAX_SONGS_PER_ADD: usize = 200;

pub use crate::db::entity::sea_orm_active_enums::PlaylistRole;

/// What a role may do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlaylistAction {
    Read,
    EditSongs,
    EditDetails,
    ManageMembers,
    MakeInvite,
    Delete,
}

/// The one table of who may do what.
pub fn allowed(role: PlaylistRole, action: PlaylistAction) -> bool {
    match action {
        PlaylistAction::Read => true,
        PlaylistAction::EditSongs => role != PlaylistRole::Viewer,
        PlaylistAction::EditDetails
        | PlaylistAction::ManageMembers
        | PlaylistAction::MakeInvite
        | PlaylistAction::Delete => role == PlaylistRole::Owner,
    }
}

/// One playlist in "my shared playlists".
#[derive(Clone, Debug, FromQueryResult)]
pub struct PlaylistSummary {
    pub playlist_id: i64,
    pub name: String,
    pub description: String,
    pub owner_id: Uuid,
    pub owner_username: String,
    pub role: PlaylistRole,
    pub song_count: i64,
    pub member_count: i64,
    /// The first four songs, for a cover mosaic.
    pub cover_song_ids: Vec<String>,
    pub version: i64,
    pub updated_at: DateTime<FixedOffset>,
}

#[derive(Clone, Debug, FromQueryResult)]
pub struct PlaylistMember {
    pub user_id: Uuid,
    pub username: String,
    pub role: PlaylistRole,
    pub joined_at: DateTime<FixedOffset>,
}

#[derive(Clone, Debug, FromQueryResult)]
pub struct PlaylistEntry {
    pub song_id: String,
    pub position: i32,
    pub added_by: Option<Uuid>,
    pub added_at: DateTime<FixedOffset>,
}

#[derive(Clone, Debug, FromQueryResult)]
pub struct PlaylistHeader {
    pub playlist_id: i64,
    pub owner_id: Uuid,
    pub name: String,
    pub description: String,
    pub version: i64,
    pub created_at: DateTime<FixedOffset>,
    pub updated_at: DateTime<FixedOffset>,
}

/// Everything the detail screen shows.
#[derive(Clone, Debug)]
pub struct PlaylistDetail {
    pub header: PlaylistHeader,
    pub my_role: PlaylistRole,
    pub members: Vec<PlaylistMember>,
    pub entries: Vec<PlaylistEntry>,
}

/// What a post shows of a shared playlist it attaches. Anyone who sees the
/// post sees this much; opening the playlist still needs membership.
#[derive(Clone, Debug, PartialEq, Eq, FromQueryResult)]
pub struct PlaylistCard {
    pub playlist_id: i64,
    pub name: String,
    pub song_count: i64,
    pub member_count: i64,
    /// The first four songs' catalog ids, for a cover mosaic.
    pub cover_song_ids: Vec<String>,
}

/// Cards for these playlists, by id. An id with no row is missing.
pub async fn playlist_cards<C: ConnectionTrait>(
    db: &C,
    playlist_ids: &[i64],
) -> Result<std::collections::HashMap<i64, PlaylistCard>, CadenzaError> {
    if playlist_ids.is_empty() {
        return Ok(Default::default());
    }
    let rows = PlaylistCard::find_by_statement(stmt(
        "SELECT p.playlist_id, p.name,
                (SELECT count(*) FROM shared_playlist_songs s
                 WHERE s.playlist_id = p.playlist_id) AS song_count,
                (SELECT count(*) FROM shared_playlist_members m
                 WHERE m.playlist_id = p.playlist_id) AS member_count,
                ARRAY(SELECT s.song_id FROM shared_playlist_songs s
                      WHERE s.playlist_id = p.playlist_id
                      ORDER BY s.position, s.song_id LIMIT 4) AS cover_song_ids
         FROM shared_playlists p
         WHERE p.playlist_id = ANY($1)",
        vec![playlist_ids.to_vec().into()],
    ))
    .all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|card| (card.playlist_id, card))
        .collect())
}

/// The caller's role on a playlist, or `None` when they are not a member.
pub async fn member_role<C: ConnectionTrait>(
    db: &C,
    playlist_id: i64,
    user_id: Uuid,
) -> Result<Option<PlaylistRole>, CadenzaError> {
    let row = db
        .query_one_raw(stmt(
            "SELECT m.role::text AS role FROM shared_playlist_members m
             JOIN shared_playlists p ON p.playlist_id = m.playlist_id
             WHERE m.playlist_id = $1 AND m.user_id = $2
               AND NOT EXISTS (SELECT 1 FROM user_blocks b
                   WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
                      OR (b.blocker_id = p.owner_id AND b.blocked_id = $2))",
            vec![playlist_id.into(), user_id.into()],
        ))
        .await?;
    Ok(match row {
        Some(row) => Some(row.try_get("", "role")?),
        None => None,
    })
}

/// Locks the playlist, checks the caller may do `action`, and checks
/// `expected_version`. Returns their role and the current version.
async fn lock_for(
    txn: &DatabaseTransaction,
    playlist_id: i64,
    user_id: Uuid,
    action: PlaylistAction,
    expected_version: Option<i64>,
) -> Result<(PlaylistRole, i64), CadenzaError> {
    let row = txn
        .query_one_raw(stmt(
            "SELECT version FROM shared_playlists WHERE playlist_id = $1 FOR UPDATE",
            vec![playlist_id.into()],
        ))
        .await?
        .ok_or(CadenzaError::NotFound)?;
    let version: i64 = row.try_get("", "version")?;
    let role = member_role(txn, playlist_id, user_id)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    if !allowed(role, action) {
        return Err(CadenzaError::Forbidden(format!(
            "a playlist {} cannot do that",
            role.to_value().value.into_owned()
        )));
    }
    if let Some(expected) = expected_version
        && expected != version
    {
        return Err(CadenzaError::VersionConflict { current: version });
    }
    Ok((role, version))
}

/// Bumps the version and `updated_at`, and returns the new version.
async fn bump(txn: &DatabaseTransaction, playlist_id: i64) -> Result<i64, CadenzaError> {
    let row = txn
        .query_one_raw(stmt(
            "UPDATE shared_playlists SET version = version + 1, updated_at = now()
             WHERE playlist_id = $1 RETURNING version",
            vec![playlist_id.into()],
        ))
        .await?
        .ok_or(CadenzaError::NotFound)?;
    Ok(row.try_get("", "version")?)
}

/// Renumbers positions 0..n in their current order.
async fn renumber(txn: &DatabaseTransaction, playlist_id: i64) -> Result<(), CadenzaError> {
    txn.execute_raw(stmt(
        "UPDATE shared_playlist_songs s SET position = r.rn - 1
         FROM (
             SELECT song_id, row_number() OVER (ORDER BY position, song_id) AS rn
             FROM shared_playlist_songs WHERE playlist_id = $1
         ) r
         WHERE s.playlist_id = $1 AND s.song_id = r.song_id AND s.position <> r.rn - 1",
        vec![playlist_id.into()],
    ))
    .await?;
    Ok(())
}

/// Rejects anything but catalog ids, since library ids mean nothing to the
/// other members.
fn check_song_ids(song_ids: &[String]) -> Result<(), CadenzaError> {
    if song_ids.len() > MAX_SONGS_PER_ADD {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "add at most {MAX_SONGS_PER_ADD} songs at once"
        )));
    }
    if let Some(bad) = song_ids.iter().find(|id| !is_catalog_id(id)) {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "'{bad}' is a library only song and cannot be shared"
        )));
    }
    Ok(())
}

/// The caller's shared playlists, most recently changed first.
pub async fn list_my_playlists(
    db: &impl Db,
    user_id: Uuid,
) -> Result<Vec<PlaylistSummary>, CadenzaError> {
    Ok(PlaylistSummary::find_by_statement(stmt(
        "SELECT
             p.playlist_id, p.name, p.description, p.owner_id,
             COALESCE(owner.username, 'unknown') AS owner_username,
             m.role::text AS role,
             (SELECT COUNT(*) FROM shared_playlist_songs s WHERE s.playlist_id = p.playlist_id) AS song_count,
             (SELECT COUNT(*) FROM shared_playlist_members mm WHERE mm.playlist_id = p.playlist_id) AS member_count,
             COALESCE(ARRAY(
                 SELECT s.song_id FROM shared_playlist_songs s
                 WHERE s.playlist_id = p.playlist_id ORDER BY s.position LIMIT 4
             ), '{}') AS cover_song_ids,
             p.version, p.updated_at
         FROM shared_playlist_members m
         JOIN shared_playlists p ON p.playlist_id = m.playlist_id
         LEFT JOIN profile owner ON owner.uid = p.owner_id
         WHERE m.user_id = $1
           AND NOT EXISTS (SELECT 1 FROM user_blocks b
               WHERE (b.blocker_id = $1 AND b.blocked_id = p.owner_id)
                  OR (b.blocker_id = p.owner_id AND b.blocked_id = $1))
         ORDER BY p.updated_at DESC",
        vec![user_id.into()],
    ))
    .all(db)
    .await?)
}

/// `owner`'s shared playlists for their profile, most recently changed first,
/// or `None` when their `profile_playlists` setting hides them from `viewer`.
/// Listing one does not let `viewer` open it; that still needs membership.
pub async fn profile_playlists(
    db: &impl Db,
    viewer: Uuid,
    owner: Uuid,
) -> Result<Option<Vec<PlaylistSummary>>, CadenzaError> {
    if !can_see_field(db, viewer, owner, PrivacyField::ProfilePlaylists).await? {
        return Ok(None);
    }
    list_my_playlists(db, owner).await.map(Some)
}

/// Makes a playlist owned by `owner_id`, with `song_ids` in it. Returns its id.
pub async fn create_playlist(
    db: &impl Db,
    owner_id: Uuid,
    name: &str,
    description: &str,
    song_ids: &[String],
) -> Result<i64, CadenzaError> {
    let name = check_name(name, "playlist")?;
    check_song_ids(song_ids)?;
    let txn = db.begin().await?;
    let row = txn
        .query_one_raw(stmt(
            "INSERT INTO shared_playlists (owner_id, name, description)
             VALUES ($1, $2, $3) RETURNING playlist_id",
            vec![owner_id.into(), name.into(), description.trim().into()],
        ))
        .await?
        .ok_or_else(|| CadenzaError::DatabaseError("insert returned nothing".into()))?;
    let playlist_id: i64 = row.try_get("", "playlist_id")?;
    txn.execute_raw(stmt(
        "INSERT INTO shared_playlist_members (playlist_id, user_id, role)
         VALUES ($1, $2, 'owner')",
        vec![playlist_id.into(), owner_id.into()],
    ))
    .await?;
    insert_songs(&txn, playlist_id, owner_id, song_ids, None).await?;
    txn.commit().await?;
    Ok(playlist_id)
}

/// The playlist as its detail screen shows it. `NotFound` for a non member.
pub async fn get_playlist(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
) -> Result<PlaylistDetail, CadenzaError> {
    let my_role = member_role(db, playlist_id, user_id)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    let header = PlaylistHeader::find_by_statement(stmt(
        "SELECT playlist_id, owner_id, name, description, version, created_at, updated_at
         FROM shared_playlists WHERE playlist_id = $1",
        vec![playlist_id.into()],
    ))
    .one(db)
    .await?
    .ok_or(CadenzaError::NotFound)?;
    let members = PlaylistMember::find_by_statement(stmt(
        "SELECT m.user_id, COALESCE(p.username, 'unknown') AS username,
                m.role::text AS role, m.joined_at
         FROM shared_playlist_members m
         LEFT JOIN profile p ON p.uid = m.user_id
         WHERE m.playlist_id = $1
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m.joined_at",
        vec![playlist_id.into()],
    ))
    .all(db)
    .await?;
    let entries = PlaylistEntry::find_by_statement(stmt(
        "SELECT song_id, position, added_by, added_at
         FROM shared_playlist_songs WHERE playlist_id = $1 ORDER BY position, song_id",
        vec![playlist_id.into()],
    ))
    .all(db)
    .await?;
    Ok(PlaylistDetail {
        header,
        my_role,
        members,
        entries,
    })
}

/// Renames or redescribes. Owner only. Returns the new version.
pub async fn update_details(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
    name: Option<&str>,
    description: Option<&str>,
    expected_version: Option<i64>,
) -> Result<i64, CadenzaError> {
    if name.is_none() && description.is_none() {
        return Err(CadenzaError::InvalidRequestBody(
            "set a name or a description".into(),
        ));
    }
    let name = name.map(|name| check_name(name, "playlist")).transpose()?;
    let description = description.map(|d| d.trim().to_owned());
    if description
        .as_ref()
        .is_some_and(|d| d.chars().count() > 500)
    {
        return Err(CadenzaError::InvalidRequestBody(
            "a description is at most 500 characters".into(),
        ));
    }
    let txn = db.begin().await?;
    lock_for(
        &txn,
        playlist_id,
        user_id,
        PlaylistAction::EditDetails,
        expected_version,
    )
    .await?;
    txn.execute_raw(stmt(
        "UPDATE shared_playlists
         SET name = COALESCE($2, name), description = COALESCE($3, description)
         WHERE playlist_id = $1",
        vec![playlist_id.into(), name.into(), description.into()],
    ))
    .await?;
    let version = bump(&txn, playlist_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Deletes the playlist and revokes its codes. Owner only.
pub async fn delete_playlist(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
) -> Result<(), CadenzaError> {
    let txn = db.begin().await?;
    lock_for(&txn, playlist_id, user_id, PlaylistAction::Delete, None).await?;
    revoke_invites_for(&txn, &InviteTargetRef::SharedPlaylist(playlist_id)).await?;
    txn.execute_raw(stmt(
        "DELETE FROM shared_playlists WHERE playlist_id = $1",
        vec![playlist_id.into()],
    ))
    .await?;
    txn.commit().await?;
    Ok(())
}

/// The ids in `song_ids`, first occurrence kept.
fn unique_in_order(song_ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut unique = Vec::with_capacity(song_ids.len());
    for id in song_ids {
        if seen.insert(id.as_str()) {
            unique.push(id.clone());
        }
    }
    unique
}

/// Inserts songs at `position` (or the end), shifting what was there. A song
/// already in the playlist is left where it is. Returns whether any row was
/// inserted.
async fn insert_songs(
    txn: &DatabaseTransaction,
    playlist_id: i64,
    added_by: Uuid,
    song_ids: &[String],
    position: Option<i32>,
) -> Result<bool, CadenzaError> {
    let song_ids = unique_in_order(song_ids);
    if song_ids.is_empty() {
        return Ok(false);
    }
    let present: HashSet<String> = txn
        .query_all_raw(stmt(
            "SELECT song_id FROM shared_playlist_songs
             WHERE playlist_id = $1 AND song_id = ANY($2)",
            vec![playlist_id.into(), song_ids.clone().into()],
        ))
        .await?
        .iter()
        .map(|row| row.try_get::<String>("", "song_id"))
        .collect::<Result<_, _>>()?;
    let fresh: Vec<String> = song_ids
        .into_iter()
        .filter(|id| !present.contains(id))
        .collect();
    if fresh.is_empty() {
        return Ok(false);
    }
    let count_row = txn
        .query_one_raw(stmt(
            "SELECT COUNT(*) AS n FROM shared_playlist_songs WHERE playlist_id = $1",
            vec![playlist_id.into()],
        ))
        .await?
        .ok_or_else(|| CadenzaError::DatabaseError("count returned nothing".into()))?;
    let count: i64 = count_row.try_get("", "n")?;
    if count as usize + fresh.len() > MAX_PLAYLIST_SONGS {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "a shared playlist holds at most {MAX_PLAYLIST_SONGS} songs"
        )));
    }
    let at = position.unwrap_or(count as i32).clamp(0, count as i32);
    let added = fresh.len() as i32;
    txn.execute_raw(stmt(
        "UPDATE shared_playlist_songs SET position = position + $3
         WHERE playlist_id = $1 AND position >= $2",
        vec![playlist_id.into(), at.into(), added.into()],
    ))
    .await?;
    txn.execute_raw(stmt(
        "INSERT INTO shared_playlist_songs (playlist_id, song_id, position, added_by)
         SELECT $1, song_id, $2 + ord::int - 1, $3
         FROM unnest($4::text[]) WITH ORDINALITY AS t(song_id, ord)",
        vec![playlist_id.into(), at.into(), added_by.into(), fresh.into()],
    ))
    .await?;
    Ok(true)
}

/// Adds songs at `position`, or the end. A song already in the playlist stays
/// where it is, and a request that adds nothing leaves the version alone.
/// Editor or owner. Returns the version.
pub async fn add_songs(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
    song_ids: &[String],
    position: Option<i32>,
    expected_version: Option<i64>,
) -> Result<i64, CadenzaError> {
    if song_ids.is_empty() {
        return Err(CadenzaError::InvalidRequestBody(
            "add at least one song".into(),
        ));
    }
    check_song_ids(song_ids)?;
    let txn = db.begin().await?;
    let (_, version) = lock_for(
        &txn,
        playlist_id,
        user_id,
        PlaylistAction::EditSongs,
        expected_version,
    )
    .await?;
    if !insert_songs(&txn, playlist_id, user_id, song_ids, position).await? {
        txn.commit().await?;
        return Ok(version);
    }
    renumber(&txn, playlist_id).await?;
    let version = bump(&txn, playlist_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Removes one song. Editor or owner. Returns the new version.
pub async fn remove_song(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
    song_id: &str,
    expected_version: Option<i64>,
) -> Result<i64, CadenzaError> {
    let txn = db.begin().await?;
    lock_for(
        &txn,
        playlist_id,
        user_id,
        PlaylistAction::EditSongs,
        expected_version,
    )
    .await?;
    let removed = txn
        .execute_raw(stmt(
            "DELETE FROM shared_playlist_songs WHERE playlist_id = $1 AND song_id = $2",
            vec![playlist_id.into(), song_id.into()],
        ))
        .await?;
    if removed.rows_affected() == 0 {
        return Err(CadenzaError::NotFound);
    }
    renumber(&txn, playlist_id).await?;
    let version = bump(&txn, playlist_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Moves one song to `to_position` (0 based, clamped). Editor or owner.
/// Returns the new version.
pub async fn move_song(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
    song_id: &str,
    to_position: i32,
    expected_version: Option<i64>,
) -> Result<i64, CadenzaError> {
    let txn = db.begin().await?;
    lock_for(
        &txn,
        playlist_id,
        user_id,
        PlaylistAction::EditSongs,
        expected_version,
    )
    .await?;
    let ids: Vec<String> = txn
        .query_all_raw(stmt(
            "SELECT song_id FROM shared_playlist_songs
             WHERE playlist_id = $1 ORDER BY position, song_id",
            vec![playlist_id.into()],
        ))
        .await?
        .iter()
        .map(|row| row.try_get::<String>("", "song_id"))
        .collect::<Result<_, _>>()?;
    let song_id = song_id.to_owned();
    let order = moved_order(&ids, &song_id, to_position).ok_or(CadenzaError::NotFound)?;
    write_song_order(
        &txn,
        "shared_playlist_songs",
        "playlist_id",
        playlist_id,
        &order,
    )
    .await?;
    let version = bump(&txn, playlist_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Adds `member_id` directly, as `role` (viewer or editor). Owner only, and
/// only when `member_id`'s `playlist_add` setting lets the owner. Adding an
/// existing member changes nothing. Returns the new version.
pub async fn add_member(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
    member_id: Uuid,
    role: PlaylistRole,
) -> Result<i64, CadenzaError> {
    if role == PlaylistRole::Owner {
        return Err(CadenzaError::InvalidRequestBody(
            "a playlist has one owner".into(),
        ));
    }
    if !can_see_field(db, user_id, member_id, PrivacyField::PlaylistAdd).await? {
        return Err(CadenzaError::Forbidden(
            "their privacy settings do not let you add them, send them a code".into(),
        ));
    }
    let txn = db.begin().await?;
    lock_for(
        &txn,
        playlist_id,
        user_id,
        PlaylistAction::ManageMembers,
        None,
    )
    .await?;
    txn.execute_raw(stmt(
        "INSERT INTO shared_playlist_members (playlist_id, user_id, role)
         VALUES ($1, $2, $3::playlist_role) ON CONFLICT DO NOTHING",
        vec![playlist_id.into(), member_id.into(), role.into()],
    ))
    .await?;
    let version = bump(&txn, playlist_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Joins through a redeemed code as `role`, at most editor. Someone already
/// in keeps the higher of the two roles. Returns the new version.
pub async fn join_by_code(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
    role: PlaylistRole,
) -> Result<i64, CadenzaError> {
    let role = match role {
        PlaylistRole::Owner => PlaylistRole::Editor,
        role => role,
    };
    let txn = db.begin().await?;
    let playlist = txn
        .query_one_raw(stmt(
            "SELECT owner_id FROM shared_playlists WHERE playlist_id = $1 FOR UPDATE",
            vec![playlist_id.into()],
        ))
        .await?
        .ok_or(CadenzaError::NotFound)?;
    let owner: Uuid = playlist.try_get("", "owner_id")?;
    if crate::db::friend_relations::blocked_either_way(&txn, user_id, owner).await? {
        return Err(CadenzaError::UserBlocked);
    }
    let current = member_role(&txn, playlist_id, user_id).await?;
    let upgrade = current == Some(PlaylistRole::Viewer) && role == PlaylistRole::Editor;
    if current.is_none() || upgrade {
        txn.execute_raw(stmt(
            "INSERT INTO shared_playlist_members (playlist_id, user_id, role)
             VALUES ($1, $2, $3::playlist_role)
             ON CONFLICT (playlist_id, user_id) DO UPDATE SET role = EXCLUDED.role",
            vec![playlist_id.into(), user_id.into(), role.into()],
        ))
        .await?;
    }
    let version = bump(&txn, playlist_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Changes a member's role to viewer or editor. Owner only. Returns the new
/// version.
pub async fn set_member_role(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
    member_id: Uuid,
    role: PlaylistRole,
) -> Result<i64, CadenzaError> {
    if role == PlaylistRole::Owner || member_id == user_id {
        return Err(CadenzaError::InvalidRequestBody(
            "the owner's role does not change".into(),
        ));
    }
    let txn = db.begin().await?;
    lock_for(
        &txn,
        playlist_id,
        user_id,
        PlaylistAction::ManageMembers,
        None,
    )
    .await?;
    let updated = txn
        .execute_raw(stmt(
            "UPDATE shared_playlist_members SET role = $3::playlist_role
             WHERE playlist_id = $1 AND user_id = $2 AND role <> 'owner'",
            vec![playlist_id.into(), member_id.into(), role.into()],
        ))
        .await?;
    if updated.rows_affected() == 0 {
        return Err(CadenzaError::NotFound);
    }
    let version = bump(&txn, playlist_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// What removing a member did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemberRemoved {
    /// The playlist is still there, at this version.
    Removed(i64),
    /// The owner left, so the playlist was deleted.
    PlaylistDeleted,
}

/// Removes `member_id`. Anyone can leave; only the owner can remove someone
/// else. The owner leaving deletes the playlist.
pub async fn remove_member(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
    member_id: Uuid,
) -> Result<MemberRemoved, CadenzaError> {
    let leaving = user_id == member_id;
    if leaving && member_role(db, playlist_id, user_id).await? == Some(PlaylistRole::Owner) {
        delete_playlist(db, user_id, playlist_id).await?;
        return Ok(MemberRemoved::PlaylistDeleted);
    }
    let txn = db.begin().await?;
    let action = if leaving {
        PlaylistAction::Read
    } else {
        PlaylistAction::ManageMembers
    };
    lock_for(&txn, playlist_id, user_id, action, None).await?;
    let removed = txn
        .execute_raw(stmt(
            "DELETE FROM shared_playlist_members
             WHERE playlist_id = $1 AND user_id = $2 AND role <> 'owner'",
            vec![playlist_id.into(), member_id.into()],
        ))
        .await?;
    if removed.rows_affected() == 0 {
        return Err(CadenzaError::NotFound);
    }
    let version = bump(&txn, playlist_id).await?;
    txn.commit().await?;
    Ok(MemberRemoved::Removed(version))
}

/// The live code for this playlist and role. Owner only. `role` is what it
/// joins as, viewer when omitted. Returns the one that can still be used, and
/// makes one only when there isn't. A revoked, expired, or used up code does
/// not count.
pub async fn invite_for_role(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
    options: NewInvite,
) -> Result<invite_codes::Model, CadenzaError> {
    let role = match options.grants_role {
        Some(PlaylistRole::Owner) => {
            return Err(CadenzaError::InvalidRequestBody(
                "a playlist code grants viewer or editor".into(),
            ));
        }
        Some(role) => role,
        None => PlaylistRole::Viewer,
    };
    let txn = db.begin().await?;
    if txn
        .query_one_raw(stmt(
            "SELECT 1 FROM shared_playlists WHERE playlist_id = $1 FOR UPDATE",
            vec![playlist_id.into()],
        ))
        .await?
        .is_none()
    {
        return Err(CadenzaError::NotFound);
    }
    check_can_invite(&txn, user_id, playlist_id).await?;
    let target = InviteTargetRef::SharedPlaylist(playlist_id);
    if !options.regenerate
        && let Some(existing) =
            find_live_invite(&txn, &target, Some(role.to_value().value.into_owned())).await?
    {
        txn.commit().await?;
        return Ok(existing);
    }
    let invite = create_invite(
        &txn,
        user_id,
        &target,
        NewInvite {
            grants_role: Some(role),
            ..options
        },
    )
    .await?;
    txn.commit().await?;
    Ok(invite)
}

/// Locks the playlist for a new invite code and checks the caller may make one.
pub async fn check_can_invite(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
) -> Result<(), CadenzaError> {
    let role = member_role(db, playlist_id, user_id)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    if !allowed(role, PlaylistAction::MakeInvite) {
        return Err(CadenzaError::Forbidden(
            "only the owner can make invite codes".into(),
        ));
    }
    Ok(())
}

/// A change to a playlist's songs that the assistant makes, inside the caller's
/// transaction so its activity log row commits with it.
#[derive(Clone, Copy, Debug)]
pub enum SongEdit<'a> {
    Add {
        song_ids: &'a [String],
        position: Option<i32>,
    },
    Remove {
        song_ids: &'a [String],
    },
    Move {
        song_id: &'a str,
        to_position: i32,
    },
}

/// Exactly what a [`SongEdit`] changed.
#[derive(Clone, Debug, Default)]
pub struct SongsEdited {
    /// The songs it put in, leaving out any that were there already.
    pub added: Vec<String>,
    /// The songs it took out, each with where it was and who added it.
    pub removed: Vec<PlaylistEntry>,
    /// The song it moved, from and to, when it moved.
    pub moved: Option<(String, i32, i32)>,
    /// The new version, or None when nothing changed.
    pub version: Option<i64>,
}

/// What putting an edit back did.
#[derive(Clone, Debug, Default)]
pub struct SongsReverted {
    pub reverted: usize,
    /// Songs left alone because they changed since.
    pub skipped: usize,
    /// The new version, or None when nothing changed.
    pub version: Option<i64>,
}

/// The playlist's songs in order, with who added each and when.
pub async fn entries_in<C: ConnectionTrait>(
    db: &C,
    playlist_id: i64,
) -> Result<Vec<PlaylistEntry>, CadenzaError> {
    Ok(PlaylistEntry::find_by_statement(stmt(
        "SELECT song_id, position, added_by, added_at
         FROM shared_playlist_songs WHERE playlist_id = $1 ORDER BY position, song_id",
        vec![playlist_id.into()],
    ))
    .all(db)
    .await?)
}

/// Makes `edit` in `txn`: locks the playlist, checks the caller may edit its songs, and
/// bumps the version when anything changed. Returns exactly what changed, for the
/// assistant's activity log. Library only songs are refused like `add_songs` refuses them.
pub async fn edit_songs_in(
    txn: &DatabaseTransaction,
    user_id: Uuid,
    playlist_id: i64,
    edit: SongEdit<'_>,
) -> Result<SongsEdited, CadenzaError> {
    lock_for(txn, playlist_id, user_id, PlaylistAction::EditSongs, None).await?;
    let before = entries_in(txn, playlist_id).await?;
    let mut edited = SongsEdited::default();
    match edit {
        SongEdit::Add { song_ids, position } => {
            check_song_ids(song_ids)?;
            let present: HashSet<&str> = before.iter().map(|e| e.song_id.as_str()).collect();
            edited.added = unique_in_order(song_ids)
                .into_iter()
                .filter(|id| !present.contains(id.as_str()))
                .collect();
            if !insert_songs(txn, playlist_id, user_id, &edited.added, position).await? {
                edited.added.clear();
                return Ok(edited);
            }
            renumber(txn, playlist_id).await?;
        }
        SongEdit::Remove { song_ids } => {
            let wanted: HashSet<&str> = song_ids.iter().map(String::as_str).collect();
            edited.removed = before
                .iter()
                .filter(|e| wanted.contains(e.song_id.as_str()))
                .cloned()
                .collect();
            if edited.removed.is_empty() {
                return Ok(edited);
            }
            let ids: Vec<String> = edited.removed.iter().map(|e| e.song_id.clone()).collect();
            txn.execute_raw(stmt(
                "DELETE FROM shared_playlist_songs WHERE playlist_id = $1 AND song_id = ANY($2)",
                vec![playlist_id.into(), ids.into()],
            ))
            .await?;
            renumber(txn, playlist_id).await?;
        }
        SongEdit::Move {
            song_id,
            to_position,
        } => {
            let ids: Vec<String> = before.iter().map(|e| e.song_id.clone()).collect();
            let song_id = song_id.to_owned();
            let order = moved_order(&ids, &song_id, to_position).ok_or(CadenzaError::NotFound)?;
            if order == ids {
                return Ok(edited);
            }
            let from = ids.iter().position(|id| *id == song_id).unwrap_or_default() as i32;
            let to = order
                .iter()
                .position(|id| *id == song_id)
                .unwrap_or_default() as i32;
            write_song_order(
                txn,
                "shared_playlist_songs",
                "playlist_id",
                playlist_id,
                &order,
            )
            .await?;
            edited.moved = Some((song_id, from, to));
        }
    }
    edited.version = Some(bump(txn, playlist_id).await?);
    Ok(edited)
}

/// Puts back one [`edit_songs_in`] in `txn`, leaving alone what changed since: an added
/// song someone already took out, a removed song someone already put back, a moved song
/// that is not where the move left it. Needs the caller to still be able to edit songs.
pub async fn revert_songs_in(
    txn: &DatabaseTransaction,
    user_id: Uuid,
    playlist_id: i64,
    added: &[String],
    removed: &[PlaylistEntry],
    moved: Option<(&str, i32, i32)>,
) -> Result<SongsReverted, CadenzaError> {
    lock_for(txn, playlist_id, user_id, PlaylistAction::EditSongs, None).await?;
    let now = entries_in(txn, playlist_id).await?;
    let mut order: Vec<String> = now.iter().map(|e| e.song_id.clone()).collect();
    let mut reverted = SongsReverted::default();

    let added: HashSet<&str> = added.iter().map(String::as_str).collect();
    let before_len = order.len();
    order.retain(|id| !added.contains(id.as_str()));
    let taken_out = before_len - order.len();
    reverted.reverted += taken_out;
    reverted.skipped += added.len() - taken_out;

    let mut back: Vec<&PlaylistEntry> = removed
        .iter()
        .filter(|e| !order.contains(&e.song_id))
        .collect();
    reverted.skipped += removed.len() - back.len();
    if order.len() + back.len() > MAX_PLAYLIST_SONGS {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "a shared playlist holds at most {MAX_PLAYLIST_SONGS} songs"
        )));
    }
    back.sort_by_key(|e| e.position);
    for entry in &back {
        let at = (entry.position.max(0) as usize).min(order.len());
        order.insert(at, entry.song_id.clone());
    }
    reverted.reverted += back.len();

    if let Some((song_id, from, to)) = moved {
        match order.iter().position(|id| id == song_id) {
            Some(at) if at as i32 == to => {
                let song_id = song_id.to_owned();
                order = moved_order(&order, &song_id, from).unwrap_or(order);
                reverted.reverted += 1;
            }
            _ => reverted.skipped += 1,
        }
    }

    if !added.is_empty() && taken_out > 0 {
        let ids: Vec<String> = added.iter().map(|id| (*id).to_owned()).collect();
        txn.execute_raw(stmt(
            "DELETE FROM shared_playlist_songs WHERE playlist_id = $1 AND song_id = ANY($2)",
            vec![playlist_id.into(), ids.into()],
        ))
        .await?;
    }
    if !back.is_empty() {
        let rows: Vec<serde_json::Value> = back
            .iter()
            .map(|e| {
                serde_json::json!({
                    "song_id": e.song_id,
                    "added_by": e.added_by,
                    "added_at": e.added_at.to_rfc3339(),
                })
            })
            .collect();
        txn.execute_raw(stmt(
            "INSERT INTO shared_playlist_songs (playlist_id, song_id, position, added_by, added_at)
             SELECT $1, t.song_id, 0, t.added_by, t.added_at
             FROM jsonb_to_recordset($2) AS t(song_id text, added_by uuid, added_at timestamptz)
             ON CONFLICT DO NOTHING",
            vec![
                playlist_id.into(),
                sea_orm::Value::Json(Some(Box::new(serde_json::Value::from(rows)))),
            ],
        ))
        .await?;
    }
    if reverted.reverted > 0 {
        write_song_order(
            txn,
            "shared_playlist_songs",
            "playlist_id",
            playlist_id,
            &order,
        )
        .await?;
        reverted.version = Some(bump(txn, playlist_id).await?);
    }
    Ok(reverted)
}

/// The name and description before and after a [`update_details_in`].
#[derive(Clone, Debug)]
pub struct DetailsChanged {
    pub old_name: String,
    pub new_name: String,
    pub old_description: String,
    pub new_description: String,
    pub version: i64,
}

/// [`update_details`] in the caller's transaction, returning the old and new values.
/// Owner only. With `only_if` set, changes it only while the name and description are
/// still those, for an undo that leaves a later rename alone; None then means they
/// changed since.
pub async fn update_details_in(
    txn: &DatabaseTransaction,
    user_id: Uuid,
    playlist_id: i64,
    name: Option<&str>,
    description: Option<&str>,
    only_if: Option<(&str, &str)>,
) -> Result<Option<DetailsChanged>, CadenzaError> {
    let name = name.map(|name| check_name(name, "playlist")).transpose()?;
    let description = description.map(|d| d.trim().to_owned());
    if description
        .as_ref()
        .is_some_and(|d| d.chars().count() > 500)
    {
        return Err(CadenzaError::InvalidRequestBody(
            "a description is at most 500 characters".into(),
        ));
    }
    lock_for(txn, playlist_id, user_id, PlaylistAction::EditDetails, None).await?;
    let row = txn
        .query_one_raw(stmt(
            "SELECT name, description FROM shared_playlists WHERE playlist_id = $1",
            vec![playlist_id.into()],
        ))
        .await?
        .ok_or(CadenzaError::NotFound)?;
    let old_name: String = row.try_get("", "name")?;
    let old_description: String = row.try_get("", "description")?;
    if let Some((name_now, description_now)) = only_if
        && (old_name != name_now || old_description != description_now)
    {
        return Ok(None);
    }
    let new_name = name.unwrap_or_else(|| old_name.clone());
    let new_description = description.unwrap_or_else(|| old_description.clone());
    txn.execute_raw(stmt(
        "UPDATE shared_playlists SET name = $2, description = $3 WHERE playlist_id = $1",
        vec![
            playlist_id.into(),
            new_name.clone().into(),
            new_description.clone().into(),
        ],
    ))
    .await?;
    let version = bump(txn, playlist_id).await?;
    Ok(Some(DetailsChanged {
        old_name,
        new_name,
        old_description,
        new_description,
        version,
    }))
}

/// The playlist's name and the caller's role, or `NotFound` for a non member.
pub async fn name_and_role(
    db: &impl Db,
    user_id: Uuid,
    playlist_id: i64,
) -> Result<(String, String, PlaylistRole), CadenzaError> {
    let role = member_role(db, playlist_id, user_id)
        .await?
        .ok_or(CadenzaError::NotFound)?;
    let row = db
        .query_one_raw(stmt(
            "SELECT name, description FROM shared_playlists WHERE playlist_id = $1",
            vec![playlist_id.into()],
        ))
        .await?
        .ok_or(CadenzaError::NotFound)?;
    Ok((
        row.try_get("", "name")?,
        row.try_get("", "description")?,
        role,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_allow_what_the_table_says() {
        use PlaylistAction::*;
        use PlaylistRole::*;
        assert!(allowed(Viewer, Read));
        assert!(!allowed(Viewer, EditSongs));
        assert!(allowed(Editor, EditSongs));
        assert!(!allowed(Editor, ManageMembers));
        assert!(!allowed(Editor, Delete));
        for action in [
            Read,
            EditSongs,
            EditDetails,
            ManageMembers,
            MakeInvite,
            Delete,
        ] {
            assert!(allowed(Owner, action));
        }
    }

    #[test]
    fn library_songs_cannot_be_added() {
        assert!(check_song_ids(&["123".into()]).is_ok());
        assert!(check_song_ids(&["i.abc".into()]).is_err());
    }
}
