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
    queries::{Arrangement, QueryMatch, QueryOptions, QuerySongs},
};
use crate::err::CadenzaError;
use crate::routes::json::{
    assistant::SongsCard,
    query::{Query, QuerySort},
    tag::TagType,
};
use crate::services::analytics::{Dimension, TimeWindow};

/// The most songs a tool describes to the model. The rest are only counted.
const MAX_SONGS_TO_MODEL: usize = 25;
/// The most song ids the song card under an answer gets.
pub const MAX_CARD_SONGS: usize = 100;
/// The most of a tool call's arguments and output written to the server log.
const MAX_LOGGED_CHARS: usize = 300;
/// The most songs `get_song_metadata` looks up in one call.
const MAX_METADATA_SONGS: usize = 25;
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

/// The tools, run against the database as one user.
pub struct DbTools<'a> {
    pub db: &'a DatabaseConnection,
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
        _ => "Tried a tool",
    }
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
        let described = self.describe_songs(&matches.songs).await?;
        let song_ids: Vec<String> = matches.songs.into_iter().map(|song| song.song_id).collect();
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
                "songs": described,
                "songs_shown": described.len(),
                // how many the song card under the answer lists
                "card_shows": total.min(MAX_CARD_SONGS),
            }),
            "",
        );
        if total > 0 {
            outcome.songs = Some(SongsCard {
                song_ids: song_ids.into_iter().take(MAX_CARD_SONGS).collect(),
                total,
                capped: matches.capped,
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
                    let row = rows.get(&entry.sample_song_id);
                    json!({
                        "song_id": entry.sample_song_id,
                        "title": row.map(|row| row.name.clone()),
                        "artist": row.and_then(|row| row.artist_name.clone()),
                        "plays": entry.plays,
                    })
                })
                .collect();
            let mut outcome = ToolOutcome::ok(json!({ "items": items }), "");
            if !song_ids.is_empty() {
                outcome.songs = Some(SongsCard {
                    total: song_ids.len(),
                    song_ids,
                    capped: false,
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
                let row = rows.get(&song.song_id);
                json!({
                    "song_id": song.song_id,
                    "title": row.map(|row| row.name.clone()),
                    "artist": row.and_then(|row| row.artist_name.clone()),
                    "yours": song.certain,
                })
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
        "limit": { "type": "integer", "description": "How many, 1 to 25. Defaults to 10." }
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
            "description": "Finds songs matching a Cadenza query among every song Cadenza knows, the user's own first. Returns how many matched, how many of those are the user's own (in their library or tagged) and how many come from elsewhere, and the first 25 with title, artist, and a yours flag. The user sees the songs as a card under your answer, so do not list more than a few.",
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
