//! Tagging spotlight posts that `db::social::add_spotlights` queued without
//! tags, after the request has answered.

use std::collections::HashMap;

use sea_orm::DatabaseConnection;

use crate::db::social::{SpotlightInput, tag_spotlight_posts};
use crate::err::CadenzaError;
use crate::services::default_tags::ensure_default_tags_generated;
use crate::services::song_metadata::SongMetadataService;
use crate::services::tag_generation::TagGenerationService;

/// Tags the posts of `untagged` on a task of its own, so the request does not
/// wait on the tag generator or Apple, and a client that hangs up does not
/// cancel it. Does nothing for an empty list.
///
/// Song default tag generation and the artist genre read run at the same time,
/// then one short transaction tags every post that is still empty. A failure
/// is logged. A post left without tags is tried again the next time anyone
/// queues its catalog id.
///
/// `untagged` must hold at most 25 artists, the cap
/// `SongMetadataService::get_artists_genres` panics past. The route allows 5.
pub fn spawn_spotlight_tagging(
    db: DatabaseConnection,
    song_meta_service: SongMetadataService,
    tag_gen_service: TagGenerationService,
    untagged: Vec<SpotlightInput>,
) {
    if untagged.is_empty() {
        return;
    }
    tokio::spawn(async move {
        let artist_genres =
            prepare_spotlight_tags(&db, &song_meta_service, &tag_gen_service, &untagged).await;
        if let Err(err) = tag_spotlight_posts(&db, &untagged, &artist_genres).await {
            eprintln!("[spotlights] tagging spotlight posts failed: {err}");
        }
    });
}

/// Generates default tags for the songs in `items` that have never had them,
/// and returns Apple's genres for the artists, keyed by artist id. The two run
/// at the same time, and each failure is logged rather than returned.
async fn prepare_spotlight_tags(
    db: &DatabaseConnection,
    song_meta_service: &SongMetadataService,
    tag_gen_service: &TagGenerationService,
    items: &[SpotlightInput],
) -> HashMap<String, Vec<String>> {
    let song_ids = ids_of_type(items, "song");
    let artist_ids = ids_of_type(items, "artist");
    let songs = async {
        if song_ids.is_empty() {
            return;
        }
        if let Err(err) =
            ensure_default_tags_generated(db, song_meta_service, tag_gen_service, &song_ids).await
        {
            eprintln!("[spotlights] generating default tags failed: {err}");
        }
    };
    let artists = async {
        let genres: Result<_, CadenzaError> =
            song_meta_service.get_artists_genres(&artist_ids).await;
        genres.unwrap_or_else(|err| {
            eprintln!("[spotlights] reading artist genres failed: {err}");
            HashMap::new()
        })
    };
    let ((), genres) = tokio::join!(songs, artists);
    genres
}

/// The distinct catalog ids of one spotlight type, in order.
fn ids_of_type(items: &[SpotlightInput], spotlight_type: &str) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for item in items {
        if item.spotlight_type == spotlight_type && !ids.contains(&item.musickit_id) {
            ids.push(item.musickit_id.clone());
        }
    }
    ids
}
