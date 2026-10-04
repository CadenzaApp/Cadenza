//! Keeps `metadata_song_tags_applied` filled, so queries can filter on a song's Apple Music
//! metadata, and crawls whole albums in the background so the rest of an album a user
//! touched is queryable too.
//!
//! The stored rows are what metadata queries filter on and what a song's Metadata Tags show
//! (`GET /songs/metadata-tags`), so the two always agree. They are not authoritative: every
//! other screen keeps asking Apple Music for titles, and a stale row only makes a query miss
//! a song or a pill lag behind Apple.
//!
//! How much gets stored depends on what the user did with a song:
//!
//! - shown in any list, or read by the tag editor: that song
//!   ([`spawn_store_song_metadata`], from the default tag routes)
//! - opened in the player: that song, and its album is queued ([`record_song_opened`])
//! - in someone's library: that song, and its album is queued (the crawl's library walk)
//!
//! Albums are the unit of crawling. An album is crawled once and marked `done`. It is only
//! crawled again when one of its songs is opened and turns out to have no row, which means
//! the album changed since.
//!
//! The album queue lives in the database, so it survives the server going down. The crawl
//! job, behind [`METADATA_CRAWL_ENABLED`], wakes as soon as an album is queued, and on
//! startup or after any failed pass hands back albums a dead pass left `in_flight` before it
//! claims more.

use std::collections::HashMap;
use std::env;
use std::sync::Arc;
use std::time::Duration;

use sea_orm::DatabaseConnection;
use tokio::sync::Notify;
use tokio::time::{MissedTickBehavior, interval, sleep};

use crate::db::entity::metadata_song_tags_applied;
use crate::db::metadata_tags::{
    claim_pending_albums, finish_albums, get_library_songs_without_metadata, get_song_metadata,
    get_songs_without_metadata, get_stored_album_id, queue_albums, release_albums,
    requeue_done_albums, reset_in_flight_albums, store_song_metadata,
};
use crate::err::CadenzaError;
use crate::services::song_metadata::{
    MAX_ALBUM_IDS_PER_REQUEST, SongMetadata, SongMetadataService,
};

/// Prefix on every line the crawl and the background stores log, so their output greps out
/// of the rest of the server's.
const LOG_TAG: &str = "[metadata-tags]";

/// Song ids per Apple catalog songs request, Apple's own cap.
const SONG_IDS_PER_REQUEST: usize = 300;

/// Albums one pass crawls when `METADATA_CRAWL_ALBUM_BATCH_SIZE` is unset.
const DEFAULT_ALBUM_BATCH_SIZE: usize = 20;

/// Library songs one pass stores when `METADATA_CRAWL_LIBRARY_BATCH_SIZE` is unset. One
/// Apple request's worth.
const DEFAULT_LIBRARY_BATCH_SIZE: usize = 300;

/// The most library songs one pass may take.
const MAX_LIBRARY_BATCH_SIZE: usize = 1_500;

/// The feature flag for the crawl, its library walk and album crawl both. Set to false to
/// stop the job from starting at all; listed and opened songs are still stored without it,
/// but their albums stay queued until it is back on.
pub const METADATA_CRAWL_ENABLED: bool = true;

/// Seconds between passes when `METADATA_CRAWL_INTERVAL_SECS` is unset. Queued albums do
/// not wait for this; it is the fallback that retries failures and runs the library walk.
const DEFAULT_CRAWL_INTERVAL_SECS: u64 = 60;

/// Pause between back to back passes while there is still work queued, so draining a long
/// queue stays a trickle of Apple requests rather than a burst.
const DRAIN_PAUSE: Duration = Duration::from_secs(1);

/// Pause after a failed pass before the next one, so a database or Apple outage is retried
/// once a few seconds rather than in a tight loop.
const FAILURE_PAUSE: Duration = Duration::from_secs(10);

/// How long the crawl stands down after Apple says it is rate limited, in place of its usual
/// interval.
const RATE_LIMIT_BACKOFF: Duration = Duration::from_secs(300);

/// Tries an album gets before it is marked `failed` and left alone.
const MAX_ALBUM_ATTEMPTS: i32 = 5;

/// Stores a row for each of `song_ids` that has none yet, and returns the songs Apple knew.
///
/// Ids that already have a row cost one indexed read and nothing else. The rest are read
/// from Apple, 300 to a request. An id Apple does not know gets a `found` false row, so it
/// is never asked about again.
pub async fn ensure_song_metadata_stored(
    db: &DatabaseConnection,
    song_meta_service: &SongMetadataService,
    song_ids: &[String],
) -> Result<Vec<SongMetadata>, CadenzaError> {
    let missing = get_songs_without_metadata(db, song_ids).await?;

    let mut stored = Vec::new();
    for chunk in missing.chunks(SONG_IDS_PER_REQUEST) {
        let fetched = song_meta_service.get_songs_metadata(chunk).await?;
        stored.extend(store_fetched_song_metadata(db, chunk, fetched).await?);
    }

    Ok(stored)
}

/// Stores what one Apple lookup of `requested` returned: a row for every song in `fetched`,
/// and a `found` false row for every requested id it left out. Returns the found songs.
///
/// This is how a caller that already asked Apple, like default tag generation, stores what
/// it got without asking again.
pub async fn store_fetched_song_metadata(
    db: &DatabaseConnection,
    requested: &[String],
    mut fetched: HashMap<String, SongMetadata>,
) -> Result<Vec<SongMetadata>, CadenzaError> {
    let mut found = Vec::new();
    let mut not_found = Vec::new();
    for song_id in requested {
        match fetched.remove(song_id) {
            Some(song) => found.push(song),
            None => not_found.push(song_id.clone()),
        }
    }

    store_song_metadata(db, &found, &not_found).await?;
    Ok(found)
}

/// Runs [`ensure_song_metadata_stored`] on its own task, so a list read does not wait on
/// Apple for a side effect. A failure is logged and dropped: the songs stay without a row
/// and the next read of them tries again.
pub fn spawn_store_song_metadata(
    db: DatabaseConnection,
    song_meta_service: SongMetadataService,
    song_ids: Vec<String>,
) {
    if song_ids.is_empty() {
        return;
    }

    tokio::spawn(async move {
        if let Err(err) = ensure_song_metadata_stored(&db, &song_meta_service, &song_ids).await {
            eprintln!("{LOG_TAG} could not store metadata for listed songs: {err}");
        }
    });
}

/// A song's stored metadata row, for showing its metadata tags. A song with no row yet is
/// stored first, so the first look at a song is not empty. `None` when it still has none,
/// which is only when storing it failed; that failure is logged rather than returned, since
/// the caller can show the song without metadata.
pub async fn get_song_metadata_for_display(
    db: &DatabaseConnection,
    song_meta_service: &SongMetadataService,
    song_id: &str,
) -> Result<Option<metadata_song_tags_applied::Model>, CadenzaError> {
    let song_ids = [song_id.to_owned()];
    if let Err(err) = ensure_song_metadata_stored(db, song_meta_service, &song_ids).await {
        eprintln!("{LOG_TAG} could not store metadata for a song being shown: {err}");
    }
    get_song_metadata(db, song_id).await
}

/// What opening a song in the player does: stores the song if it has no row, queues its
/// album, and wakes the crawl so the rest of the album is stored right away.
///
/// When the song already had a row, its album is queued only if it never was, so opening a
/// song on a crawled album costs two indexed reads. When it had no row but its album was
/// already crawled, the album changed since, and it goes back in the queue.
pub async fn record_song_opened(
    db: &DatabaseConnection,
    song_meta_service: &SongMetadataService,
    crawler: &MetadataCrawler,
    song_id: &str,
) -> Result<(), CadenzaError> {
    let song_ids = [song_id.to_owned()];
    let newly_stored = ensure_song_metadata_stored(db, song_meta_service, &song_ids).await?;

    let album_ids: Vec<String> = match newly_stored.first() {
        Some(song) => song.album_id.iter().cloned().collect(),
        None => get_stored_album_id(db, song_id)
            .await?
            .into_iter()
            .collect(),
    };
    if album_ids.is_empty() {
        return Ok(());
    }

    queue_albums(db, &album_ids).await?;
    if !newly_stored.is_empty() {
        requeue_done_albums(db, &album_ids).await?;
    }
    crawler.wake();

    Ok(())
}

/// A handle on the crawl job, kept in `AppState`, that a request can wake as soon as it
/// queues an album rather than leave the album for the next interval.
///
/// Waking a crawl that is busy is not lost: the crawl runs one more pass when it finishes.
#[derive(Clone, Default)]
pub struct MetadataCrawler {
    wake: Arc<Notify>,
}

impl MetadataCrawler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Asks the crawl for a pass now.
    pub fn wake(&self) {
        self.wake.notify_one();
    }
}
/// What the crawl was told to do, read at startup.
pub struct MetadataCrawlConfig {
    pub album_batch_size: usize,
    pub library_batch_size: usize,
    pub interval: Duration,
}

impl MetadataCrawlConfig {
    /// The crawl's settings, or `None` when [`METADATA_CRAWL_ENABLED`] switches it off.
    ///
    /// The sizes and interval come from the environment and fall back to their defaults
    /// when absent or unparseable, so a typo slows the crawl down rather than failing
    /// startup.
    pub fn from_env() -> Option<Self> {
        if !METADATA_CRAWL_ENABLED {
            return None;
        }

        let album_batch_size = env::var("METADATA_CRAWL_ALBUM_BATCH_SIZE").ok();
        let library_batch_size = env::var("METADATA_CRAWL_LIBRARY_BATCH_SIZE").ok();
        let interval_secs = env::var("METADATA_CRAWL_INTERVAL_SECS").ok();

        Some(Self::from_values(
            album_batch_size.as_deref(),
            library_batch_size.as_deref(),
            interval_secs.as_deref(),
        ))
    }

    /// [`MetadataCrawlConfig::from_env`] with the values already read, so the clamping can
    /// be tested without writing to the process environment.
    fn from_values(
        album_batch_size: Option<&str>,
        library_batch_size: Option<&str>,
        interval_secs: Option<&str>,
    ) -> Self {
        let album_batch_size = album_batch_size
            .and_then(|value| value.trim().parse::<usize>().ok())
            .unwrap_or(DEFAULT_ALBUM_BATCH_SIZE)
            .clamp(1, MAX_ALBUM_IDS_PER_REQUEST);

        // zero is allowed and turns the library walk off, leaving only the album queue
        let library_batch_size = library_batch_size
            .and_then(|value| value.trim().parse::<usize>().ok())
            .unwrap_or(DEFAULT_LIBRARY_BATCH_SIZE)
            .min(MAX_LIBRARY_BATCH_SIZE);

        let interval_secs = interval_secs
            .and_then(|value| value.trim().parse::<u64>().ok())
            .filter(|secs| *secs > 0)
            .unwrap_or(DEFAULT_CRAWL_INTERVAL_SECS);

        MetadataCrawlConfig {
            album_batch_size,
            library_batch_size,
            interval: Duration::from_secs(interval_secs),
        }
    }
}

/// What one pass of the crawl covered.
#[derive(Debug, Default, PartialEq)]
pub struct CrawlPass {
    /// Library songs that got a row.
    pub library_songs: usize,
    /// Albums crawled and marked `done`.
    pub albums: usize,
    /// Songs stored off those albums.
    pub album_songs: usize,
}

impl CrawlPass {
    /// Whether the pass found anything to do, in which case there may be more queued and the
    /// crawl goes again straight away.
    fn did_work(&self) -> bool {
        self.library_songs > 0 || self.albums > 0
    }
}

/// One pass of the crawl. First stores library songs that have no row and queues their
/// albums, newest additions first. Then crawls the oldest queued albums and stores every
/// song on them.
pub async fn crawl_metadata(
    db: &DatabaseConnection,
    song_meta_service: &SongMetadataService,
    config: &MetadataCrawlConfig,
) -> Result<CrawlPass, CadenzaError> {
    let mut pass = CrawlPass::default();

    if config.library_batch_size > 0 {
        let library_song_ids =
            get_library_songs_without_metadata(db, config.library_batch_size as u64).await?;
        let stored = ensure_song_metadata_stored(db, song_meta_service, &library_song_ids).await?;
        let album_ids: Vec<String> = stored
            .iter()
            .filter_map(|song| song.album_id.clone())
            .collect();
        queue_albums(db, &album_ids).await?;
        pass.library_songs = library_song_ids.len();
    }

    let claimed = claim_pending_albums(db, config.album_batch_size as u64).await?;
    if claimed.is_empty() {
        return Ok(pass);
    }

    match crawl_albums(db, song_meta_service, &claimed).await {
        Ok(album_songs) => {
            finish_albums(db, &claimed).await?;
            pass.albums = claimed.len();
            pass.album_songs = album_songs;
            Ok(pass)
        }
        Err(err) => {
            // a rate limit is no fault of these albums, so it does not count against them.
            // if handing them back fails too, the crawl hands back everything in flight
            // before its next pass
            let count_attempt = !matches!(err, CadenzaError::SongMetadataRateLimited);
            if let Err(release_err) =
                release_albums(db, &claimed, count_attempt, MAX_ALBUM_ATTEMPTS).await
            {
                eprintln!("{LOG_TAG} could not release claimed albums: {release_err}");
            }
            Err(err)
        }
    }
}

/// Reads every song on the claimed albums and stores them all. An album Apple no longer
/// returns has nothing to store and still counts as crawled. Returns how many songs were
/// stored.
async fn crawl_albums(
    db: &DatabaseConnection,
    song_meta_service: &SongMetadataService,
    album_ids: &[String],
) -> Result<usize, CadenzaError> {
    let albums = song_meta_service.get_albums_tracks(album_ids).await?;
    let songs: Vec<SongMetadata> = albums.into_values().flatten().collect();

    store_song_metadata(db, &songs, &[]).await?;
    Ok(songs.len())
}

/// How one pass went, as far as the loop in [`spawn_metadata_crawl`] cares.
enum PassOutcome {
    /// Did something, so there may be more queued.
    Worked,
    /// Found nothing to do.
    Idle,
    /// Apple is rate limiting.
    RateLimited,
    /// Failed or panicked. Albums it claimed may still be `in_flight`.
    Failed,
}

/// Runs one pass on its own task, so a panic inside it is caught here rather than ending
/// the crawl for the life of the server.
async fn run_pass(
    db: &DatabaseConnection,
    song_meta_service: &SongMetadataService,
    config: &Arc<MetadataCrawlConfig>,
) -> PassOutcome {
    let pass = {
        let (db, song_meta_service, config) =
            (db.clone(), song_meta_service.clone(), config.clone());
        tokio::spawn(async move { crawl_metadata(&db, &song_meta_service, &config).await })
    };

    match pass.await {
        Ok(Ok(pass)) if pass.did_work() => {
            println!(
                "{LOG_TAG} stored {} library songs, and {} songs off {} albums",
                pass.library_songs, pass.album_songs, pass.albums
            );
            PassOutcome::Worked
        }
        Ok(Ok(_)) => PassOutcome::Idle,
        Ok(Err(CadenzaError::SongMetadataRateLimited)) => PassOutcome::RateLimited,
        Ok(Err(err)) => {
            eprintln!("{LOG_TAG} pass failed: {err}");
            PassOutcome::Failed
        }
        Err(join_err) => {
            eprintln!("{LOG_TAG} pass panicked: {join_err}");
            PassOutcome::Failed
        }
    }
}

/// Runs the crawl for as long as the server lives.
///
/// A pass runs at startup, on every interval, and whenever [`MetadataCrawler::wake`] is
/// called. After a pass that did something it goes again, a second later, until a pass
/// finds nothing, so a queued album is stored within seconds rather than at the next tick.
///
/// Recovering is built in:
///
/// - Albums are only ever `in_flight` while this loop is in a pass. Before the first pass,
///   and before any pass that follows a failure, a panic, or a rate limit, it hands every
///   `in_flight` album
///   back to `pending`. That covers a server that died mid pass, and a pass whose own
///   release failed because the database was down. If the handback itself fails it is tried
///   again before the next pass.
/// - A pass that panics is caught by [`run_pass`]; the loop carries on.
/// - A failed pass waits [`FAILURE_PAUSE`], and a rate limited one [`RATE_LIMIT_BACKOFF`],
///   before trying again. Either way, the albums it claimed are handed back first. Queued
///   albums are not lost while it waits: they stay `pending` in the database.
///
/// The handback assumes this is the only server crawling. A second one would hand back the
/// first one's live claims, which costs a duplicate crawl of those albums and nothing else.
pub fn spawn_metadata_crawl(
    db: DatabaseConnection,
    song_meta_service: SongMetadataService,
    config: MetadataCrawlConfig,
    crawler: MetadataCrawler,
) {
    let config = Arc::new(config);

    tokio::spawn(async move {
        let mut ticker = interval(config.interval);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut hand_back_in_flight = true;

        loop {
            tokio::select! {
                _ = ticker.tick() => {}
                _ = crawler.wake.notified() => {}
            }

            loop {
                if hand_back_in_flight {
                    match reset_in_flight_albums(&db).await {
                        Ok(count) => {
                            hand_back_in_flight = false;
                            if count > 0 {
                                println!("{LOG_TAG} handed back {count} albums left in flight");
                            }
                        }
                        Err(err) => {
                            eprintln!("{LOG_TAG} could not hand back albums in flight: {err}");
                            sleep(FAILURE_PAUSE).await;
                            break;
                        }
                    }
                }

                match run_pass(&db, &song_meta_service, &config).await {
                    PassOutcome::Worked => sleep(DRAIN_PAUSE).await,
                    PassOutcome::Idle => break,
                    PassOutcome::RateLimited => {
                        hand_back_in_flight = true;
                        eprintln!(
                            "{LOG_TAG} apple music is rate limiting. standing down for {}s",
                            RATE_LIMIT_BACKOFF.as_secs()
                        );
                        sleep(RATE_LIMIT_BACKOFF).await;
                        break;
                    }
                    PassOutcome::Failed => {
                        hand_back_in_flight = true;
                        sleep(FAILURE_PAUSE).await;
                        break;
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crawl_falls_back_to_its_defaults() {
        let config = MetadataCrawlConfig::from_values(Some("x"), None, Some("-3"));
        assert_eq!(config.album_batch_size, DEFAULT_ALBUM_BATCH_SIZE);
        assert_eq!(config.library_batch_size, DEFAULT_LIBRARY_BATCH_SIZE);
        assert_eq!(
            config.interval,
            Duration::from_secs(DEFAULT_CRAWL_INTERVAL_SECS)
        );
    }

    #[test]
    fn crawl_album_batch_stays_inside_one_apple_request() {
        let config = MetadataCrawlConfig::from_values(Some("5000"), None, None);
        assert_eq!(config.album_batch_size, MAX_ALBUM_IDS_PER_REQUEST);

        let config = MetadataCrawlConfig::from_values(Some("0"), None, None);
        assert_eq!(config.album_batch_size, 1);
    }

    #[test]
    fn crawl_library_batch_can_be_turned_off_and_is_capped() {
        let config = MetadataCrawlConfig::from_values(None, Some("0"), None);
        assert_eq!(config.library_batch_size, 0);

        let config = MetadataCrawlConfig::from_values(None, Some("999999"), None);
        assert_eq!(config.library_batch_size, MAX_LIBRARY_BATCH_SIZE);
    }

    #[test]
    fn crawl_interval_rejects_zero() {
        let config = MetadataCrawlConfig::from_values(None, None, Some("0"));
        assert_eq!(
            config.interval,
            Duration::from_secs(DEFAULT_CRAWL_INTERVAL_SECS)
        );
    }

    #[test]
    fn a_pass_that_stored_anything_counts_as_work() {
        assert!(!CrawlPass::default().did_work());
        assert!(
            CrawlPass {
                albums: 1,
                ..Default::default()
            }
            .did_work()
        );
        assert!(
            CrawlPass {
                library_songs: 1,
                ..Default::default()
            }
            .did_work()
        );
    }

    /// A wake while the crawl is busy is kept, so the crawl runs one more pass afterwards
    /// rather than leaving a freshly queued album for the next interval.
    #[tokio::test]
    async fn a_wake_with_nobody_waiting_is_not_lost() {
        let crawler = MetadataCrawler::new();
        crawler.wake();
        tokio::time::timeout(Duration::from_secs(1), crawler.wake.notified())
            .await
            .expect("the wake was kept");
    }
}
