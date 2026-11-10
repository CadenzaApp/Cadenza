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

use chrono::{DateTime, FixedOffset};
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DatabaseTransaction, DbBackend, FromQueryResult,
    Statement, TransactionTrait, Value, prelude::Uuid,
};

use crate::db::{
    audience::{PrivacyField, can_see_field},
    invites::{InviteTargetRef, revoke_invites_for},
    now_playing::is_catalog_id,
};
use crate::err::CadenzaError;

/// The most songs one playlist holds, and one add can carry.
pub const MAX_PLAYLIST_SONGS: usize = 1000;
pub const MAX_SONGS_PER_ADD: usize = 200;

/// A member's role. Ordered, so a check is `role >= Role::Editor`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum PlaylistRole {
    Viewer,
    Editor,
    Owner,
}

impl PlaylistRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Viewer => "viewer",
            Self::Editor => "editor",
            Self::Owner => "owner",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "viewer" => Some(Self::Viewer),
            "editor" => Some(Self::Editor),
            "owner" => Some(Self::Owner),
            _ => None,
        }
    }
}

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
        PlaylistAction::EditSongs => role >= PlaylistRole::Editor,
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
    pub role: String,
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
    pub role: String,
    pub joined_at: DateTime<FixedOffset>,
}

#[derive(Clone, Debug, FromQueryResult)]
pub struct PlaylistEntry {
    pub entry_id: i64,
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

fn stmt(sql: &str, values: Vec<Value>) -> Statement {
    Statement::from_sql_and_values(DbBackend::Postgres, sql, values)
}

/// The caller's role on a playlist, or `None` when they are not a member.
pub async fn member_role<C: ConnectionTrait>(
    db: &C,
    playlist_id: i64,
    user_id: Uuid,
) -> Result<Option<PlaylistRole>, CadenzaError> {
    let row = db
        .query_one_raw(stmt(
            "SELECT role::text AS role FROM shared_playlist_members
             WHERE playlist_id = $1 AND user_id = $2",
            vec![playlist_id.into(), user_id.into()],
        ))
        .await?;
    match row {
        Some(row) => {
            let role: String = row.try_get("", "role")?;
            Ok(PlaylistRole::parse(&role))
        }
        None => Ok(None),
    }
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
            role.as_str()
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
             SELECT entry_id, row_number() OVER (ORDER BY position, entry_id) AS rn
             FROM shared_playlist_songs WHERE playlist_id = $1
         ) r
         WHERE s.entry_id = r.entry_id AND s.position <> r.rn - 1",
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

fn check_name(name: &str) -> Result<String, CadenzaError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(CadenzaError::InvalidRequestBody(
            "a playlist name is 1 to 100 characters".into(),
        ));
    }
    Ok(name.to_owned())
}

/// The caller's shared playlists, most recently changed first.
pub async fn list_my_playlists(
    db: &DatabaseConnection,
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
         ORDER BY p.updated_at DESC",
        vec![user_id.into()],
    ))
    .all(db)
    .await?)
}

/// Makes a playlist owned by `owner_id`, with `song_ids` in it. Returns its id.
pub async fn create_playlist(
    db: &DatabaseConnection,
    owner_id: Uuid,
    name: &str,
    description: &str,
    song_ids: &[String],
) -> Result<i64, CadenzaError> {
    let name = check_name(name)?;
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
    db: &DatabaseConnection,
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
        "SELECT entry_id, song_id, position, added_by, added_at
         FROM shared_playlist_songs WHERE playlist_id = $1 ORDER BY position, entry_id",
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
    db: &DatabaseConnection,
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
    let name = name.map(check_name).transpose()?;
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
    db: &DatabaseConnection,
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

/// Inserts songs at `position` (or the end), shifting what was there.
async fn insert_songs(
    txn: &DatabaseTransaction,
    playlist_id: i64,
    added_by: Uuid,
    song_ids: &[String],
    position: Option<i32>,
) -> Result<(), CadenzaError> {
    if song_ids.is_empty() {
        return Ok(());
    }
    let count_row = txn
        .query_one_raw(stmt(
            "SELECT COUNT(*) AS n FROM shared_playlist_songs WHERE playlist_id = $1",
            vec![playlist_id.into()],
        ))
        .await?
        .ok_or_else(|| CadenzaError::DatabaseError("count returned nothing".into()))?;
    let count: i64 = count_row.try_get("", "n")?;
    if count as usize + song_ids.len() > MAX_PLAYLIST_SONGS {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "a shared playlist holds at most {MAX_PLAYLIST_SONGS} songs"
        )));
    }
    let at = position.unwrap_or(count as i32).clamp(0, count as i32);
    let added = song_ids.len() as i32;
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
        vec![
            playlist_id.into(),
            at.into(),
            added_by.into(),
            text_array(song_ids),
        ],
    ))
    .await?;
    Ok(())
}

/// Adds songs at `position`, or the end. Editor or owner. Returns the new
/// version.
pub async fn add_songs(
    db: &DatabaseConnection,
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
    lock_for(
        &txn,
        playlist_id,
        user_id,
        PlaylistAction::EditSongs,
        expected_version,
    )
    .await?;
    insert_songs(&txn, playlist_id, user_id, song_ids, position).await?;
    renumber(&txn, playlist_id).await?;
    let version = bump(&txn, playlist_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Removes one entry. Editor or owner. Returns the new version.
pub async fn remove_entry(
    db: &DatabaseConnection,
    user_id: Uuid,
    playlist_id: i64,
    entry_id: i64,
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
            "DELETE FROM shared_playlist_songs WHERE playlist_id = $1 AND entry_id = $2",
            vec![playlist_id.into(), entry_id.into()],
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

/// Moves one entry to `to_position` (0 based, clamped). Editor or owner.
/// Returns the new version.
pub async fn move_entry(
    db: &DatabaseConnection,
    user_id: Uuid,
    playlist_id: i64,
    entry_id: i64,
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
    let ids: Vec<i64> = txn
        .query_all_raw(stmt(
            "SELECT entry_id FROM shared_playlist_songs
             WHERE playlist_id = $1 ORDER BY position, entry_id",
            vec![playlist_id.into()],
        ))
        .await?
        .iter()
        .map(|row| row.try_get::<i64>("", "entry_id"))
        .collect::<Result<_, _>>()?;
    let order = moved_order(&ids, entry_id, to_position).ok_or(CadenzaError::NotFound)?;
    txn.execute_raw(stmt(
        "UPDATE shared_playlist_songs s SET position = t.ord::int - 1
         FROM unnest($2::bigint[]) WITH ORDINALITY AS t(entry_id, ord)
         WHERE s.playlist_id = $1 AND s.entry_id = t.entry_id",
        vec![playlist_id.into(), bigint_array(&order)],
    ))
    .await?;
    let version = bump(&txn, playlist_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// `ids` with `entry_id` moved to `to`, clamped to the ends. `None` when it is
/// not there.
pub fn moved_order(ids: &[i64], entry_id: i64, to: i32) -> Option<Vec<i64>> {
    let from = ids.iter().position(|id| *id == entry_id)?;
    let mut order = ids.to_vec();
    let moved = order.remove(from);
    let to = (to.max(0) as usize).min(order.len());
    order.insert(to, moved);
    Some(order)
}

/// Adds `member_id` directly, as `role` (viewer or editor). Owner only, and
/// only when `member_id`'s `playlist_add` setting lets the owner. Adding an
/// existing member changes nothing. Returns the new version.
pub async fn add_member(
    db: &DatabaseConnection,
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
        vec![playlist_id.into(), member_id.into(), role.as_str().into()],
    ))
    .await?;
    let version = bump(&txn, playlist_id).await?;
    txn.commit().await?;
    Ok(version)
}

/// Joins through a redeemed code as `role`. Someone already in keeps the
/// higher of the two roles. Returns the new version.
pub async fn join_by_code(
    db: &DatabaseConnection,
    user_id: Uuid,
    playlist_id: i64,
    role: PlaylistRole,
) -> Result<i64, CadenzaError> {
    let role = role.min(PlaylistRole::Editor);
    let txn = db.begin().await?;
    txn.query_one_raw(stmt(
        "SELECT 1 FROM shared_playlists WHERE playlist_id = $1 FOR UPDATE",
        vec![playlist_id.into()],
    ))
    .await?
    .ok_or(CadenzaError::NotFound)?;
    let current = member_role(&txn, playlist_id, user_id).await?;
    if current.is_none_or(|current| current < role) {
        txn.execute_raw(stmt(
            "INSERT INTO shared_playlist_members (playlist_id, user_id, role)
             VALUES ($1, $2, $3::playlist_role)
             ON CONFLICT (playlist_id, user_id) DO UPDATE SET role = EXCLUDED.role",
            vec![playlist_id.into(), user_id.into(), role.as_str().into()],
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
    db: &DatabaseConnection,
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
            vec![playlist_id.into(), member_id.into(), role.as_str().into()],
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
    db: &DatabaseConnection,
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

/// Locks the playlist for a new invite code and checks the caller may make one.
pub async fn check_can_invite(
    db: &DatabaseConnection,
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

/// The playlist's current version, for an event published after a write that
/// did not return one.
pub async fn current_version(
    db: &DatabaseConnection,
    playlist_id: i64,
) -> Result<Option<i64>, CadenzaError> {
    let row = db
        .query_one_raw(stmt(
            "SELECT version FROM shared_playlists WHERE playlist_id = $1",
            vec![playlist_id.into()],
        ))
        .await?;
    match row {
        Some(row) => Ok(Some(row.try_get("", "version")?)),
        None => Ok(None),
    }
}

pub(crate) fn text_array(items: &[String]) -> Value {
    Value::Array(
        sea_orm::sea_query::ArrayType::String,
        Some(Box::new(
            items
                .iter()
                .map(|item| Value::String(Some(item.clone())))
                .collect(),
        )),
    )
}

pub(crate) fn bigint_array(items: &[i64]) -> Value {
    Value::Array(
        sea_orm::sea_query::ArrayType::BigInt,
        Some(Box::new(
            items
                .iter()
                .map(|item| Value::BigInt(Some(*item)))
                .collect(),
        )),
    )
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
    fn moving_an_entry_reorders_and_clamps() {
        let ids = [10, 20, 30, 40];
        assert_eq!(moved_order(&ids, 10, 2).unwrap(), vec![20, 30, 10, 40]);
        assert_eq!(moved_order(&ids, 40, 0).unwrap(), vec![40, 10, 20, 30]);
        assert_eq!(moved_order(&ids, 20, 99).unwrap(), vec![10, 30, 40, 20]);
        assert_eq!(moved_order(&ids, 20, -5).unwrap(), vec![20, 10, 30, 40]);
        assert!(moved_order(&ids, 99, 0).is_none());
    }

    #[test]
    fn library_songs_cannot_be_added() {
        assert!(check_song_ids(&["123".into()]).is_ok());
        assert!(check_song_ids(&["i.abc".into()]).is_err());
    }

    #[test]
    fn role_strings_round_trip() {
        for role in [
            PlaylistRole::Viewer,
            PlaylistRole::Editor,
            PlaylistRole::Owner,
        ] {
            assert_eq!(PlaylistRole::parse(role.as_str()), Some(role));
        }
        assert!(PlaylistRole::Owner > PlaylistRole::Editor);
    }
}
