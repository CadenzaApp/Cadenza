use std::collections::HashMap;

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        self,
        tag_votes::TagVoteCache,
        tags::{get_default_tags_on_songs, get_uninitialized_songs, get_user_tags_on_songs, set_default_tags_on_songs},
    },
    err::CadenzaError,
    routes::json::{tag::Tag, vec_into}, services::tag_generation::{TagSpecs, TagGenerationService},
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{delete, get, post},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;


#[derive(Deserialize)]
pub struct GetTagsOnSongQueryParams {
    song_id: String,
}

/// Returns the user's tags on one song. If the song is new to the user, it gets
/// copies of its default tags first (see `db::tags::get_user_tags_on_songs`).
///
/// JSON return value format:
/// ```json
/// [ { "id": 12, "name": "vocaloid", "color": "#39c5bb" }, ... ]
/// ```
async fn get_tags_on_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<GetTagsOnSongQueryParams>,
) -> Result<Json<Vec<Tag>>, CadenzaError> {
    let mut song_to_tags =
        get_user_tags_on_songs(&db, claims.user_id, std::slice::from_ref(&params.song_id)).await?;

    // every requested song gets an entry, so the default is never used
    let tags = song_to_tags.remove(&params.song_id).unwrap_or_default();
    Ok(Json(vec_into(tags)))
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

/// Returns the user's tags on each requested song, keyed by song id. Songs new
/// to the user get copies of their default tags first. A song with no tags
/// comes back as an empty list.
///
/// JSON return value format:
/// ```json
/// { "1440857781": [ { "id": 12, "name": "vocaloid", "color": "#39c5bb" } ], "1613600188": [] }
/// ```
async fn get_tags_on_songs_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<SongIdsPayload>,
) -> Result<Json<HashMap<String, Vec<Tag>>>, CadenzaError> {
    check_batch_size(payload.song_ids.len())?;

    // the user's tags on each song, copying default tags onto songs new to them
    let tags_by_song = get_user_tags_on_songs(&db, claims.user_id, &payload.song_ids).await?;

    Ok(Json(
        tags_by_song
            .into_iter()
            .map(|(song_id, tags)| (song_id, vec_into(tags)))
            .collect(),
    ))
}

/// Initializes the requested songs, which is when a song new to the user gets
/// copies of its default tags. Returns the ones it could not initialize,
/// meaning those with no tags of either kind, in request order.
///
/// JSON return value format:
/// ```json
/// [ "1440857781", "1613600188", ... ]
/// ```
async fn initialize_songs_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<SongIdsPayload>,
) -> Result<Json<Vec<String>>, CadenzaError> {
    check_batch_size(payload.song_ids.len())?;

    Ok(Json(
        get_uninitialized_songs(&db, claims.user_id, &payload.song_ids).await?,
    ))
}


#[derive(Deserialize)]
pub struct SongIdAndDesc {
    song_id: String,
    /// description of the song used to generate tags, e.g. "Override by Yoshida Yasei"
    desc: String,
}

/// Generates and stores default tags for each requested song that has none yet.
/// Songs that already have default tags are left alone. Returns an empty body.
async fn set_default_tags_on_songs_handler(
    _: Claims<SupabaseClaims>, // only authorized users allowed
    State(db): State<DatabaseConnection>,
    State(tag_gen_service): State<TagGenerationService>,
    Json(songs): Json<Vec<SongIdAndDesc>>,
) -> Result<(), CadenzaError> {
    check_batch_size(songs.len())?;

    // find which of the songs already have default tags
    let song_ids: Vec<String> = songs.iter().map(|song| song.song_id.clone()).collect();
    let existing_default_tags = get_default_tags_on_songs(&db, &song_ids).await?;

    // only songs without default tags need any
    let songs_without_defaults: Vec<&SongIdAndDesc> = songs
        .iter()
        .filter(|song| !existing_default_tags.contains_key(&song.song_id))
        .collect();

    if songs_without_defaults.is_empty() {
        return Ok(());
    }

    // generate tags from each song's description, returned in the same order
    let descs: Vec<String> = songs_without_defaults
        .iter()
        .map(|song| song.desc.clone())
        .collect();
    let generated = tag_gen_service.generate_tags(&descs, None).await?;

    // pair each song with its generated tags and store them as its defaults
    let generated_tags: HashMap<String, Vec<TagSpecs>> = songs_without_defaults
        .iter()
        .zip(generated)
        .map(|(song, tags)| (song.song_id.clone(), tags))
        .collect();

    set_default_tags_on_songs(&db, generated_tags).await?;

    Ok(())
}


#[derive(Deserialize)]
pub struct ApplyTagPayload {
    song_id: String,
    tag_id: i64,
}

async fn apply_user_tag_handler(
    State(db): State<DatabaseConnection>,
    State(tag_votes): State<TagVoteCache>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<ApplyTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::apply_user_tag(db, &tag_votes, claims.user_id, payload.song_id, payload.tag_id).await
}

#[derive(Deserialize)]
pub struct UnapplyTagPayload {
    song_id: String,
    tag_id: i64,
}
async fn unapply_user_tag_handler(
    State(db): State<DatabaseConnection>,
    State(tag_votes): State<TagVoteCache>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<UnapplyTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::unapply_user_tag(db, &tag_votes, claims.user_id, payload.song_id, payload.tag_id)
        .await
}


pub fn get_songs_router() -> Router<AppState> {
    Router::new()
        .route("/default-tags", post(set_default_tags_on_songs_handler))
        .route("/initialize", post(initialize_songs_handler))
        .route("/tags", get(get_tags_on_song_handler))
        .route("/tags/batch", post(get_tags_on_songs_handler))
        .route("/tags", post(apply_user_tag_handler))
        .route("/tags", delete(unapply_user_tag_handler))
}
