use std::collections::HashMap;

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        self,
        activity_tags::{get_activity_tags_on_songs, record_play},
        tags::{
            apply_user_tags_to_songs, get_default_tags_on_songs, get_user_tags_on_song,
            get_user_tags_on_songs, unapply_user_tags_from_songs,
        },
    },
    err::CadenzaError,
    routes::json::{
        metadata_tag::{MetadataTag, metadata_tags_of},
        tag::{AppliedTag, Tag},
        vec_into,
    },
    services::{
        default_tags::ensure_default_tags_generated,
        metadata_tags::{
            MetadataCrawler, get_song_metadata_for_display, record_song_opened,
            spawn_store_song_metadata,
        },
        song_metadata::SongMetadataService,
        tag_generation::TagGenerationService,
    },
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, patch, post},
};
use axum_jwt_auth::Claims;
use chrono::Utc;
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
/// first read of a song is slow and every later one is not. Afterwards the song's Apple Music
/// metadata is stored for queries, on its own task, if it was not already.
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
    spawn_store_song_metadata(db.clone(), song_meta_service, vec![params.song_id.clone()]);

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
const MAX_BATCH_TAG_EDITS: usize = 4_000;

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

#[derive(Deserialize)]
pub struct BatchEditTagsPayload {
    song_ids: Vec<String>,
    tag_ids: Vec<i64>,
}

fn check_tag_edit_batch_size(payload: &BatchEditTagsPayload) -> Result<(), CadenzaError> {
    check_batch_size(payload.song_ids.len())?;
    let edit_count = payload.song_ids.len().saturating_mul(payload.tag_ids.len());
    if edit_count > MAX_BATCH_TAG_EDITS {
        return Err(CadenzaError::QueryFormatError(format!(
            "requests are limited to {MAX_BATCH_TAG_EDITS} song/tag edits"
        )));
    }
    Ok(())
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
/// first, in one batch, so the first read of a page of new songs is slow. Afterwards their
/// Apple Music metadata is stored for queries, on its own task, for the ones that had none.
/// Every song list in the app reads through here, which is what makes any song a user has
/// seen queryable by its metadata.
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
    spawn_store_song_metadata(db.clone(), song_meta_service, payload.song_ids.clone());

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

/// Returns every activity tag on one song for the signed in user, with its
/// value, in display order. A song they never played still gets every tag:
/// My Plays reads `"0"` and the dates read `null`.
///
/// ```json
/// [
///   {"id": 41, "name": "My Plays", "color": "#0ea5e9", "type": "number", "is_activity": true, "value": "3"},
///   {"id": 42, "name": "First Played", "color": "#22c55e", "type": "datetime", "is_activity": true, "value": "2026-09-20T18:03:11.482913+00:00"},
///   {"id": 43, "name": "Last Played", "color": "#f59e0b", "type": "datetime", "is_activity": true, "value": "2026-09-23T09:14:02.100000+00:00"}
/// ]
/// ```
async fn get_activity_tags_on_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<SongIdQueryParams>,
) -> Result<Json<Vec<AppliedTag>>, CadenzaError> {
    let mut tags_by_song =
        get_activity_tags_on_songs(&db, claims.user_id, std::slice::from_ref(&params.song_id))
            .await?;
    Ok(Json(vec_into(
        tags_by_song.remove(&params.song_id).unwrap_or_default(),
    )))
}

/// Returns one song's metadata tags: its Apple Music metadata as stored for queries, typed
/// the way a query reads it, in a fixed order. A song with no stored metadata is stored
/// first. A song Apple has no catalog entry for returns an empty list.
///
/// ```json
/// [
///   {"key": "title", "type": "text", "value": "Purple Rain"},
///   {"key": "artist", "type": "text", "value": "Prince"},
///   {"key": "album", "type": "text", "value": "Purple Rain"},
///   {"key": "genre", "type": "text", "value": "Pop, R&B/Soul"},
///   {"key": "release_date", "type": "date", "value": "1984-06-25"},
///   {"key": "duration", "type": "number", "value": "521000"},
///   {"key": "explicit", "type": "checkbox", "value": "false"}
/// ]
/// ```
///
/// Not user scoped: the metadata belongs to the song, but it still takes a signed in caller.
async fn get_metadata_tags_on_song_handler(
    State(db): State<DatabaseConnection>,
    State(song_meta_service): State<SongMetadataService>,
    _: Claims<SupabaseClaims>, // must have credentials to use this route
    Query(params): Query<SongIdQueryParams>,
) -> Result<Json<Vec<MetadataTag>>, CadenzaError> {
    let row = get_song_metadata_for_display(&db, &song_meta_service, &params.song_id).await?;
    Ok(Json(row.as_ref().map(metadata_tags_of).unwrap_or_default()))
}

/// Same as `GET /songs/activity-tags` for many songs at once, keyed by song id.
/// Every requested song gets an entry, with every activity tag.
///
/// ```json
/// {"1234567": [{"id": 41, "name": "My Plays", "color": "#0ea5e9", "type": "number", "is_activity": true, "value": "0"}, ...]}
/// ```
async fn get_activity_tags_on_songs_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<SongIdsPayload>,
) -> Result<Json<HashMap<String, Vec<AppliedTag>>>, CadenzaError> {
    check_batch_size(payload.song_ids.len())?;

    let tags_by_song = get_activity_tags_on_songs(&db, claims.user_id, &payload.song_ids).await?;

    Ok(Json(
        tags_by_song
            .into_iter()
            .map(|(song_id, tags)| (song_id, vec_into(tags)))
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct RecordPlayPayload {
    song_id: String,
}

/// Counts one play of the song for the signed in user, at the server's clock:
/// adds 1 to My Plays and moves First Played / Last Played as needed. Returns
/// an empty body. The client decides what counts as a play and calls this
/// once per play.
async fn record_play_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<RecordPlayPayload>,
) -> Result<(), CadenzaError> {
    if payload.song_id.trim().is_empty() {
        return Err(CadenzaError::QueryFormatError(
            "song_id cannot be blank".to_string(),
        ));
    }
    record_play(&db, claims.user_id, &payload.song_id, Utc::now()).await
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

/// Applies every requested tag to every requested song. Existing applications
/// are preserved, including attribute values. Returns an empty body.
async fn apply_user_tags_to_songs_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<BatchEditTagsPayload>,
) -> Result<(), CadenzaError> {
    check_tag_edit_batch_size(&payload)?;
    apply_user_tags_to_songs(&db, claims.user_id, &payload.song_ids, &payload.tag_ids).await
}

/// Removes every requested tag from every requested song. Missing applications
/// are ignored. Returns an empty body.
async fn unapply_user_tags_from_songs_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<BatchEditTagsPayload>,
) -> Result<(), CadenzaError> {
    check_tag_edit_batch_size(&payload)?;
    unapply_user_tags_from_songs(&db, claims.user_id, &payload.song_ids, &payload.tag_ids).await
}

#[derive(Deserialize)]
pub struct SongOpenedPayload {
    song_id: String,
}

/// Tells the backend a song was opened in the player. Returns an empty body.
///
/// ```json
/// {"song_id": "1440857781"}
/// ```
///
/// Stores the song's Apple Music metadata for queries if it has none, queues the song's
/// album, and wakes the metadata crawl so the rest of the album is stored within seconds.
/// Nothing the client shows depends on this, so the client fires it and does not wait. Not user scoped: the metadata belongs to
/// the song, but it still takes a signed in caller.
async fn song_opened_handler(
    State(db): State<DatabaseConnection>,
    State(song_meta_service): State<SongMetadataService>,
    State(metadata_crawler): State<MetadataCrawler>,
    _: Claims<SupabaseClaims>, // must have credentials to use this route
    Json(payload): Json<SongOpenedPayload>,
) -> Result<(), CadenzaError> {
    record_song_opened(&db, &song_meta_service, &metadata_crawler, &payload.song_id).await
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
        .route(
            "/local-tags/batch",
            post(get_local_tags_on_songs_handler)
                .patch(apply_user_tags_to_songs_handler)
                .delete(unapply_user_tags_from_songs_handler),
        )
        .route("/activity-tags", get(get_activity_tags_on_song_handler))
        .route(
            "/activity-tags/batch",
            post(get_activity_tags_on_songs_handler),
        )
        .route("/plays", post(record_play_handler))
        .route("/metadata/opened", post(song_opened_handler))
        .route("/metadata-tags", get(get_metadata_tags_on_song_handler))
}
