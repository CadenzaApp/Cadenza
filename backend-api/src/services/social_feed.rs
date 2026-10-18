//! Calls the python model for embeddings and similarity, and runs the feed.
//!
//! The model never sees the database. This process loads the rows, sends the
//! text the model needs, and writes the vectors it gets back.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use chrono::{DateTime, Utc};
use reqwest::Client;
use sea_orm::DatabaseConnection;
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};

use crate::db::social::{
    self, FeedCandidate, FeedExclude, InterestDelta, PublicProfile, SocialPost, UpsertedInterest,
};
use crate::err::CadenzaError;

const DEFAULT_MODEL_URL: &str = "http://localhost:3001";
const MODEL_HOST: &str = "127.0.0.1";
const MODEL_PORT: &str = "3001";
const MODEL_HTTP_TIMEOUT: Duration = Duration::from_secs(60);
/// Last accepted like or unlike per user and post. A click older than that is ignored.
const LIKE_MEMORY: usize = 2000;
/// Users whose interest vector is kept in memory. The least recently read entry is dropped.
const USER_VECTOR_CACHE: usize = 2000;

/// The python model process started by [`spawn_ml_service`]. Dropping it kills
/// the child.
pub struct MlService {
    child: Child,
}

impl Drop for MlService {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Starts `ml-service` on `127.0.0.1:3001`. The model loads after spawn, so
/// embedding and similarity calls can 502 until the port is open.
pub fn spawn_ml_service() -> MlService {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("ml-service");
    let python = ml_python(&dir);
    println!(
        "[ml-service] starting on {MODEL_HOST}:{MODEL_PORT} with {}",
        python.display()
    );
    let mut child = Command::new(&python)
        .current_dir(&dir)
        .env("PYTHONUNBUFFERED", "1")
        .args([
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            MODEL_HOST,
            "--port",
            MODEL_PORT,
            "--workers",
            "1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|err| panic!("failed to start ml-service at {}: {err}", python.display()));
    prefix_child_lines("[ml-service]", child.stdout.take(), child.stderr.take());
    MlService { child }
}

/// Copies each child line onto this process's stdout or stderr with `prefix`.
fn prefix_child_lines(
    prefix: &'static str,
    stdout: Option<ChildStdout>,
    stderr: Option<ChildStderr>,
) {
    if let Some(stdout) = stdout {
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                println!("{prefix} {line}");
            }
        });
    }
    if let Some(stderr) = stderr {
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                let Ok(line) = line else { break };
                eprintln!("{prefix} {line}");
            }
        });
    }
}

fn ml_python(dir: &Path) -> PathBuf {
    let python = dir.join(".venv").join("bin").join("python");
    if !python.exists() {
        panic!(
            "ml-service venv missing at {}; run `uv sync` in backend-api/ml-service",
            python.display()
        );
    }
    python
}

/// HTTP client for the sentence-transformer process, plus the in-memory like clock
/// and user-vector cache.
#[derive(Clone)]
pub struct SocialFeedService {
    base_url: String,
    http: Client,
    likes: Arc<Mutex<LikeMemory>>,
    vectors: Arc<Mutex<UserVectorCache>>,
}

impl SocialFeedService {
    /// Reads `SOCIAL_FEED_URL`, defaulting to `http://localhost:3001`.
    pub fn new() -> Self {
        let base_url = std::env::var("SOCIAL_FEED_URL")
            .unwrap_or_else(|_| DEFAULT_MODEL_URL.to_owned())
            .trim_end_matches('/')
            .to_owned();
        Self {
            base_url,
            http: Client::builder()
                .timeout(MODEL_HTTP_TIMEOUT)
                .build()
                .expect("failed to build http client for SocialFeedService"),
            likes: Arc::new(Mutex::new(LikeMemory::default())),
            vectors: Arc::new(Mutex::new(UserVectorCache::default())),
        }
    }

    /// Embeds `content`, stores the post, and returns its id.
    ///
    /// When `topic_mk_id` is set, the embedding is prefixed with the song or
    /// artist names from the request. Stored `content` is the user's text.
    pub async fn create_post(
        &self,
        db: &DatabaseConnection,
        user_id: Uuid,
        content: &str,
        topic_mk_id: Option<&str>,
        topic_song_title: Option<&str>,
        topic_artist_name: Option<&str>,
    ) -> Result<i64, CadenzaError> {
        let to_embed = match topic_mk_id
            .and_then(|_| topic_embedding_prefix(topic_song_title, topic_artist_name))
        {
            Some(prefix) => format!("{prefix}{content}"),
            None => content.to_owned(),
        };
        let embedding = self.embed_post(&to_embed).await?;
        let mut with_bday = Vec::with_capacity(embedding.len() + 1);
        with_bday.push(social::days_since_posts_epoch(Utc::now()) as f64);
        with_bday.extend_from_slice(&embedding);
        social::insert_post(db, user_id, content, &embedding, &with_bday, topic_mk_id).await
    }

    /// Ranked posts for `user_id`. Marks the returned ids `loaded`.
    pub async fn get_feed(
        &self,
        db: &DatabaseConnection,
        user_id: Uuid,
        exclude: FeedExclude,
    ) -> Result<Vec<SocialPost>, CadenzaError> {
        let now = Utc::now();
        let cached = self
            .vectors
            .lock()
            .expect("user vector cache")
            .get(user_id, now);
        let vector = if let Some(vector) = cached {
            vector
        } else {
            let vector = social::user_vector(db, user_id).await?;
            self.vectors.lock().expect("user vector cache").insert(
                user_id,
                vector.clone(),
                Utc::now(),
            );
            vector
        };

        let (similar, hot) = tokio::try_join!(
            social::similar_and_recent_posts(db, user_id, exclude, vector.as_deref()),
            social::hot_posts(db, user_id, exclude),
        )?;

        let mut seen = HashSet::new();
        let mut posts = Vec::new();
        for post in similar.into_iter().chain(hot) {
            if seen.insert(post.post_id) {
                posts.push(post);
            }
        }
        if posts.is_empty() {
            return Ok(Vec::new());
        }

        let similarities = match vector.as_deref() {
            Some(vector) => self.similarities(vector, &posts).await?,
            None => HashMap::new(),
        };

        let now = Utc::now();
        let scores: HashMap<i64, f64> = posts
            .iter()
            .map(|post| {
                (
                    post.post_id,
                    social::score_post(
                        post.likes,
                        social::age_days(post.created_at, now),
                        similarities.get(&post.post_id).copied().unwrap_or(0.0),
                    ),
                )
            })
            .collect();
        posts.sort_by(|a, b| {
            let score = |post: &FeedCandidate| scores.get(&post.post_id).copied().unwrap_or(0.0);
            score(b)
                .partial_cmp(&score(a))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let page_ids: Vec<i64> = posts
            .iter()
            .take(social::FEED_SIZE as usize)
            .map(|post| post.post_id)
            .collect();

        let (_, page) = tokio::try_join!(
            social::mark_posts_loaded(db, user_id, &page_ids),
            social::get_posts(db, user_id, &page_ids),
        )?;
        Ok(page)
    }

    /// Posts whose topic is `topic_mk_id`, most liked first.
    pub async fn topic_posts(
        &self,
        db: &DatabaseConnection,
        viewer_id: Uuid,
        topic_mk_id: &str,
    ) -> Result<Vec<SocialPost>, CadenzaError> {
        social::get_topic_posts(db, viewer_id, topic_mk_id).await
    }

    /// Profile header plus that author's posts, newest first.
    pub async fn user_posts(
        &self,
        db: &DatabaseConnection,
        viewer_id: Uuid,
        author_id: Uuid,
    ) -> Result<(PublicProfile, Vec<SocialPost>), CadenzaError> {
        let (posts, profile) = tokio::try_join!(
            social::get_author_posts(db, viewer_id, author_id),
            social::find_public_profile(db, author_id),
        )?;
        let profile = profile.unwrap_or_else(|| PublicProfile {
            user_id: author_id,
            username: posts
                .first()
                .map(|post| post.author_username.clone())
                .unwrap_or_else(|| "unknown".to_owned()),
            bio: String::new(),
        });
        Ok((profile, posts))
    }

    /// Moves each named interest by its delta, embedding any name that has no
    /// vector yet.
    pub async fn update_interests(
        &self,
        db: &DatabaseConnection,
        user_id: Uuid,
        deltas: &[InterestDelta],
    ) -> Result<(), CadenzaError> {
        if deltas.is_empty() {
            return Ok(());
        }
        let rows = social::upsert_interests(db, deltas).await?;
        let missing: Vec<UpsertedInterest> = rows
            .iter()
            .filter(|row| !row.embedding_exists)
            .cloned()
            .collect();
        if !missing.is_empty() {
            let embeddings = self.embed_interests(&missing).await?;
            let ids: Vec<i64> = missing.iter().map(|row| row.interest_id).collect();
            social::set_interest_embeddings(db, &ids, &embeddings).await?;
        }

        let id_by_key: HashMap<(String, String), i64> = rows
            .into_iter()
            .map(|row| ((row.name, row.interest_type), row.interest_id))
            .collect();
        let mut interest_ids = Vec::with_capacity(deltas.len());
        let mut amounts = Vec::with_capacity(deltas.len());
        for delta in deltas {
            let key = (delta.name.clone(), delta.interest_type.clone());
            let Some(id) = id_by_key.get(&key) else {
                return Err(CadenzaError::DatabaseError(
                    "interest upsert did not return a row".into(),
                ));
            };
            interest_ids.push(*id);
            amounts.push(delta.delta);
        }
        social::add_interest_scores(db, user_id, &interest_ids, &amounts).await
    }

    pub async fn decay_interests(
        &self,
        db: &DatabaseConnection,
        user_id: Uuid,
    ) -> Result<(), CadenzaError> {
        social::decay_interests(db, user_id).await
    }

    /// Likes `post_id` unless `timestamp` is older than the last click this
    /// process accepted for the pair.
    pub async fn like_post(
        &self,
        db: &DatabaseConnection,
        user_id: Uuid,
        post_id: i64,
        timestamp: i64,
    ) -> Result<(), CadenzaError> {
        if !self
            .likes
            .lock()
            .expect("like memory")
            .accept(user_id, post_id, timestamp)
        {
            return Ok(());
        }
        if let Err(err) = social::like_post(db, user_id, post_id).await {
            self.likes
                .lock()
                .expect("like memory")
                .forget(user_id, post_id, timestamp);
            return Err(err);
        }
        Ok(())
    }

    /// Removes a like. Same timestamp rule as [`Self::like_post`].
    pub async fn unlike_post(
        &self,
        db: &DatabaseConnection,
        user_id: Uuid,
        post_id: i64,
        timestamp: i64,
    ) -> Result<(), CadenzaError> {
        if !self
            .likes
            .lock()
            .expect("like memory")
            .accept(user_id, post_id, timestamp)
        {
            return Ok(());
        }
        if let Err(err) = social::unlike_post(db, user_id, post_id).await {
            self.likes
                .lock()
                .expect("like memory")
                .forget(user_id, post_id, timestamp);
            return Err(err);
        }
        Ok(())
    }

    pub async fn mark_posts_viewed(
        &self,
        db: &DatabaseConnection,
        user_id: Uuid,
        post_ids: &[i64],
    ) -> Result<(), CadenzaError> {
        social::mark_posts_viewed(db, user_id, post_ids).await
    }

    async fn embed_post(&self, content: &str) -> Result<Vec<f64>, CadenzaError> {
        let response: EmbedResponse = self
            .post_json(
                "/embedding",
                &EmbedBody {
                    content: Some(content.to_owned()),
                    interests: Vec::new(),
                },
            )
            .await?;
        response
            .embedding
            .ok_or_else(|| CadenzaError::SocialFeedErr("embedding response had no vector".into()))
    }

    async fn embed_interests(
        &self,
        interests: &[UpsertedInterest],
    ) -> Result<Vec<Vec<f64>>, CadenzaError> {
        let response: EmbedResponse = self
            .post_json(
                "/embedding",
                &EmbedBody {
                    content: None,
                    interests: interests
                        .iter()
                        .map(|interest| InterestText {
                            name: interest.name.clone(),
                            itype: interest.interest_type.clone(),
                        })
                        .collect(),
                },
            )
            .await?;
        if response.interest_embeddings.len() != interests.len() {
            return Err(CadenzaError::SocialFeedErr(
                "interest embedding count did not match".into(),
            ));
        }
        Ok(response.interest_embeddings)
    }

    async fn similarities(
        &self,
        user_vector: &[f64],
        posts: &[FeedCandidate],
    ) -> Result<HashMap<i64, f64>, CadenzaError> {
        let response: SimilarityResponse = self
            .post_json(
                "/posts/similarities",
                &SimilarityBody {
                    user_vector: user_vector.to_vec(),
                    posts: posts
                        .iter()
                        .map(|post| SimilarityPost {
                            post_id: post.post_id,
                            embedding: post.embedding.clone(),
                        })
                        .collect(),
                },
            )
            .await?;
        Ok(response
            .similarities
            .into_iter()
            .map(|row| (row.post_id, row.similarity))
            .collect())
    }

    async fn post_json<B, T>(&self, path: &str, body: &B) -> Result<T, CadenzaError>
    where
        B: Serialize,
        T: for<'de> Deserialize<'de>,
    {
        let url = format!("{}{}", self.base_url, path);
        let response = self
            .http
            .post(url)
            .json(body)
            .send()
            .await
            .map_err(|err| CadenzaError::SocialFeedErr(err.to_string()))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|err| CadenzaError::SocialFeedErr(err.to_string()))?;
        if !status.is_success() {
            return Err(CadenzaError::SocialFeedErr(format!(
                "{status}: {}",
                String::from_utf8_lossy(&bytes)
            )));
        }
        serde_json::from_slice(&bytes).map_err(|err| CadenzaError::SocialFeedErr(err.to_string()))
    }
}

/// Prefix for the embedding when a post has a topic. Names come from the
/// create-post body, not Apple. `None` when there is not enough to format.
fn topic_embedding_prefix(song_title: Option<&str>, artist_name: Option<&str>) -> Option<String> {
    match (song_title, artist_name) {
        (Some(song), Some(artist)) => Some(format!("About the song {song} by {artist}: ")),
        (None, Some(artist)) => Some(format!("About the music artist {artist}: ")),
        _ => None,
    }
}

/// A stored vector is reused until it is over 10 minutes old.
fn user_vector_is_fresh(calculated_at: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    now.signed_duration_since(calculated_at) <= chrono::Duration::minutes(10)
}

#[derive(Default)]
struct UserVectorCache {
    /// `user_id -> (vector, calculated_at, last_touch)`.
    entries: HashMap<Uuid, (Option<Vec<f64>>, DateTime<Utc>, u64)>,
    tick: u64,
}

impl UserVectorCache {
    /// The vector from the last calculation, when that calculation is still fresh.
    /// `Some(None)` is a fresh calculation that produced no vector.
    fn get(&mut self, user_id: Uuid, now: DateTime<Utc>) -> Option<Option<Vec<f64>>> {
        let fresh = self
            .entries
            .get(&user_id)
            .is_some_and(|(_, calculated_at, _)| user_vector_is_fresh(*calculated_at, now));
        if !fresh {
            return None;
        }
        self.touch(user_id);
        self.entries
            .get(&user_id)
            .map(|(vector, _, _)| vector.clone())
    }

    fn insert(&mut self, user_id: Uuid, vector: Option<Vec<f64>>, calculated_at: DateTime<Utc>) {
        self.tick += 1;
        let tick = self.tick;
        self.entries.insert(user_id, (vector, calculated_at, tick));
        self.evict();
    }

    fn touch(&mut self, user_id: Uuid) {
        self.tick += 1;
        let tick = self.tick;
        if let Some(entry) = self.entries.get_mut(&user_id) {
            entry.2 = tick;
        }
    }

    fn evict(&mut self) {
        if self.entries.len() <= USER_VECTOR_CACHE {
            return;
        }
        if let Some(oldest) = self
            .entries
            .iter()
            .min_by_key(|(_, (_, _, touch))| *touch)
            .map(|(user_id, _)| *user_id)
        {
            self.entries.remove(&oldest);
        }
    }
}

#[derive(Default)]
struct LikeMemory {
    /// `(user, post) -> (timestamp_ms, last_touch)`.
    entries: HashMap<(Uuid, i64), (i64, u64)>,
    tick: u64,
}

impl LikeMemory {
    /// Returns false when `timestamp` is older than the one already stored.
    fn accept(&mut self, user_id: Uuid, post_id: i64, timestamp: i64) -> bool {
        let key = (user_id, post_id);
        if let Some((previous, _)) = self.entries.get(&key)
            && timestamp < *previous
        {
            return false;
        }
        self.tick += 1;
        let tick = self.tick;
        self.entries.insert(key, (timestamp, tick));
        if self.entries.len() > LIKE_MEMORY {
            if let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, (_, touch))| *touch)
                .map(|(key, _)| *key)
            {
                self.entries.remove(&oldest);
            }
        }
        true
    }

    fn forget(&mut self, user_id: Uuid, post_id: i64, timestamp: i64) {
        let key = (user_id, post_id);
        if self
            .entries
            .get(&key)
            .is_some_and(|(stored, _)| *stored == timestamp)
        {
            self.entries.remove(&key);
        }
    }
}

#[derive(Serialize)]
struct EmbedBody {
    content: Option<String>,
    interests: Vec<InterestText>,
}

#[derive(Serialize)]
struct InterestText {
    name: String,
    itype: String,
}

#[derive(Deserialize)]
struct EmbedResponse {
    embedding: Option<Vec<f64>>,
    #[serde(default)]
    interest_embeddings: Vec<Vec<f64>>,
}

#[derive(Serialize)]
struct SimilarityBody {
    user_vector: Vec<f64>,
    posts: Vec<SimilarityPost>,
}

#[derive(Serialize)]
struct SimilarityPost {
    post_id: i64,
    embedding: Vec<f64>,
}

#[derive(Deserialize)]
struct SimilarityResponse {
    similarities: Vec<PostSimilarity>,
}

#[derive(Deserialize)]
struct PostSimilarity {
    post_id: i64,
    similarity: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn topic_prefix_uses_song_and_artist_or_just_the_artist() {
        assert_eq!(
            topic_embedding_prefix(Some("As It Was"), Some("Harry Styles")).as_deref(),
            Some("About the song As It Was by Harry Styles: ")
        );
        assert_eq!(
            topic_embedding_prefix(None, Some("Harry Styles")).as_deref(),
            Some("About the music artist Harry Styles: ")
        );
        assert_eq!(topic_embedding_prefix(Some("As It Was"), None), None);
        assert_eq!(topic_embedding_prefix(None, None), None);
    }

    #[test]
    fn an_older_click_is_ignored_and_a_newer_one_replaces_it() {
        let mut memory = LikeMemory::default();
        let user = Uuid::nil();
        assert!(memory.accept(user, 1, 20));
        assert!(!memory.accept(user, 1, 10));
        assert!(memory.accept(user, 1, 30));
    }

    #[test]
    fn a_vector_is_reused_until_it_is_over_ten_minutes_old() {
        let mut cache = UserVectorCache::default();
        let user = Uuid::nil();
        let now = Utc::now();
        cache.insert(user, Some(vec![1.0, 0.0]), now);

        assert_eq!(
            cache.get(user, now + chrono::Duration::minutes(10)),
            Some(Some(vec![1.0, 0.0]))
        );
        assert_eq!(
            cache.get(
                user,
                now + chrono::Duration::minutes(10) + chrono::Duration::seconds(1)
            ),
            None
        );
    }

    #[test]
    fn a_user_with_no_vector_stays_cached() {
        let mut cache = UserVectorCache::default();
        let user = Uuid::nil();
        let now = Utc::now();
        cache.insert(user, None, now);
        assert_eq!(cache.get(user, now), Some(None));
    }

    #[test]
    fn the_least_recently_read_vector_is_dropped() {
        let mut cache = UserVectorCache::default();
        let now = Utc::now();
        for i in 0..USER_VECTOR_CACHE {
            cache.insert(Uuid::from_u128(i as u128), Some(vec![1.0]), now);
        }
        let oldest = Uuid::from_u128(0);
        assert!(cache.get(oldest, now).is_some());
        cache.insert(
            Uuid::from_u128(USER_VECTOR_CACHE as u128),
            Some(vec![2.0]),
            now,
        );
        assert!(cache.get(Uuid::from_u128(1), now).is_none());
        assert!(cache.get(oldest, now).is_some());
    }

    #[test]
    fn forget_drops_only_the_timestamp_it_stored() {
        let mut memory = LikeMemory::default();
        let user = Uuid::nil();
        assert!(memory.accept(user, 1, 20));
        memory.forget(user, 1, 10);
        assert!(memory.entries.contains_key(&(user, 1)));
        memory.forget(user, 1, 20);
        assert!(memory.entries.is_empty());
    }
}
