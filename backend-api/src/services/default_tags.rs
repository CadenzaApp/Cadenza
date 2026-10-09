use std::collections::HashMap;
use std::env;
use std::time::Duration;

use sea_orm::DatabaseConnection;
use tokio::time::{MissedTickBehavior, interval};

use crate::db::tags::{
    clear_default_tag_generation, finish_default_tag_generation,
    get_songs_without_generated_default_tags, set_default_tags_on_songs,
    start_default_tag_generation,
};
use crate::db::user_songs::get_recent_songs_without_generated_default_tags;
use crate::err::CadenzaError;
use crate::services::metadata_tags::store_fetched_song_metadata;
use crate::services::song_metadata::SongMetadataService;
use crate::services::tag_generation::{TagGenerationService, TagSpecs};

/// Prefix on every line the backfill job logs, so one job's output greps out of
/// the rest of the server's.
const LOG_TAG: &str = "[default-tag-backfill]";

/// Songs one pass covers when `DEFAULT_TAG_BACKFILL_BATCH_SIZE` is unset.
const DEFAULT_BACKFILL_BATCH_SIZE: usize = 50;

/// Seconds between passes when `DEFAULT_TAG_BACKFILL_INTERVAL_SECS` is unset.
const DEFAULT_BACKFILL_INTERVAL_SECS: u64 = 300;

/// The most songs one pass may take. `SongMetadataService` panics past 300 ids
/// and the http path caps itself at 200, so the job holds to the same ceiling.
const MAX_BACKFILL_BATCH_SIZE: usize = 200;

/// How long the job stands down after the generator says it is rate limited, in
/// place of its usual interval.
const RATE_LIMIT_BACKOFF: Duration = Duration::from_secs(300);

/// Generates and stores default tags for each of `song_ids` that has never had them
/// generated, and marks every one of them so this never runs for them twice.
///
/// Titles come from Apple Music rather than from the caller, so a song the catalog does not
/// know is marked with no tags: there is nothing to describe it to the generator with, and
/// leaving it unmarked would call out to Apple again on every later read.
///
/// Songs that already carry a `default_tags_generation` row cost one indexed read and
/// nothing else, which is what makes this cheap enough to sit in front of a plain default
/// tag read. That holds for an `in_flight` row too, so a second reader of the same new song
/// skips it rather than paying the generator for it again.
///
/// The claim is written before the generator call and settled after it: `done` when the
/// call and the tag writes both went through, deleted when either failed, so a failure is
/// retried on the next read rather than leaving the song permanently tagless.
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

    // keep a copy for metadata queries while it is in hand, so these songs are not read
    // from Apple a second time for that. only a side effect of this call, so a failure is
    // logged rather than failing default tags
    if let Err(err) = store_fetched_song_metadata(db, &ungenerated, metadata).await {
        eprintln!("could not store song metadata read for default tags: {err}");
    }

    // claimed before the generator call, not after, so anything else reading these songs
    // while it runs sees the row and leaves them alone
    start_default_tag_generation(db, &ungenerated).await?;

    let attempt =
        generate_and_store_default_tags(db, tag_gen_service, describable_song_ids, descriptions)
            .await;

    match attempt {
        Ok(()) => finish_default_tag_generation(db, &ungenerated).await?,
        Err(err) => {
            // the claim goes away so the next read retries. reported rather than
            // returned, so the caller still sees what actually failed
            if let Err(clear_err) = clear_default_tag_generation(db, &ungenerated).await {
                eprintln!("could not clear a failed default tag generation: {clear_err}");
            }
            return Err(err);
        }
    }

    Ok(())
}

/// The part of [`ensure_default_tags_generated`] that can fail after the songs have been
/// claimed: the generator call and the write of what it returned. Split out so both
/// failures settle the claim the same way.
///
/// The two arguments are index aligned. Empty means every song was one Apple Music has no
/// catalog entry for, so there is nothing to generate from and no call to make.
async fn generate_and_store_default_tags(
    db: &DatabaseConnection,
    tag_gen_service: &TagGenerationService,
    song_ids: Vec<String>,
    descriptions: Vec<String>,
) -> Result<(), CadenzaError> {
    if song_ids.is_empty() {
        return Ok(());
    }

    let generated = tag_gen_service.generate_tags(&descriptions, None).await?;
    let generated_tags: HashMap<String, Vec<TagSpecs>> =
        song_ids.into_iter().zip(generated).collect();

    set_default_tags_on_songs(db, generated_tags).await?;
    Ok(())
}

/// What the backfill job was told to do, read from the environment at startup.
pub struct BackfillConfig {
    pub batch_size: usize,
    pub interval: Duration,
}

impl BackfillConfig {
    /// The job's settings, or `None` when it is switched off.
    ///
    /// Off unless `DEFAULT_TAG_BACKFILL_ENABLED` is `true`, because every pass
    /// can spend Apple Music and OpenAI calls that nobody asked for. The other
    /// two vars fall back to their defaults when absent or unparseable, so a
    /// typo slows the job down rather than failing startup.
    pub fn from_env() -> Option<Self> {
        let enabled = env::var("DEFAULT_TAG_BACKFILL_ENABLED").ok();
        let batch_size = env::var("DEFAULT_TAG_BACKFILL_BATCH_SIZE").ok();
        let interval_secs = env::var("DEFAULT_TAG_BACKFILL_INTERVAL_SECS").ok();

        Self::from_values(
            enabled.as_deref(),
            batch_size.as_deref(),
            interval_secs.as_deref(),
        )
    }

    /// [`BackfillConfig::from_env`] with the three values already read, so the
    /// clamping can be tested without writing to the process environment.
    fn from_values(
        enabled: Option<&str>,
        batch_size: Option<&str>,
        interval_secs: Option<&str>,
    ) -> Option<Self> {
        if !enabled.is_some_and(|value| value.trim().eq_ignore_ascii_case("true")) {
            return None;
        }

        let batch_size = batch_size
            .and_then(|value| value.trim().parse::<usize>().ok())
            .unwrap_or(DEFAULT_BACKFILL_BATCH_SIZE)
            .clamp(1, MAX_BACKFILL_BATCH_SIZE);

        let interval_secs = interval_secs
            .and_then(|value| value.trim().parse::<u64>().ok())
            .filter(|secs| *secs > 0)
            .unwrap_or(DEFAULT_BACKFILL_INTERVAL_SECS);

        Some(BackfillConfig {
            batch_size,
            interval: Duration::from_secs(interval_secs),
        })
    }
}

/// Generates default tags for the most recently added songs that have never had
/// them, and returns how many songs the pass covered.
///
/// Nothing here is user scoped: default tags belong to the song, not the person
/// whose library it turned up in.
pub async fn backfill_default_tags(
    db: &DatabaseConnection,
    song_meta_service: &SongMetadataService,
    tag_gen_service: &TagGenerationService,
    batch_size: usize,
) -> Result<usize, CadenzaError> {
    let song_ids = get_recent_songs_without_generated_default_tags(db, batch_size as u64).await?;
    if song_ids.is_empty() {
        return Ok(0);
    }

    ensure_default_tags_generated(db, song_meta_service, tag_gen_service, &song_ids).await?;
    Ok(song_ids.len())
}

/// Runs [`backfill_default_tags`] on a fixed interval for as long as the server
/// lives. The first pass runs at startup, since the first tick lands straight
/// away.
///
/// A pass that fails is logged and the job carries on. Nothing it failed to mark
/// is marked, so the next pass picks the same songs up again.
///
/// A pass the generator turned away for rate limiting stops there and waits
/// [`RATE_LIMIT_BACKOFF`] instead of the configured interval, however short that
/// interval is, so the job does not spend its next pass on another refusal.
///
/// Ticks are delayed rather than burst, so a pass that outruns the interval is
/// followed by a full interval of quiet instead of another pass immediately.
pub fn spawn_default_tag_backfill(
    db: DatabaseConnection,
    song_meta_service: SongMetadataService,
    tag_gen_service: TagGenerationService,
    config: BackfillConfig,
) {
    tokio::spawn(async move {
        let mut ticker = interval(config.interval);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

        loop {
            ticker.tick().await;

            let pass =
                backfill_default_tags(&db, &song_meta_service, &tag_gen_service, config.batch_size)
                    .await;

            match pass {
                Ok(0) => {}
                Ok(count) => println!("{LOG_TAG} generated default tags for {count} songs"),

                // the songs this pass claimed were already released by
                // `ensure_default_tags_generated`, so the next pass picks them up again.
                // resetting the ticker rather than sleeping keeps the wait exact no
                // matter what the interval is
                Err(err @ CadenzaError::TagGenerationRateLimited { .. }) => {
                    eprintln!(
                        "{LOG_TAG} pass failed: {err}. standing down for {}s",
                        RATE_LIMIT_BACKOFF.as_secs()
                    );
                    ticker.reset_after(RATE_LIMIT_BACKOFF);
                }

                Err(err) => eprintln!("{LOG_TAG} pass failed: {err}"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backfill_is_off_unless_the_environment_turns_it_on() {
        assert!(BackfillConfig::from_values(None, None, None).is_none());
        assert!(BackfillConfig::from_values(Some("false"), None, None).is_none());
        // only the word, so a stray 1 does not quietly start spending tokens
        assert!(BackfillConfig::from_values(Some("1"), None, None).is_none());
        assert!(BackfillConfig::from_values(Some(" TRUE "), None, None).is_some());
    }

    #[test]
    fn backfill_falls_back_to_its_defaults() {
        let config = BackfillConfig::from_values(Some("true"), None, None).unwrap();
        assert_eq!(config.batch_size, DEFAULT_BACKFILL_BATCH_SIZE);
        assert_eq!(
            config.interval,
            Duration::from_secs(DEFAULT_BACKFILL_INTERVAL_SECS)
        );

        // a typo slows the job down rather than failing startup
        let config = BackfillConfig::from_values(Some("true"), Some("fifty"), Some("")).unwrap();
        assert_eq!(config.batch_size, DEFAULT_BACKFILL_BATCH_SIZE);
        assert_eq!(
            config.interval,
            Duration::from_secs(DEFAULT_BACKFILL_INTERVAL_SECS)
        );
    }

    /// `SongMetadataService` panics past 300 ids, so a batch size out of the
    /// environment can never be passed through as it was given.
    #[test]
    fn backfill_batch_size_stays_under_the_metadata_cap() {
        let config = BackfillConfig::from_values(Some("true"), Some("5000"), None).unwrap();
        assert_eq!(config.batch_size, MAX_BACKFILL_BATCH_SIZE);

        let config = BackfillConfig::from_values(Some("true"), Some("0"), None).unwrap();
        assert_eq!(config.batch_size, 1);
    }

    /// A zero interval would spin the loop as fast as the generator answers.
    #[test]
    fn backfill_interval_rejects_zero() {
        let config = BackfillConfig::from_values(Some("true"), None, Some("0")).unwrap();
        assert_eq!(
            config.interval,
            Duration::from_secs(DEFAULT_BACKFILL_INTERVAL_SECS)
        );

        let config = BackfillConfig::from_values(Some("true"), None, Some("30")).unwrap();
        assert_eq!(config.interval, Duration::from_secs(30));
    }
}
