use std::collections::HashMap;

use sea_orm::DatabaseConnection;

use crate::db::tags::{
    get_songs_without_generated_default_tags, mark_default_tags_generated,
    set_default_tags_on_songs,
};
use crate::err::CadenzaError;
use crate::services::song_metadata::SongMetadataService;
use crate::services::tag_generation::{TagGenerationService, TagSpecs};

/// Generates and stores default tags for each of `song_ids` that has never had them
/// generated, and marks every one of them so this never runs for them twice.
///
/// Titles come from Apple Music rather than from the caller, so a song the catalog does not
/// know is marked with no tags: there is nothing to describe it to the generator with, and
/// leaving it unmarked would call out to Apple again on every later read.
///
/// Songs that are already marked cost one indexed read and nothing else, which is what makes
/// this cheap enough to sit in front of a plain default tag read.
///
/// `song_ids` must hold at most 300 entries, the cap `SongMetadataService` panics past.
/// Both callers go through `routes::songs::check_batch_size` first, which caps at 200.
pub async fn ensure_default_tags_generated(
    db: &DatabaseConnection,
    song_meta_service: &SongMetadataService,
    tag_gen_service: &TagGenerationService,
    song_ids: &[String],
) -> Result<(), CadenzaError> {
    let ungenerated = get_songs_without_generated_default_tags(db, song_ids).await?;
    if ungenerated.is_empty() {
        return Ok(());
    }

    let metadata = song_meta_service.get_songs_metadata(&ungenerated).await?;

    // the two lists stay index aligned, so each description goes back to its own song.
    // a song Apple Music has no catalog entry for drops out here
    let mut describable_song_ids: Vec<String> = Vec::new();
    let mut descriptions: Vec<String> = Vec::new();
    for song_id in &ungenerated {
        if let Some(meta) = metadata.get(song_id) {
            describable_song_ids.push(song_id.clone());
            descriptions.push(meta.description());
        }
    }

    if !describable_song_ids.is_empty() {
        let generated = tag_gen_service.generate_tags(&descriptions, None).await?;
        let generated_tags: HashMap<String, Vec<TagSpecs>> =
            describable_song_ids.into_iter().zip(generated).collect();

        set_default_tags_on_songs(db, generated_tags).await?;
    }

    // marked only once the writes above succeeded, so a failed generation is retried
    // on the next read rather than leaving the song permanently tagless
    mark_default_tags_generated(db, &ungenerated).await?;
    Ok(())
}
