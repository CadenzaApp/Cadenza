use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{delete, get, patch, post},
};
use axum_jwt_auth::Claims;
use chrono::Duration;
use sea_orm::{DatabaseConnection, prelude::Uuid};

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        invites::{InviteTargetRef, NewInvite, create_invite},
        shared_playlists::{self as playlists, MemberRemoved},
    },
    err::CadenzaError,
    routes::json::{
        invite::{CreateInvite, Invite},
        shared_playlist::{
            AddSharedPlaylistMember, AddSharedPlaylistSongs, CreateSharedPlaylist,
            CreatedSharedPlaylist, ExpectedVersion, MoveSharedPlaylistSong, PatchSharedPlaylist,
            PlaylistVersion, ProfilePlaylistsResponse, SetSharedPlaylistRole, SharedPlaylistDetail,
            SharedPlaylistsResponse,
        },
        vec_into,
    },
    services::{
        metadata_tags::spawn_store_song_metadata,
        realtime::{EventKind, SharedEventBus, Topic, publish_version},
        song_metadata::SongMetadataService,
    },
};

fn changed(bus: &SharedEventBus, playlist_id: i64, version: i64) -> Json<PlaylistVersion> {
    publish_version(
        bus,
        Topic::SharedPlaylist(playlist_id),
        version,
        EventKind::Playlist,
    );
    Json(PlaylistVersion {
        version: Some(version),
        deleted: false,
    })
}

fn deleted(bus: &SharedEventBus, playlist_id: i64) -> Json<PlaylistVersion> {
    publish_version(
        bus,
        Topic::SharedPlaylist(playlist_id),
        i64::MAX,
        EventKind::Ended,
    );
    Json(PlaylistVersion {
        version: None,
        deleted: true,
    })
}

/// The caller's shared playlists, most recently changed first.
///
/// ```json
/// { "playlists": [ { "playlist_id": 4, "name": "Road trip", "description": "", "owner": { "user_id": "...", "username": "ada" }, "role": "editor", "song_count": 31, "member_count": 3, "cover_song_ids": ["1440857781"], "version": 12, "updated_at": "2026-11-10T18:00:00Z" } ] }
/// ```
async fn list_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<SharedPlaylistsResponse>, CadenzaError> {
    let rows = playlists::list_my_playlists(&db, claims.user_id).await?;
    Ok(Json(SharedPlaylistsResponse {
        playlists: vec_into(rows),
    }))
}

/// One user's shared playlists for their profile, in the shape `GET /` lists, with
/// `role` being theirs. `playlists` is null when their `profile_playlists` setting
/// hides them from the caller. Opening one still needs membership or a code.
///
/// ```json
/// { "playlists": [ { "playlist_id": 4, "name": "Road trip", "description": "", "owner": { "user_id": "...", "username": "ada" }, "role": "owner", "song_count": 31, "member_count": 3, "cover_song_ids": ["1440857781"], "version": 12, "updated_at": "2026-11-10T18:00:00Z" } ] }
/// ```
async fn user_playlists_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<ProfilePlaylistsResponse>, CadenzaError> {
    let rows = playlists::profile_playlists(&db, claims.user_id, user_id).await?;
    Ok(Json(ProfilePlaylistsResponse {
        playlists: rows.map(vec_into),
    }))
}

/// Makes a shared playlist owned by the caller. Catalog song ids only.
///
/// ```json
/// { "playlist_id": 4 }
/// ```
async fn create_handler(
    State(db): State<DatabaseConnection>,
    State(song_meta): State<SongMetadataService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<CreateSharedPlaylist>,
) -> Result<Json<CreatedSharedPlaylist>, CadenzaError> {
    let playlist_id = playlists::create_playlist(
        &db,
        claims.user_id,
        &body.name,
        &body.description,
        &body.song_ids,
    )
    .await?;
    spawn_store_song_metadata(db, song_meta, body.song_ids);
    Ok(Json(CreatedSharedPlaylist { playlist_id }))
}

/// One playlist: details, the caller's role, members, and songs in order.
/// 404 for anyone who is not a member.
///
/// ```json
/// { "playlist_id": 4, "owner_id": "...", "name": "Road trip", "description": "", "version": 12, "my_role": "editor", "members": [ { "user_id": "...", "username": "ada", "role": "owner", "joined_at": "..." } ], "entries": [ { "entry_id": 90, "song_id": "1440857781", "position": 0, "added_by": "...", "added_at": "..." } ], "created_at": "...", "updated_at": "..." }
/// ```
async fn get_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(playlist_id): Path<i64>,
) -> Result<Json<SharedPlaylistDetail>, CadenzaError> {
    let detail = playlists::get_playlist(&db, claims.user_id, playlist_id).await?;
    Ok(Json(detail.into()))
}

/// Renames or redescribes. Owner only. Every write below takes an optional
/// `expected_version`; a stale one is 409 `VersionConflict`, so refetch.
///
/// ```json
/// { "version": 13, "deleted": false }
/// ```
async fn patch_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(playlist_id): Path<i64>,
    Json(body): Json<PatchSharedPlaylist>,
) -> Result<Json<PlaylistVersion>, CadenzaError> {
    let version = playlists::update_details(
        &db,
        claims.user_id,
        playlist_id,
        body.name.as_deref(),
        body.description.as_deref(),
        body.expected_version,
    )
    .await?;
    Ok(changed(&bus, playlist_id, version))
}

/// Deletes the playlist for everyone. Owner only.
///
/// ```json
/// { "version": null, "deleted": true }
/// ```
async fn delete_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(playlist_id): Path<i64>,
) -> Result<Json<PlaylistVersion>, CadenzaError> {
    playlists::delete_playlist(&db, claims.user_id, playlist_id).await?;
    Ok(deleted(&bus, playlist_id))
}

/// Adds catalog songs at `position`, or the end. Editor or owner.
async fn add_songs_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    State(song_meta): State<SongMetadataService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(playlist_id): Path<i64>,
    Json(body): Json<AddSharedPlaylistSongs>,
) -> Result<Json<PlaylistVersion>, CadenzaError> {
    let version = playlists::add_songs(
        &db,
        claims.user_id,
        playlist_id,
        &body.song_ids,
        body.position,
        body.expected_version,
    )
    .await?;
    spawn_store_song_metadata(db, song_meta, body.song_ids);
    Ok(changed(&bus, playlist_id, version))
}

/// Removes one entry. Editor or owner.
async fn remove_song_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path((playlist_id, entry_id)): Path<(i64, i64)>,
    Query(query): Query<ExpectedVersion>,
) -> Result<Json<PlaylistVersion>, CadenzaError> {
    let version = playlists::remove_entry(
        &db,
        claims.user_id,
        playlist_id,
        entry_id,
        query.expected_version,
    )
    .await?;
    Ok(changed(&bus, playlist_id, version))
}

/// Moves one entry to `position`. Editor or owner.
async fn move_song_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path((playlist_id, entry_id)): Path<(i64, i64)>,
    Json(body): Json<MoveSharedPlaylistSong>,
) -> Result<Json<PlaylistVersion>, CadenzaError> {
    let version = playlists::move_entry(
        &db,
        claims.user_id,
        playlist_id,
        entry_id,
        body.position,
        body.expected_version,
    )
    .await?;
    Ok(changed(&bus, playlist_id, version))
}

/// Adds someone directly as `viewer` or `editor`. Owner only, and 403 when
/// their `playlist_add` privacy setting does not let the owner.
async fn add_member_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(playlist_id): Path<i64>,
    Json(body): Json<AddSharedPlaylistMember>,
) -> Result<Json<PlaylistVersion>, CadenzaError> {
    let version =
        playlists::add_member(&db, claims.user_id, playlist_id, body.user_id, body.role).await?;
    Ok(changed(&bus, playlist_id, version))
}

/// Changes a member's role. Owner only.
async fn set_role_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path((playlist_id, member_id)): Path<(i64, Uuid)>,
    Json(body): Json<SetSharedPlaylistRole>,
) -> Result<Json<PlaylistVersion>, CadenzaError> {
    let version =
        playlists::set_member_role(&db, claims.user_id, playlist_id, member_id, body.role).await?;
    Ok(changed(&bus, playlist_id, version))
}

/// Removes a member (owner) or leaves (anyone, with their own id). The owner
/// leaving deletes the playlist.
async fn remove_member_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path((playlist_id, member_id)): Path<(i64, Uuid)>,
) -> Result<Json<PlaylistVersion>, CadenzaError> {
    match playlists::remove_member(&db, claims.user_id, playlist_id, member_id).await? {
        MemberRemoved::Removed(version) => Ok(changed(&bus, playlist_id, version)),
        MemberRemoved::PlaylistDeleted => Ok(deleted(&bus, playlist_id)),
    }
}

/// Makes an invite code. Owner only. `role` is what it joins as, `viewer` by
/// default.
///
/// ```json
/// { "code": "K7M2QX9P", "link": "cadenza://join/K7M2QX9P", "grants_role": "editor", "expires_at": null, "max_uses": null }
/// ```
async fn invite_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(playlist_id): Path<i64>,
    body: Option<Json<CreateInvite>>,
) -> Result<Json<Invite>, CadenzaError> {
    let body = body.map(|Json(body)| body).unwrap_or_default();
    playlists::check_can_invite(&db, claims.user_id, playlist_id).await?;
    let invite = create_invite(
        &db,
        claims.user_id,
        &InviteTargetRef::SharedPlaylist(playlist_id),
        NewInvite {
            grants_role: body.role,
            expires_in: body.expires_in_hours.map(Duration::hours),
            max_uses: body.max_uses,
        },
    )
    .await?;
    Ok(Json(invite.into()))
}

pub fn get_shared_playlists_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_handler).post(create_handler))
        .route("/users/{user_id}", get(user_playlists_handler))
        .route(
            "/{id}",
            get(get_handler).patch(patch_handler).delete(delete_handler),
        )
        .route("/{id}/songs", post(add_songs_handler))
        .route(
            "/{id}/songs/{entry_id}",
            delete(remove_song_handler).patch(move_song_handler),
        )
        .route("/{id}/members", post(add_member_handler))
        .route(
            "/{id}/members/{user_id}",
            patch(set_role_handler).delete(remove_member_handler),
        )
        .route("/{id}/invites", post(invite_handler))
}
