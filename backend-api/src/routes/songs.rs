use std::collections::HashMap;

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        self,
        tags::{get_default_tags_on_songs, get_user_tags_on_song, get_user_tags_on_songs},
    },
    err::CadenzaError,
    routes::json::{
        tag::{AppliedTag, Tag},
        vec_into,
    },
    services::{
        default_tags::ensure_default_tags_generated, song_metadata::SongMetadataService,
        tag_generation::TagGenerationService,
    },
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, patch, post},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct SongIdQueryParams {
    song_id: String,
}

/// Returns the user's tags on one song. Default tags are not included.
async fn get_local_tags_on_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<SongIdQueryParams>,
) -> Result<Json<Vec<AppliedTag>>, CadenzaError> {
    let user_tags = get_user_tags_on_song(&db, claims.user_id, &params.song_id).await?;
    Ok(Json(vec_into(user_tags)))
}

/// Returns the shared default tags on one song, minus the ones the signed in
/// user removed. Every returned tag has a null `user_id` in the database.
///
/// ```json
/// [{"id": 12, "name": "rock", "color": "#808080", "type": "basic"}]
/// ```
///
/// A song that has never had default tags generated gets them generated first, so the
/// first read of a song is slow and every later one is not.
async fn get_default_tags_on_song_handler(
    State(db): State<DatabaseConnection>,
    State(song_meta_service): State<SongMetadataService>,
    State(tag_gen_service): State<TagGenerationService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<SongIdQueryParams>,
) -> Result<Json<Vec<Tag>>, CadenzaError> {
    ensure_default_tags_generated(
        &db,
        &song_meta_service,
        &tag_gen_service,
        std::slice::from_ref(&params.song_id),
    )
    .await?;

    let mut tags_by_song =
        get_default_tags_on_songs(&db, claims.user_id, std::slice::from_ref(&params.song_id))
            .await?;
    Ok(Json(vec_into(
        tags_by_song.remove(&params.song_id).unwrap_or_default(),
    )))
}

/// A list screen asks for a page of songs at a time, so cap it well above the
/// client's batch size but short of something that would blow up the query.
const MAX_BATCH_SONG_IDS: usize = 200;

/// Returns a `QueryFormatError` if a request names more than [`MAX_BATCH_SONG_IDS`] songs.
fn check_batch_size(song_count: usize) -> Result<(), CadenzaError> {
    if song_count > MAX_BATCH_SONG_IDS {
        return Err(CadenzaError::QueryFormatError(format!(
            "requests are limited to {MAX_BATCH_SONG_IDS} songs"
        )));
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct SongIdsPayload {
    song_ids: Vec<String>,
}

/// Returns the user's tags on each requested song, keyed by song id. Default
/// tags are not included. A song with no user tags gets an empty list.
async fn get_local_tags_on_songs_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<SongIdsPayload>,
) -> Result<Json<HashMap<String, Vec<AppliedTag>>>, CadenzaError> {
    check_batch_size(payload.song_ids.len())?;

    let tags_by_song = get_user_tags_on_songs(&db, claims.user_id, &payload.song_ids).await?;

    Ok(Json(
        tags_by_song
            .into_iter()
            .map(|(song_id, tags)| (song_id, vec_into(tags)))
            .collect(),
    ))
}

/// Returns the shared default tags on each requested song, minus the ones the
/// signed in user removed, keyed by song id. A song with no default tags left
/// gets an empty list.
///
/// ```json
/// {"1234567": [{"id": 12, "name": "rock", "color": "#808080", "type": "basic"}]}
/// ```
///
/// Any requested song that has never had default tags generated gets them generated
/// first, in one batch, so the first read of a page of new songs is slow.
async fn get_default_tags_on_songs_handler(
    State(db): State<DatabaseConnection>,
    State(song_meta_service): State<SongMetadataService>,
    State(tag_gen_service): State<TagGenerationService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<SongIdsPayload>,
) -> Result<Json<HashMap<String, Vec<Tag>>>, CadenzaError> {
    check_batch_size(payload.song_ids.len())?;

    ensure_default_tags_generated(&db, &song_meta_service, &tag_gen_service, &payload.song_ids)
        .await?;

    let mut tags_by_song =
        get_default_tags_on_songs(&db, claims.user_id, &payload.song_ids).await?;

    // the db read leaves out songs with no defaults, but a caller keyed on the
    // request should not have to tell "none" apart from "missing"
    Ok(Json(
        payload
            .song_ids
            .into_iter()
            .map(|song_id| {
                let tags = tags_by_song.remove(&song_id).unwrap_or_default();
                (song_id, vec_into(tags))
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct ApplyTagPayload {
    song_id: String,
    tag_id: i64,
    /// Only meaningful for attribute tags. Omitting it applies the tag without a value.
    #[serde(default)]
    value: Option<String>,
}

async fn apply_user_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<ApplyTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::apply_user_tag(
        db,
        claims.user_id,
        payload.song_id,
        payload.tag_id,
        payload.value,
    )
    .await
}

#[derive(Deserialize)]
pub struct SetTagValuePayload {
    song_id: String,
    tag_id: i64,
    /// `null` clears the value while leaving the tag applied.
    #[serde(default)]
    value: Option<String>,
}

async fn set_user_tag_value_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<SetTagValuePayload>,
) -> Result<(), CadenzaError> {
    db::tags::set_user_tag_value(
        db,
        claims.user_id,
        payload.song_id,
        payload.tag_id,
        payload.value,
    )
    .await
}

#[derive(Deserialize)]
pub struct RemoveDefaultTagPayload {
    song_id: String,
    tag_id: i64,
}

/// Removes one of the song's suggested tags for the signed in user, and counts
/// the removal against that tag name on the song. Returns an empty body.
///
/// The default tag stays on the song. Removing it again does nothing, and the
/// removal is only remembered for this user. 404 if the tag is not one of the
/// song's default tags.
async fn remove_default_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<RemoveDefaultTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::remove_default_tag_from_song(db, claims.user_id, payload.song_id, payload.tag_id)
        .await
}

#[derive(Deserialize)]
pub struct UnapplyTagPayload {
    song_id: String,
    tag_id: i64,
}

async fn unapply_user_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<UnapplyTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::unapply_user_tag(db, claims.user_id, payload.song_id, payload.tag_id).await
}

#[derive(Deserialize)]
pub struct EditUserSongsPayload {
    #[serde(default)]
    add: Vec<String>,
    #[serde(default)]
    remove: Vec<String>,
}

/// Adds songs to and removes songs from the signed in user's library. Returns an empty body.
///
/// ```json
/// {"add": ["1440857781"], "remove": ["1613861891"]}
/// ```
///
/// Both lists are optional. Adding a song the user already has, or removing one they do
/// not, does nothing. Default tags are not touched here; they are generated lazily the
/// first time something reads them. A removed song keeps the user's tags on it.
async fn edit_user_songs_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<EditUserSongsPayload>,
) -> Result<(), CadenzaError> {
    check_batch_size(payload.add.len() + payload.remove.len())?;

    db::user_songs::edit_user_songs(&db, claims.user_id, &payload.add, &payload.remove).await
}

pub fn get_songs_router() -> Router<AppState> {
    Router::new()
        .route("/", patch(edit_user_songs_handler))
        .route(
            "/default-tags",
            get(get_default_tags_on_song_handler).delete(remove_default_tag_handler),
        )
        .route(
            "/default-tags/batch",
            post(get_default_tags_on_songs_handler),
        )
        .route(
            "/local-tags",
            get(get_local_tags_on_song_handler)
                .post(apply_user_tag_handler)
                .patch(set_user_tag_value_handler)
                .delete(unapply_user_tag_handler),
        )
        .route("/local-tags/batch", post(get_local_tags_on_songs_handler))
}
