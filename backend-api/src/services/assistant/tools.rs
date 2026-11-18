//! The tools the assistant's model may call. Every one only reads.
//!
//! A tool never fails the request. Bad arguments or a failed read come back to
//! the model as `{ "error": "..." }`, so it can fix its call and try again.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sea_orm::prelude::async_trait::async_trait;
use sea_orm::{DatabaseConnection, prelude::Uuid};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::db::{
    self,
    activity_tags::ActivityTag,
    entity::tags,
    metadata_tags::SongRow,
    queries::{Arrangement, QueryMatch, QueryOptions, QuerySongs},
};
use crate::err::CadenzaError;
use crate::routes::json::{
    assistant::SongsCard,
    query::{Query, QuerySort},
    tag::TagType,
};
use crate::services::analytics::{Dimension, TimeWindow};
use crate::services::metadata_tags::spawn_store_song_metadata;
use crate::services::song_metadata::{SongMetadata, SongMetadataService};

/// The most songs a tool describes to the model. The rest are only counted.
pub const MAX_SONGS_TO_MODEL: usize = 25;
/// The most song ids the song card under an answer gets.
pub const MAX_CARD_SONGS: usize = 250;
/// The most of a tool call's arguments and output written to the server log.
const MAX_LOGGED_CHARS: usize = 300;
/// The most songs `get_song_metadata` and `get_song_tags` look up in one call.
const MAX_METADATA_SONGS: usize = 25;
/// The most saved queries or playlists one list hands the model.
const MAX_LISTED: usize = 50;
const DEFAULT_TOP_LIMIT: u64 = 10;
const MAX_TOP_LIMIT: u64 = 25;

/// What one tool call produced.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolOutcome {
    /// What the model reads back.
    pub output: Value,
    /// The status row the phone shows, like "Ran a query".
    pub label: String,
    /// Songs to show under the answer, when the tool found some.
    pub songs: Option<SongsCard>,
}

impl ToolOutcome {
    fn ok(output: Value, label: &str) -> Self {
        Self {
            output,
            label: label.to_owned(),
            songs: None,
        }
    }

    fn error(message: impl Into<String>, label: &str) -> Self {
        Self::ok(json!({ "error": message.into() }), label)
    }
}

/// Runs the tool calls the model asks for. A trait so the loop can be tested
/// without a database.
#[async_trait]
pub trait ToolRunner: Send + Sync {
    async fn run(&self, name: &str, arguments: &str) -> ToolOutcome;
}

/// The most songs `find_songs` looks up in one call.
const MAX_FOUND_SONGS: usize = 25;
/// How many catalog results `find_songs` weighs for each song it looks up.
const FIND_CANDIDATES: usize = 5;

/// The tools, run against the database as one user.
pub struct DbTools<'a> {
    pub db: &'a DatabaseConnection,
    pub song_meta: &'a SongMetadataService,
    pub user_id: Uuid,
    pub hide_explicit: bool,
}

#[async_trait]
impl ToolRunner for DbTools<'_> {
    async fn run(&self, name: &str, arguments: &str) -> ToolOutcome {
        let label = label_for(name);
        let args: Value = match serde_json::from_str(if arguments.trim().is_empty() {
            "{}"
        } else {
            arguments
        }) {
            Ok(args) => args,
            Err(err) => return ToolOutcome::error(format!("arguments are not JSON: {err}"), label),
        };

        let result = match name {
            "list_tags" => self.list_tags().await,
            "run_query" => self.run_query(args).await,
            "get_song_metadata" => self.get_song_metadata(args).await,
            "top_items" => self.top_items(args).await,
            "listening_summary" => self.listening_summary(args).await,
            "list_saved_queries" => self.list_saved_queries().await,
            "get_saved_query_songs" => self.get_saved_query_songs(args).await,
            "get_song_tags" => self.get_song_tags(args).await,
            "list_playlists" => self.list_playlists().await,
            "get_playlist_songs" => self.get_playlist_songs(args).await,
            "find_songs" => self.find_songs(args).await,
            _ => return ToolOutcome::error(format!("there is no tool named {name}"), label),
        };
        let outcome = match result {
            Ok(mut outcome) => {
                outcome.label = label.to_owned();
                outcome
            }
            Err(ToolError::Arguments(message)) => ToolOutcome::error(message, label),
            Err(ToolError::Cadenza(err)) => ToolOutcome::error(err.to_string(), label),
        };
        // what the model asked for and got back, so a wrong answer can be traced
        println!(
            "[assistant] {name} {} -> {}",
            clip(arguments),
            clip(&outcome.output.to_string()),
        );
        outcome
    }
}

/// `text` cut to [`MAX_LOGGED_CHARS`] characters for the log.
fn clip(text: &str) -> String {
    if text.chars().count() <= MAX_LOGGED_CHARS {
        return text.to_owned();
    }
    let cut: String = text.chars().take(MAX_LOGGED_CHARS).collect();
    format!("{cut}...")
}

#[derive(Debug)]
enum ToolError {
    /// The model's arguments were wrong. It can fix them.
    Arguments(String),
    /// A read failed.
    Cadenza(CadenzaError),
}

impl From<CadenzaError> for ToolError {
    fn from(err: CadenzaError) -> Self {
        Self::Cadenza(err)
    }
}

fn parse_args<T: for<'de> Deserialize<'de>>(args: Value) -> Result<T, ToolError> {
    serde_json::from_value(args)
        .map_err(|err| ToolError::Arguments(format!("bad arguments: {err}")))
}

/// The status row for a tool, shown whether or not it worked.
fn label_for(name: &str) -> &'static str {
    match name {
        "list_tags" => "Looked up your tags",
        "run_query" => "Ran a query",
        "get_song_metadata" => "Looked up song details",
        "top_items" => "Checked your top plays",
        "listening_summary" => "Checked your listening stats",
        "list_saved_queries" => "Looked up your saved queries",
        "get_saved_query_songs" => "Opened a saved query",
        "get_song_tags" => "Looked up song tags",
        "list_playlists" => "Looked up your playlists",
        "get_playlist_songs" => "Looked up a playlist's songs",
        "find_songs" => "Found songs on Apple Music",
        _ => "Tried a tool",
    }
}

/// A song as the model sees it: id, title, and artist from its stored row.
/// A song with no row still appears, by id.
pub fn describe_song(song_id: &str, row: Option<&SongRow>) -> Value {
    json!({
        "song_id": song_id,
        "title": row.map(|row| row.name.clone()),
        "artist": row.and_then(|row| row.artist_name.clone()),
    })
}

/// The user's own tags as the model sees them, in the prompt and from `list_tags`.
pub fn describe_tags(tags: &[tags::Model]) -> Vec<Value> {
    tags.iter()
        .map(|tag| {
            json!({
                "id": tag.tag_id,
                "name": tag.name,
                "type": TagType::from(tag.r#type.clone()),
            })
        })
        .collect()
}

/// The activity tags as the model sees them in the prompt: the shared tags
/// whose values come from the user's own listening, with what each one means.
pub fn describe_activity_tags(tags: &[(ActivityTag, tags::Model)]) -> Vec<Value> {
    tags.iter()
        .map(|(activity, tag)| {
            json!({
                "id": tag.tag_id,
                "name": tag.name,
                "type": TagType::from(tag.r#type.clone()),
                "means": activity_meaning(*activity),
            })
        })
        .collect()
}

/// What an activity tag holds, and how to filter on it, for the prompt.
fn activity_meaning(tag: ActivityTag) -> &'static str {
    match tag {
        ActivityTag::MyPlays => {
            "How many times the user has played the song; 0 if never. Number ops: eq, ne, lt, le, gt, ge."
        }
        ActivityTag::FirstPlayed => {
            "When the user first played the song. before, after, on, on_or_before, on_or_after with an RFC 3339 time; is_empty for never played."
        }
        ActivityTag::LastPlayed => {
            "When the user last played the song. before, after, on, on_or_before, on_or_after with an RFC 3339 time; is_empty for never played."
        }
        ActivityTag::InMyLibrary => {
            "Whether the song is in the user's Apple Music library. is_true or is_false."
        }
        ActivityTag::Favorited => {
            "Whether the user favorited the song in Cadenza. is_true or is_false."
        }
        ActivityTag::Tagged => {
            "Whether the user put any tag of their own on the song. is_true or is_false."
        }
    }
}

#[derive(Deserialize)]
struct RunQueryArgs {
    query: Value,
    /// `everything` (the default) or `mine`.
    #[serde(default)]
    scope: Option<String>,
    /// How to order the songs, as a `QuerySort`. Left out, the query's own
    /// order: the user's songs first, most relevant first.
    #[serde(default)]
    sort: Option<Value>,
    /// How many songs to hand back, in order, when the user asked for a number
    /// of them. Left out, all of them (the card still lists at most
    /// [`MAX_CARD_SONGS`]).
    #[serde(default)]
    limit: Option<u64>,
    /// The model's short name for the list, for the card's title.
    #[serde(default)]
    title: Option<String>,
}

/// The `limit` the model asked for, kept to 1 through [`MAX_CARD_SONGS`].
fn picked_count(limit: Option<u64>) -> Option<usize> {
    limit.map(|limit| (limit.min(MAX_CARD_SONGS as u64) as usize).max(1))
}

/// The arrangement for `run_query`: sorted by `sort` when the model gave one,
/// otherwise the query's own order. Never grouped.
fn arrangement_for(sort: Option<Value>) -> Result<Arrangement, ToolError> {
    let Some(sort) = sort.filter(|sort| !sort.is_null()) else {
        return Ok(Arrangement::default());
    };
    let sort: QuerySort = serde_json::from_value(sort)
        .map_err(|err| ToolError::Arguments(format!("the sort is not valid: {err}")))?;
    Ok(Arrangement {
        sort: Some(sort),
        ..Arrangement::default()
    })
}

/// Which songs `run_query` searches. Every song Cadenza knows unless the model
/// asks for `mine`, the user's library and tagged songs. The app's own "Show
/// songs only in library or tagged" setting does not apply here.
fn query_songs_for(scope: Option<&str>) -> Result<QuerySongs, ToolError> {
    match scope {
        None | Some("everything") => Ok(QuerySongs::Everything),
        Some("mine") => Ok(QuerySongs::LibraryOrTagged),
        Some(other) => Err(ToolError::Arguments(format!(
            "scope must be everything or mine, not {other}"
        ))),
    }
}

/// How many of `songs` are the user's own (in their library or tagged), and
/// how many come from elsewhere.
fn count_yours(songs: &[QueryMatch]) -> (usize, usize) {
    let yours = songs.iter().filter(|song| song.certain).count();
    (yours, songs.len() - yours)
}

/// The `run_query` scope that matches a saved query's "library or tagged" option.
fn scope_of_saved(library_or_tagged: bool) -> &'static str {
    if library_or_tagged {
        "mine"
    } else {
        "everything"
    }
}

/// Tags on a song as the model sees them: name, type, and the value for an
/// attribute or activity tag.
fn describe_applied(tags: Vec<(tags::Model, Option<String>)>) -> Vec<Value> {
    tags.into_iter()
        .map(|(tag, value)| {
            json!({
                "id": tag.tag_id,
                "name": tag.name,
                "type": TagType::from(tag.r#type),
                "value": value,
            })
        })
        .collect()
}

#[derive(Deserialize)]
struct SavedQueryArgs {
    saved_query_id: i64,
}

#[derive(Deserialize)]
struct FindSongsArgs {
    songs: Vec<WantedSong>,
    #[serde(default)]
    title: Option<String>,
}

/// A song the model named, to look up in the catalog.
#[derive(Deserialize, Clone)]
struct WantedSong {
    title: String,
    #[serde(default)]
    artist: Option<String>,
}

/// Lowercase letters, digits, and single spaces, with anything in brackets and any
/// " - Remastered" style suffix dropped, for comparing titles and artist names.
fn match_key(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut depth = 0usize;
    // a suffix like " - Remastered 2011" or " - From \"Halo\"" is not part of the title
    let text = text.split(" - ").next().unwrap_or(text);
    for c in text.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth > 0 => {}
            c if c.is_alphanumeric() => out.extend(c.to_lowercase()),
            _ => out.push(' '),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Whether a catalog title is the title the model named: the same once brackets and
/// suffixes are dropped, or one starting with the other's whole words.
fn titles_match(wanted: &str, found: &str) -> bool {
    let (wanted, found) = (match_key(wanted), match_key(found));
    if wanted.is_empty() || found.is_empty() {
        return false;
    }
    // a prefix counts only as whole words, so "Halo" is not "Halogen"
    let starts_with_words =
        |long: &str, short: &str| short.len() >= 4 && long.starts_with(&format!("{short} "));
    wanted == found || starts_with_words(&found, &wanted) || starts_with_words(&wanted, &found)
}

/// Whether a catalog artist credit is the artist the model named, or credits them among
/// others ("Frank Ocean" in "Frank Ocean & André 3000").
fn artists_match(wanted: &str, found: &str) -> bool {
    let (wanted, found) = (match_key(wanted), match_key(found));
    !wanted.is_empty() && (found.contains(&wanted) || wanted.contains(&found))
}

/// The catalog song that is the one the model named: the first result whose title and
/// artist both match, or with no artist named, the first whose title matches. None
/// rather than a guess, so a wrong song never lands on the card.
fn pick_match(wanted: &WantedSong, candidates: Vec<SongMetadata>) -> Option<SongMetadata> {
    let artist = wanted
        .artist
        .as_deref()
        .map(str::trim)
        .filter(|a| !a.is_empty());
    candidates.into_iter().find(|song| {
        titles_match(&wanted.title, &song.title)
            && artist.is_none_or(|artist| artists_match(artist, &song.artist_name))
    })
}

#[derive(Deserialize)]
struct PlaylistArgs {
    playlist_id: i64,
}

#[derive(Deserialize)]
struct SongIdsArgs {
    song_ids: Vec<String>,
}

#[derive(Deserialize)]
struct WindowArgs {
    #[serde(default)]
    since: Option<DateTime<Utc>>,
    #[serde(default)]
    until: Option<DateTime<Utc>>,
}

impl WindowArgs {
    fn window(&self) -> Result<TimeWindow, ToolError> {
        TimeWindow::new(self.since, self.until)
            .map_err(|_| ToolError::Arguments("since must be before until".to_owned()))
    }
}

#[derive(Deserialize)]
struct TopItemsArgs {
    kind: String,
    #[serde(flatten)]
    window: WindowArgs,
    #[serde(default)]
    limit: Option<u64>,
    /// The model's short name for a song ranking, for the card's title.
    #[serde(default)]
    title: Option<String>,
}

/// The most characters a card title keeps. Longer ones are cut at a word.
const MAX_TITLE_CHARS: usize = 32;

/// Small words a title leaves lowercase unless they come first.
const TITLE_SMALL_WORDS: &[&str] = &[
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of", "on", "or", "the",
    "to", "vs", "with",
];

/// A card title from the model, made to read like a title: trimmed, no quotes
/// around it or punctuation at its end, every all-lowercase word capitalized
/// (small words too when first), and cut at a word past
/// [`MAX_TITLE_CHARS`]. A word with a capital already ("iPhone", "R&B",
/// "AC/DC") is left as written. None when nothing is left.
pub(super) fn card_title(title: Option<String>) -> Option<String> {
    let title = title?;
    let mut title = title
        .trim()
        .trim_matches(|c: char| matches!(c, '"' | '\u{201c}' | '\u{201d}'))
        .trim();
    // single quotes only when they wrap the whole title, so "'90s" keeps its own
    if title.len() > 1 && title.starts_with('\'') && title.ends_with('\'') {
        title = title[1..title.len() - 1].trim();
    }
    let title = title
        .trim_end_matches(['.', '!', '?', ',', ';', ':'])
        .trim();

    let mut words: Vec<String> = Vec::new();
    let mut length = 0;
    for (index, word) in title.split_whitespace().enumerate() {
        let added = if index == 0 {
            word.chars().count()
        } else {
            word.chars().count() + 1
        };
        if index > 0 && length + added > MAX_TITLE_CHARS {
            break;
        }
        length += added;
        words.push(title_case_word(word, index == 0));
    }
    let mut title = words.join(" ");
    if title.chars().count() > MAX_TITLE_CHARS {
        // one word longer than the cap
        title = title.chars().take(MAX_TITLE_CHARS).collect();
    }
    let title = title
        .trim_end_matches(['.', '!', '?', ',', ';', ':', '-'])
        .trim_end()
        .to_owned();
    (!title.is_empty()).then_some(title)
}

/// `word` with its first letter capitalized when it is all lowercase and not a
/// small word in the middle of the title.
fn title_case_word(word: &str, first: bool) -> String {
    let all_lowercase = word.chars().all(|c| !c.is_uppercase());
    let bare = word
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    if !all_lowercase || (!first && TITLE_SMALL_WORDS.contains(&bare.as_str())) {
        return word.to_owned();
    }
    let mut chars = word.chars();
    let mut out = String::with_capacity(word.len());
    // past any leading punctuation, like the quote in "'90s"; a word that
    // starts with a digit ("90s", "2010s") is left alone
    for c in chars.by_ref() {
        if c.is_alphanumeric() {
            out.extend(c.to_uppercase());
            break;
        }
        out.push(c);
    }
    out.extend(chars);
    out
}

impl DbTools<'_> {
    async fn list_tags(&self) -> Result<ToolOutcome, ToolError> {
        let tags = db::tags::get_all_user_tags(self.db, self.user_id).await?;
        Ok(ToolOutcome::ok(json!({ "tags": describe_tags(&tags) }), ""))
    }

    async fn run_query(&self, args: Value) -> Result<ToolOutcome, ToolError> {
        let args: RunQueryArgs = parse_args(args)?;
        let query: Query = serde_json::from_value(args.query)
            .map_err(|err| ToolError::Arguments(format!("the query is not valid: {err}")))?;
        let songs = query_songs_for(args.scope.as_deref())?;
        let arrangement = arrangement_for(args.sort)?;
        let sorted = arrangement.sort.is_some();
        let options = QueryOptions {
            consider_default_tags: false,
            songs,
            hide_explicit: self.hide_explicit,
        };
        let matches = db::queries::run_query(self.db, &query, self.user_id, options, &arrangement)
            .await
            .map_err(|err| match err {
                // a query the compiler rejects is the model's to fix
                CadenzaError::QueryFormatError(message) => ToolError::Arguments(message),
                other => ToolError::Cadenza(other),
            })?;

        let (yours, elsewhere) = count_yours(&matches.songs);
        let total = matches.songs.len();
        // with a limit, only the first `limit` in order are the answer: the card
        // holds just those, and Play queues just those
        let limit = picked_count(args.limit);
        let picked = &matches.songs[..limit.map_or(total, |limit| limit.min(total))];
        let described = self.describe_songs(picked).await?;
        let song_ids: Vec<String> = picked
            .iter()
            .take(MAX_CARD_SONGS)
            .map(|song| song.song_id.clone())
            .collect();
        let mut outcome = ToolOutcome::ok(
            json!({
                "scope": if songs == QuerySongs::Everything { "everything" } else { "mine" },
                "total": total,
                "yours": yours,
                "elsewhere": elsewhere,
                "sorted": sorted,
                // unsorted, only the songs from elsewhere are cut off; sorted,
                // every song counts toward the limit
                "capped": matches.capped,
                "limit": limit,
                // how many songs this answer is made of: `limit` of them, or all
                "returned": picked.len(),
                "songs": described,
                "songs_shown": described.len(),
                // how many the song card under the answer lists
                "card_shows": song_ids.len(),
            }),
            "",
        );
        if !song_ids.is_empty() {
            outcome.songs = Some(SongsCard {
                // a limited answer is complete at its own size, so the card
                // shows no "more" for the songs left out on purpose
                total: if limit.is_some() { picked.len() } else { total },
                capped: limit.is_none() && matches.capped,
                song_ids,
                title: card_title(args.title),
            });
        }
        Ok(outcome)
    }

    async fn get_song_metadata(&self, args: Value) -> Result<ToolOutcome, ToolError> {
        let args: SongIdsArgs = parse_args(args)?;
        if args.song_ids.len() > MAX_METADATA_SONGS {
            return Err(ToolError::Arguments(format!(
                "ask for at most {MAX_METADATA_SONGS} songs at a time"
            )));
        }
        let rows = db::metadata_tags::get_songs_metadata(self.db, &args.song_ids).await?;
        let songs: Vec<Value> = rows
            .into_iter()
            .filter(|row| row.found)
            .map(|row| {
                json!({
                    "song_id": row.song_id,
                    "title": row.name,
                    "artist": row.artist_name,
                    "album": row.album_name,
                    "genres": row.genre_names,
                    "release_date": row.release_date,
                    "duration_seconds": row.duration_in_millis.map(|ms| ms / 1000),
                    "explicit": row.content_rating.as_deref() == Some("explicit"),
                    "plays_by_everyone": row.total_plays,
                })
            })
            .collect();
        Ok(ToolOutcome::ok(json!({ "songs": songs }), ""))
    }

    async fn list_saved_queries(&self) -> Result<ToolOutcome, ToolError> {
        let saved = db::saved_queries::list_saved_queries(self.db, self.user_id).await?;
        let total = saved.len();
        let saved = &saved[..total.min(MAX_LISTED)];
        let ids: Vec<i64> = saved.iter().map(|query| query.saved_query_id).collect();
        let counts = db::saved_queries::count_songs(self.db, &ids).await?;
        let queries: Vec<Value> = saved
            .iter()
            .map(|query| {
                json!({
                    "id": query.saved_query_id,
                    "name": query.name,
                    "favorite": query.favorite,
                    "query": query.query,
                    "scope": scope_of_saved(query.library_or_tagged),
                    "stored_songs": counts.get(&query.saved_query_id).copied().unwrap_or(0),
                    "stored_at": query.songs_stored_at.map(|at| at.to_rfc3339()),
                })
            })
            .collect();
        Ok(ToolOutcome::ok(
            json!({ "total": total, "queries": queries }),
            "",
        ))
    }

    /// The songs a saved query holds, exactly as its screen lists them: the stored
    /// songs in stored order, not a fresh run of its query.
    async fn get_saved_query_songs(&self, args: Value) -> Result<ToolOutcome, ToolError> {
        let args: SavedQueryArgs = parse_args(args)?;
        let not_found = |err: CadenzaError| match err {
            CadenzaError::NotFound => ToolError::Arguments(format!(
                "the user has no saved query with id {}; call list_saved_queries for their ids",
                args.saved_query_id
            )),
            other => ToolError::Cadenza(other),
        };
        // for its name, which titles the card
        let saved =
            db::saved_queries::get_viewable_saved_query(self.db, self.user_id, args.saved_query_id)
                .await
                .map_err(not_found)?;
        let stored =
            crate::services::saved_queries::saved_songs(self.db, self.user_id, args.saved_query_id)
                .await
                .map_err(not_found)?;
        let songs: Vec<QueryMatch> = stored
            .into_iter()
            .map(|song| QueryMatch {
                song_id: song.song_id,
                certain: song.certain,
            })
            .collect();
        let (yours, elsewhere) = count_yours(&songs);
        let described = self.describe_songs(&songs).await?;
        let song_ids: Vec<String> = songs
            .iter()
            .take(MAX_CARD_SONGS)
            .map(|song| song.song_id.clone())
            .collect();
        let mut outcome = ToolOutcome::ok(
            json!({
                "total": songs.len(),
                "yours": yours,
                "elsewhere": elsewhere,
                "songs": described,
                "songs_shown": described.len(),
                "card_shows": song_ids.len(),
            }),
            "",
        );
        if !song_ids.is_empty() {
            outcome.songs = Some(SongsCard {
                total: songs.len(),
                capped: false,
                song_ids,
                title: Some(saved.name),
            });
        }
        Ok(outcome)
    }

    async fn get_song_tags(&self, args: Value) -> Result<ToolOutcome, ToolError> {
        let args: SongIdsArgs = parse_args(args)?;
        if args.song_ids.len() > MAX_METADATA_SONGS {
            return Err(ToolError::Arguments(format!(
                "ask for at most {MAX_METADATA_SONGS} songs at a time"
            )));
        }
        let mut own =
            db::tags::get_user_tags_on_songs(self.db, self.user_id, &args.song_ids).await?;
        let mut activity =
            db::activity_tags::get_activity_tags_on_songs(self.db, self.user_id, &args.song_ids)
                .await?;
        let songs: Vec<Value> = args
            .song_ids
            .iter()
            .map(|song_id| {
                json!({
                    "song_id": song_id,
                    "tags": describe_applied(own.remove(song_id).unwrap_or_default()),
                    "activity": describe_applied(activity.remove(song_id).unwrap_or_default()),
                })
            })
            .collect();
        Ok(ToolOutcome::ok(json!({ "songs": songs }), ""))
    }

    async fn list_playlists(&self) -> Result<ToolOutcome, ToolError> {
        let playlists = db::shared_playlists::list_my_playlists(self.db, self.user_id).await?;
        let total = playlists.len();
        let listed: Vec<Value> = playlists
            .iter()
            .take(MAX_LISTED)
            .map(|playlist| {
                json!({
                    "id": playlist.playlist_id,
                    "name": playlist.name,
                    "description": playlist.description,
                    "owner": playlist.owner_username,
                    "your_role": playlist.role,
                    "songs": playlist.song_count,
                    "members": playlist.member_count,
                    "updated_at": playlist.updated_at.to_rfc3339(),
                })
            })
            .collect();
        Ok(ToolOutcome::ok(
            json!({ "total": total, "playlists": listed }),
            "",
        ))
    }

    /// Looks up songs the model named in the Apple Music catalog, in its order, for a list
    /// no query can express ("iconic video game songs"). Each is one catalog search, all at
    /// once; only a result whose title and artist match counts, so a song Apple does not
    /// have is reported missing rather than swapped for something else.
    async fn find_songs(&self, args: Value) -> Result<ToolOutcome, ToolError> {
        let args: FindSongsArgs = parse_args(args)?;
        let wanted: Vec<WantedSong> = args
            .songs
            .into_iter()
            .filter(|song| !song.title.trim().is_empty())
            .take(MAX_FOUND_SONGS)
            .collect();
        if wanted.is_empty() {
            return Err(ToolError::Arguments(
                "songs needs at least one {title, artist}".to_owned(),
            ));
        }

        let mut searches = tokio::task::JoinSet::new();
        for (index, song) in wanted.iter().cloned().enumerate() {
            let service = self.song_meta.clone();
            searches.spawn(async move {
                let term = match song.artist.as_deref() {
                    Some(artist) if !artist.trim().is_empty() => {
                        format!("{} {}", song.title, artist)
                    }
                    _ => song.title.clone(),
                };
                let found = service
                    .search_songs(&term, FIND_CANDIDATES)
                    .await
                    .ok()
                    .and_then(|candidates| pick_match(&song, candidates));
                (index, found)
            });
        }
        let mut matches: Vec<Option<SongMetadata>> = vec![None; wanted.len()];
        while let Some(joined) = searches.join_next().await {
            if let Ok((index, found)) = joined {
                matches[index] = found;
            }
        }

        let mut seen = std::collections::HashSet::new();
        let mut found = Vec::new();
        let mut missing = Vec::new();
        for (song, matched) in wanted.iter().zip(matches) {
            match matched {
                Some(metadata) if seen.insert(metadata.id.clone()) => found.push(metadata),
                // the same song named twice
                Some(_) => {}
                None => missing.push(json!({ "title": song.title, "artist": song.artist })),
            }
        }
        if self.hide_explicit {
            found.retain(|song| song.content_rating.as_deref() != Some("explicit"));
        }

        let song_ids: Vec<String> = found.iter().map(|song| song.id.clone()).collect();
        // stored for queries and follow-up questions, off the answer's path
        spawn_store_song_metadata(self.db.clone(), self.song_meta.clone(), song_ids.clone());
        let described: Vec<Value> = found
            .iter()
            .map(|song| {
                json!({
                    "song_id": song.id,
                    "title": song.title,
                    "artist": song.artist_name,
                    "album": song.album_name,
                    "release_date": song.release_date,
                })
            })
            .collect();
        let mut outcome = ToolOutcome::ok(
            json!({
                "found": described.len(),
                "songs": described,
                // named but not on Apple Music here, or only under another title
                "not_found": missing,
            }),
            "",
        );
        if !song_ids.is_empty() {
            outcome.songs = Some(SongsCard {
                total: song_ids.len(),
                capped: false,
                song_ids,
                title: card_title(args.title),
            });
        }
        Ok(outcome)
    }

    async fn get_playlist_songs(&self, args: Value) -> Result<ToolOutcome, ToolError> {
        let args: PlaylistArgs = parse_args(args)?;
        let detail = db::shared_playlists::get_playlist(self.db, self.user_id, args.playlist_id)
            .await
            .map_err(|err| match err {
                // not a member reads the same as no such playlist, on purpose
                CadenzaError::NotFound => ToolError::Arguments(format!(
                    "the user is not in a shared playlist with id {}; call list_playlists for their ids",
                    args.playlist_id
                )),
                other => ToolError::Cadenza(other),
            })?;
        let names: HashMap<Uuid, &str> = detail
            .members
            .iter()
            .map(|member| (member.user_id, member.username.as_str()))
            .collect();
        let shown = &detail.entries[..detail.entries.len().min(MAX_SONGS_TO_MODEL)];
        let shown_ids: Vec<String> = shown.iter().map(|entry| entry.song_id.clone()).collect();
        let rows = db::metadata_tags::get_song_rows(self.db, &shown_ids).await?;
        let songs: Vec<Value> = shown
            .iter()
            .map(|entry| {
                let mut described = describe_song(&entry.song_id, rows.get(&entry.song_id));
                described["added_by"] =
                    entry.added_by.and_then(|id| names.get(&id).copied()).into();
                described
            })
            .collect();
        let members: Vec<Value> = detail
            .members
            .iter()
            .map(|member| json!({ "username": member.username, "role": member.role }))
            .collect();
        let total = detail.entries.len();
        let song_ids: Vec<String> = detail
            .entries
            .iter()
            .take(MAX_CARD_SONGS)
            .map(|entry| entry.song_id.clone())
            .collect();
        let mut outcome = ToolOutcome::ok(
            json!({
                "name": detail.header.name,
                "description": detail.header.description,
                "your_role": detail.my_role,
                "members": members,
                "total": total,
                "songs": songs,
                "songs_shown": songs.len(),
                "card_shows": song_ids.len(),
            }),
            "",
        );
        if !song_ids.is_empty() {
            outcome.songs = Some(SongsCard {
                total,
                capped: false,
                song_ids,
                title: Some(detail.header.name.clone()),
            });
        }
        Ok(outcome)
    }

    async fn top_items(&self, args: Value) -> Result<ToolOutcome, ToolError> {
        let args: TopItemsArgs = parse_args(args)?;
        let window = args.window.window()?;
        let limit = args
            .limit
            .unwrap_or(DEFAULT_TOP_LIMIT)
            .clamp(1, MAX_TOP_LIMIT);

        if args.kind == "tag" {
            let tags =
                db::analytics::get_top_tags_by_play(self.db, self.user_id, window, limit).await?;
            let items: Vec<Value> = tags
                .into_iter()
                .map(|tag| json!({ "tag_id": tag.tag_id, "name": tag.name, "plays": tag.plays }))
                .collect();
            return Ok(ToolOutcome::ok(json!({ "items": items }), ""));
        }

        let Some(dimension) = Dimension::from_name(&args.kind) else {
            return Err(ToolError::Arguments(format!(
                "kind must be one of song, artist, album, playlist, query, tag, not {}",
                args.kind
            )));
        };
        let entries =
            db::analytics::get_top_entities(self.db, self.user_id, dimension, window, limit)
                .await?;

        if dimension.name == "song" {
            let song_ids: Vec<String> = entries
                .iter()
                .map(|entry| entry.sample_song_id.clone())
                .collect();
            let rows = db::metadata_tags::get_song_rows(self.db, &song_ids).await?;
            let items: Vec<Value> = entries
                .iter()
                .map(|entry| {
                    let mut described =
                        describe_song(&entry.sample_song_id, rows.get(&entry.sample_song_id));
                    described["plays"] = entry.plays.into();
                    described
                })
                .collect();
            let mut outcome = ToolOutcome::ok(json!({ "items": items }), "");
            if !song_ids.is_empty() {
                outcome.songs = Some(SongsCard {
                    total: song_ids.len(),
                    song_ids,
                    capped: false,
                    title: card_title(args.title).or_else(|| Some("Your Top Songs".to_owned())),
                });
            }
            return Ok(outcome);
        }

        let items: Vec<Value> = entries
            .into_iter()
            .map(|entry| {
                json!({
                    "name": entry.label,
                    "detail": entry.sub_label,
                    "plays": entry.plays,
                })
            })
            .collect();
        Ok(ToolOutcome::ok(json!({ "items": items }), ""))
    }

    async fn listening_summary(&self, args: Value) -> Result<ToolOutcome, ToolError> {
        let args: WindowArgs = parse_args(args)?;
        let summary: HashMap<String, i64> =
            db::analytics::get_summary(self.db, self.user_id, args.window()?).await?;
        let minutes = summary.get("listening_ms").copied().unwrap_or(0) / 60_000;
        Ok(ToolOutcome::ok(
            json!({ "summary": summary, "listening_minutes": minutes }),
            "",
        ))
    }

    /// Title, artist, and whether it is the user's own, for the first songs in
    /// `songs`, in order, from the stored metadata. A song with none stored
    /// still appears, by id.
    async fn describe_songs(&self, songs: &[QueryMatch]) -> Result<Vec<Value>, CadenzaError> {
        let shown = &songs[..songs.len().min(MAX_SONGS_TO_MODEL)];
        let ids: Vec<String> = shown.iter().map(|song| song.song_id.clone()).collect();
        let rows = db::metadata_tags::get_song_rows(self.db, &ids).await?;
        Ok(shown
            .iter()
            .map(|song| {
                let mut described = describe_song(&song.song_id, rows.get(&song.song_id));
                described["yours"] = song.certain.into();
                described
            })
            .collect())
    }
}

/// The tool definitions sent to the model.
pub fn definitions() -> Vec<Value> {
    let window = json!({
        "since": {
            "type": "string",
            "description": "Start of the window, inclusive, RFC 3339 with offset, like 2026-11-02T00:00:00-07:00. Leave out for no start."
        },
        "until": {
            "type": "string",
            "description": "End of the window, exclusive, RFC 3339 with offset. Leave out for now."
        }
    });
    let mut top_properties = json!({
        "kind": {
            "type": "string",
            "enum": ["song", "artist", "album", "playlist", "query", "tag"],
            "description": "What to rank."
        },
        "limit": { "type": "integer", "description": "How many, 1 to 25. Defaults to 10." },
        "title": {
            "type": "string",
            "description": "For kind song: the list's title, shown when the user opens it. Title Case, 2 to 4 words, no period, like \"Top Songs This Month\"."
        }
    });
    let mut summary_properties = json!({});
    for (key, value) in window.as_object().unwrap() {
        top_properties[key] = value.clone();
        summary_properties[key] = value.clone();
    }

    vec![
        json!({
            "type": "function",
            "name": "list_tags",
            "description": "The user's own tags with their ids and types. The prompt already lists them; call this only if the list there was cut short.",
            "parameters": { "type": "object", "properties": {} }
        }),
        json!({
            "type": "function",
            "name": "run_query",
            "description": "Finds songs matching a Cadenza query among every song Cadenza knows, the user's own first. Returns how many matched, how many of those are the user's own (in their library or tagged) and how many come from elsewhere, and the first 25 with title, artist, and a yours flag. The user sees the songs as a card under your answer, so do not list them in your text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "object",
                        "description": "A Cadenza query: { \"where\": <node> }. See the query format in the instructions."
                    },
                    "sort": {
                        "type": "object",
                        "description": "Optional order. {\"field\": \"metadata\", \"key\": <title, artist, album, genre, release_date, duration, explicit, or total_plays>, \"direction\": \"ascending\" or \"descending\"}, or {\"field\": \"tag\", \"tag_id\": <id>, \"direction\": ...} for one of the user's tags or an activity tag. Ascending is A to Z, low to high, oldest first. Leave out for the default order (the user's own songs first, most relevant first)."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Optional. When the user asks for a number of songs (\"10 songs\", \"my top 5\", \"a few\"), how many to hand back, 1 to 250, taken in order after sort. The card and Play then hold exactly these. Leave out to return every match."
                    },
                    "title": {
                        "type": "string",
                        "description": "The list's title, shown when the user opens it. Always pass one. Title Case, 2 to 4 words, no period. Name what the songs are, never their order or grouping (the user can re-sort the list), so \"Chill Songs\", not \"Chill Songs, Newest First\". Like \"Chill Songs\", \"Frank Ocean Before 2015\", or \"Never Played\"."
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["everything", "mine"],
                        "description": "everything (default): every song Cadenza knows, the user's own first. mine: only the user's library and tagged songs. Use mine only when the user asks for songs in their library, songs they have, or their own songs."
                    }
                },
                "required": ["query"]
            }
        }),
        json!({
            "type": "function",
            "name": "get_song_metadata",
            "description": "Title, artist, album, genres, release date, length, and explicit rating for up to 25 songs by id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "song_ids": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["song_ids"]
            }
        }),
        json!({
            "type": "function",
            "name": "top_items",
            "description": "The user's own most played songs, artists, albums, playlists, queries, or tags over a window, most played first, from their listening history. Use for rankings over a time window (\"top artists this month\"); for filtering or sorting songs by the user's play count with no window, run_query with the My Plays activity tag works too.",
            "parameters": {
                "type": "object",
                "properties": top_properties,
                "required": ["kind"]
            }
        }),
        json!({
            "type": "function",
            "name": "listening_summary",
            "description": "Totals for a window: plays, starts, completions, skips, early skips, unique songs, plays from queries, and listening time.",
            "parameters": { "type": "object", "properties": summary_properties }
        }),
        json!({
            "type": "function",
            "name": "list_saved_queries",
            "description": "The queries the user saved by name (under Queries in the Library tab), favorites first: id, name, the query JSON, its scope, and how many songs it holds. A saved query holds a stored list: the songs it matched when it was saved or last rerun, plus any added since by tagging. That list is what its screen shows; get_saved_query_songs reads it.",
            "parameters": { "type": "object", "properties": {} }
        }),
        json!({
            "type": "function",
            "name": "get_saved_query_songs",
            "description": "The songs one saved query holds, in order, exactly as its screen in the app lists them. Returns how many, how many are the user's own, and the first 25 with title and artist; the user sees them as a card under your answer, so do not list them in your text. Get the id from list_saved_queries.",
            "parameters": {
                "type": "object",
                "properties": {
                    "saved_query_id": { "type": "integer" }
                },
                "required": ["saved_query_id"]
            }
        }),
        json!({
            "type": "function",
            "name": "get_song_tags",
            "description": "The user's own tags on up to 25 songs by id, with the value of each attribute tag, plus the activity tags (My Plays, First Played, Last Played, In My Library, Favorited, Tagged) and their values. For Apple's song facts (title, artist, genre) use get_song_metadata instead.",
            "parameters": {
                "type": "object",
                "properties": {
                    "song_ids": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["song_ids"]
            }
        }),
        json!({
            "type": "function",
            "name": "list_playlists",
            "description": "The Cadenza shared playlists the user is a member of, most recently changed first: id, name, description, owner, the user's role (owner, editor, viewer), song and member counts. These are not the user's Apple Music playlists; for those, use apple_music_playlists. For a playlist's songs, call get_playlist_songs.",
            "parameters": { "type": "object", "properties": {} }
        }),
        json!({
            "type": "function",
            "name": "find_songs",
            "description": "Shows specific songs you name yourself, from what you know about music, as a card: for a request no tag or metadata query can express, like \"10 iconic video game songs\", \"songs like Redbone\", \"the best 90s one-hit wonders\", or \"songs from the Interstellar soundtrack\". Each is looked up on Apple Music; only exact matches are kept, and not_found lists the rest. Name real, well-known recordings with their main artist.",
            "parameters": {
                "type": "object",
                "properties": {
                    "songs": {
                        "type": "array",
                        "description": "Up to 25, in the order to show them.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string" },
                                "artist": { "type": "string", "description": "The main artist, as credited on Apple Music." }
                            },
                            "required": ["title", "artist"]
                        }
                    },
                    "title": {
                        "type": "string",
                        "description": "The list's title. Title Case, 2 to 4 words, no period, like \"Iconic Video Game Songs\"."
                    }
                },
                "required": ["songs", "title"]
            }
        }),
        json!({
            "type": "function",
            "name": "get_playlist_songs",
            "description": "The songs in one Cadenza shared playlist the user is a member of, in playlist order, with who added each, plus the playlist's members. Returns the first 25 with title and artist; the user sees them as a card under your answer, so do not list them in your text. Get the id from list_playlists.",
            "parameters": {
                "type": "object",
                "properties": {
                    "playlist_id": { "type": "integer" }
                },
                "required": ["playlist_id"]
            }
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_search_everything_unless_asked_for_mine() {
        assert_eq!(query_songs_for(None).ok(), Some(QuerySongs::Everything));
        assert_eq!(
            query_songs_for(Some("everything")).ok(),
            Some(QuerySongs::Everything)
        );
        assert_eq!(
            query_songs_for(Some("mine")).ok(),
            Some(QuerySongs::LibraryOrTagged)
        );
        assert!(matches!(
            query_songs_for(Some("library")),
            Err(ToolError::Arguments(_))
        ));
    }

    #[test]
    fn a_limit_stays_between_one_and_the_card_size() {
        assert_eq!(picked_count(None), None);
        assert_eq!(picked_count(Some(10)), Some(10));
        assert_eq!(picked_count(Some(0)), Some(1));
        assert_eq!(picked_count(Some(5_000)), Some(MAX_CARD_SONGS));
    }

    #[test]
    fn sorts_only_when_asked() {
        assert!(arrangement_for(None).unwrap().is_none());
        assert!(arrangement_for(Some(Value::Null)).unwrap().is_none());

        let newest = arrangement_for(Some(json!({
            "field": "metadata",
            "key": "release_date",
            "direction": "descending"
        })))
        .unwrap();
        assert!(newest.sort.is_some() && newest.group.is_none());

        let most_played = arrangement_for(Some(json!({
            "field": "tag",
            "tag_id": 41,
            "direction": "descending"
        })))
        .unwrap();
        assert!(most_played.sort.is_some());

        // a sort the query engine cannot read is the model's to fix
        assert!(matches!(
            arrangement_for(Some(json!({ "field": "metadata", "key": "mood" }))),
            Err(ToolError::Arguments(_))
        ));
    }

    #[test]
    fn counts_the_users_own_songs_apart_from_the_rest() {
        let song = |id: &str, certain| QueryMatch {
            song_id: id.into(),
            certain,
        };
        assert_eq!(
            count_yours(&[song("1", true), song("2", false), song("3", true)]),
            (2, 1)
        );
        assert_eq!(count_yours(&[]), (0, 0));
    }

    #[test]
    fn a_saved_querys_scope_matches_run_query() {
        assert_eq!(
            query_songs_for(Some(scope_of_saved(true))).ok(),
            Some(QuerySongs::LibraryOrTagged)
        );
        assert_eq!(
            query_songs_for(Some(scope_of_saved(false))).ok(),
            Some(QuerySongs::Everything)
        );
    }

    #[test]
    fn applied_tags_keep_their_values() {
        let tag = tags::Model {
            tag_id: 7,
            user_id: None,
            name: "rating".into(),
            color: "#808080".into(),
            r#type: crate::db::entity::sea_orm_active_enums::TagType::Number,
            is_activity: false,
        };
        let described = describe_applied(vec![(tag, Some("4".into()))]);
        assert_eq!(described[0]["name"], "rating");
        assert_eq!(described[0]["value"], "4");
    }

    #[test]
    fn card_titles_read_like_titles() {
        let title = |text: &str| card_title(Some(text.into()));
        assert_eq!(title("   "), None);
        assert_eq!(title("."), None);
        assert_eq!(card_title(None), None);
        assert_eq!(title("chill songs."), Some("Chill Songs".into()));
        assert_eq!(
            title("\"songs for the road\""),
            Some("Songs for the Road".into())
        );
        assert_eq!(
            title("the best of frank ocean"),
            Some("The Best of Frank Ocean".into())
        );
        // a word already written with capitals stays as written
        assert_eq!(
            title("late night R&B on iPhone"),
            Some("Late Night R&B on iPhone".into())
        );
        assert_eq!(title("'90s hip hop"), Some("'90s Hip Hop".into()));
    }

    #[test]
    fn card_titles_are_cut_at_a_word() {
        let cut = card_title(Some(
            "songs I have played the most since the summer began last year".into(),
        ))
        .unwrap();
        assert!(cut.chars().count() <= MAX_TITLE_CHARS, "{cut}");
        assert_eq!(cut, "Songs I Have Played the Most");
        let one_long_word = card_title(Some("a".repeat(MAX_TITLE_CHARS + 10))).unwrap();
        assert_eq!(one_long_word.chars().count(), MAX_TITLE_CHARS);
    }

    fn song(title: &str, artist: &str) -> SongMetadata {
        SongMetadata {
            id: format!("{title}|{artist}"),
            title: title.into(),
            artist_name: artist.into(),
            album_name: None,
            album_id: None,
            duration_ms: None,
            artwork_url: None,
            genre_names: vec![],
            release_date: None,
            isrc: None,
            content_rating: None,
        }
    }

    fn wanted(title: &str, artist: Option<&str>) -> WantedSong {
        WantedSong {
            title: title.into(),
            artist: artist.map(Into::into),
        }
    }

    #[test]
    fn titles_match_past_brackets_and_suffixes() {
        assert!(titles_match("Megalovania", "MEGALOVANIA"));
        assert!(titles_match(
            "Baba Yetu",
            "Baba Yetu (From \"Civilization IV\")"
        ));
        assert!(titles_match("Still Alive", "Still Alive - From Portal"));
        assert!(titles_match(
            "Don't Stop Me Now",
            "Don’t Stop Me Now - Remastered 2011"
        ));
        assert!(!titles_match("Halo", "Halogen"));
        assert!(!titles_match("Hello", "Goodbye"));
        assert!(!titles_match("", "Anything"));
    }

    #[test]
    fn artists_match_when_credited_among_others() {
        assert!(artists_match("Frank Ocean", "Frank Ocean & André 3000"));
        assert!(artists_match("koji kondo", "Koji Kondo"));
        assert!(!artists_match("Toby Fox", "The Megalovania Tribute Band"));
    }

    #[test]
    fn picks_the_first_real_match_or_none() {
        let candidates = vec![
            song("Megalovania (Metal Cover)", "Some Band"),
            song("Megalovania", "Toby Fox"),
        ];
        let picked = pick_match(&wanted("Megalovania", Some("Toby Fox")), candidates).unwrap();
        assert_eq!(picked.artist_name, "Toby Fox");

        // a cover by someone else is not the song
        let covers = vec![song("Megalovania", "Some Band")];
        assert_eq!(
            pick_match(&wanted("Megalovania", Some("Toby Fox")), covers),
            None
        );

        // with no artist named, the first title match
        let any = vec![song("Other", "A"), song("Megalovania", "B")];
        assert_eq!(
            pick_match(&wanted("Megalovania", None), any)
                .unwrap()
                .artist_name,
            "B"
        );
    }

    #[test]
    fn long_log_lines_are_cut() {
        assert_eq!(clip("short"), "short");
        let long = "a".repeat(MAX_LOGGED_CHARS + 50);
        assert_eq!(clip(&long).chars().count(), MAX_LOGGED_CHARS + 3);
    }

    #[test]
    fn every_definition_has_a_label() {
        for definition in definitions() {
            let name = definition["name"].as_str().unwrap();
            assert_ne!(label_for(name), "Tried a tool", "{name} has no label");
        }
    }

    #[test]
    fn window_tools_share_the_window_parameters() {
        let definitions = definitions();
        let summary = definitions
            .iter()
            .find(|tool| tool["name"] == "listening_summary")
            .unwrap();
        assert!(summary["parameters"]["properties"]["since"].is_object());
        let top = definitions
            .iter()
            .find(|tool| tool["name"] == "top_items")
            .unwrap();
        assert!(top["parameters"]["properties"]["until"].is_object());
        assert!(top["parameters"]["properties"]["kind"].is_object());
    }

    #[test]
    fn window_args_read_offsets() {
        let args: WindowArgs = serde_json::from_value(json!({
            "since": "2026-11-02T00:00:00-07:00",
            "until": "2026-11-09T00:00:00-07:00"
        }))
        .unwrap();
        assert_eq!(
            args.since.unwrap().to_rfc3339(),
            "2026-11-02T07:00:00+00:00"
        );
        assert!(args.window().is_ok());
    }

    #[test]
    fn backwards_window_is_the_models_to_fix() {
        let args: WindowArgs = serde_json::from_value(json!({
            "since": "2026-11-09T00:00:00Z",
            "until": "2026-11-02T00:00:00Z"
        }))
        .unwrap();
        assert!(matches!(args.window(), Err(ToolError::Arguments(_))));
    }
}
