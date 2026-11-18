//! Getting tags ready for spotlight posts before `db::social::add_spotlights`
//! queues them.

use std::collections::HashMap;

use sea_orm::DatabaseConnection;

use crate::db::social::{SpotlightInput, spotlight_ids_without_tags};
use crate::err::CadenzaError;
use crate::services::default_tags::ensure_default_tags_generated;
use crate::services::song_metadata::SongMetadataService;
use crate::services::tag_generation::TagGenerationService;

/// Generates default tags for the songs in `items` that have never had them,
/// and returns Apple's genres for the artists, keyed by artist id.
///
/// The two run at the same time. Genres are read in one Apple request, and
/// only for artists whose shared post is missing or has no tags. Either
/// failure is logged rather than returned, so the spotlights are still queued.
/// A post left without tags is filled the next time its id is queued.
///
/// `items` must hold at most 25 artists, the cap
/// `SongMetadataService::get_artists_genres` panics past. The route allows 5.
pub async fn prepare_spotlight_tags(
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
        match untagged_artist_genres(db, song_meta_service, &artist_ids).await {
            Ok(genres) => genres,
            Err(err) => {
                eprintln!("[spotlights] reading artist genres failed: {err}");
                HashMap::new()
            }
        }
    };
    let ((), genres) = tokio::join!(songs, artists);
    genres
}

/// Genres for each of `artist_ids` whose spotlight post still needs tags.
async fn untagged_artist_genres(
    db: &DatabaseConnection,
    song_meta_service: &SongMetadataService,
    artist_ids: &[String],
) -> Result<HashMap<String, Vec<String>>, CadenzaError> {
    if artist_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let untagged = spotlight_ids_without_tags(db, artist_ids).await?;
    song_meta_service.get_artists_genres(&untagged).await
}

/// The distinct catalog ids of one spotlight type, in request order.
fn ids_of_type(items: &[SpotlightInput], spotlight_type: &str) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for item in items {
        if item.spotlight_type == spotlight_type && !ids.contains(&item.musickit_id) {
            ids.push(item.musickit_id.clone());
        }
    }
    ids
}
