use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use axum_jwt_auth::Claims;
use chrono::Utc;
use sea_orm::{DatabaseConnection, prelude::Uuid};
use serde::Deserialize;

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        listening_history::recent_plays_for_viewer,
        now_playing::{
            clear_now_playing, friends_listening, now_playing_for_viewer, upsert_now_playing,
        },
    },
    err::CadenzaError,
    routes::json::{
        listening::{
            FriendListening, FriendsListeningResponse, NowPlaying, PutNowPlaying,
            UserListeningResponse,
        },
        vec_into,
    },
};

/// How many recent plays `GET /listening/users/{user_id}` returns by default.
const DEFAULT_RECENT_PLAYS: u64 = 20;

/// Replaces the signed-in user's now playing state. The server stamps the
/// position with its own clock. `InvalidRequestBody` for a library song id.
/// Responds with `null`.
async fn put_now_playing(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<PutNowPlaying>,
) -> Result<Json<()>, CadenzaError> {
    upsert_now_playing(&db, claims.user_id, payload.into()).await?;
    Ok(Json(()))
}

/// Clears the signed-in user's now playing state. Responds with `null`.
async fn delete_now_playing(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<()>, CadenzaError> {
    clear_now_playing(&db, claims.user_id).await?;
    Ok(Json(()))
}

/// Friends playing something now who let friends see it, most recently
/// updated first. `position_ms` is projected to `as_of`.
///
/// ```json
/// { "listening": [ { "user_id": "...", "username": "ada", "now_playing": { "song_id": "1440857781", "title": "Motion Sickness", "artist": "Phoebe Bridgers", "album": "Stranger in the Alps", "artwork_url": "https://...", "duration_ms": 229000, "position_ms": 61000, "as_of": "2026-11-10T18:00:00Z", "live_session_id": null, "up_next": [ { "song_id": "1440857790", "title": "Kyoto", "artist": "Phoebe Bridgers", "artwork_url": "https://..." } ] } } ] }
/// ```
async fn get_friends_listening(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<FriendsListeningResponse>, CadenzaError> {
    let users = friends_listening(&db, claims.user_id).await?;
    let now = Utc::now();
    Ok(Json(FriendsListeningResponse {
        listening: users
            .into_iter()
            .map(|user| FriendListening::at(user, now))
            .collect(),
    }))
}

#[derive(Deserialize)]
struct UserListeningQuery {
    limit: Option<u64>,
}

/// One user's now playing and recent plays, each gated by their privacy
/// settings. `now_playing` is null when nothing is playing or it is hidden,
/// `recent_plays` is null when hidden. `limit` is at most 50, default 20.
///
/// ```json
/// { "user_id": "...", "now_playing": null, "recent_plays": [ { "song_id": "1440857781", "played_at": "2026-11-10T17:40:00Z", "artist_name": "Phoebe Bridgers", "album_name": "Stranger in the Alps" } ] }
/// ```
async fn get_user_listening(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(user_id): Path<Uuid>,
    Query(query): Query<UserListeningQuery>,
) -> Result<Json<UserListeningResponse>, CadenzaError> {
    let limit = query.limit.unwrap_or(DEFAULT_RECENT_PLAYS);
    let now_playing = now_playing_for_viewer(&db, claims.user_id, user_id).await?;
    let recent_plays = recent_plays_for_viewer(&db, claims.user_id, user_id, limit).await?;
    let now = Utc::now();
    Ok(Json(UserListeningResponse {
        user_id,
        now_playing: now_playing.map(|row| NowPlaying::at(row, now)),
        recent_plays: recent_plays.map(vec_into),
    }))
}

pub fn get_listening_router() -> Router<AppState> {
    Router::new()
        .route(
            "/now-playing",
            axum::routing::put(put_now_playing).delete(delete_now_playing),
        )
        .route("/friends", get(get_friends_listening))
        .route("/users/{user_id}", get(get_user_listening))
}
