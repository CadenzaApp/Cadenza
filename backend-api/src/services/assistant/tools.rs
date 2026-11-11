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
    entity::tags,
    queries::{Arrangement, QueryOptions, QuerySongs},
};
use crate::err::CadenzaError;
use crate::routes::json::{assistant::SongsCard, query::Query, tag::TagType};
use crate::services::analytics::{Dimension, TimeWindow};

/// The most songs a tool describes to the model. The rest are only counted.
const MAX_SONGS_TO_MODEL: usize = 25;
/// The most song ids the song card under an answer gets.
pub const MAX_CARD_SONGS: usize = 200;
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
        match result {
            Ok(mut outcome) => {
                outcome.label = label.to_owned();
                outcome
            }
            Err(ToolError::Arguments(message)) => ToolOutcome::error(message, label),
            Err(ToolError::Cadenza(err)) => ToolOutcome::error(err.to_string(), label),
        }
    }
}

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

#[derive(Deserialize)]
struct RunQueryArgs {
    query: Value,
    /// `mine` (the default) or `everything`.
    #[serde(default)]
    scope: Option<String>,
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
        let songs = match args.scope.as_deref() {
            None | Some("mine") => QuerySongs::LibraryOrTagged,
            Some("everything") => QuerySongs::Everything,
            Some(other) => {
                return Err(ToolError::Arguments(format!(
                    "scope must be mine or everything, not {other}"
                )));
            }
        };
        let options = QueryOptions {
            consider_default_tags: false,
            songs,
            hide_explicit: self.hide_explicit,
        };
        let matches = db::queries::run_query(
            self.db,
            &query,
            self.user_id,
            options,
            &Arrangement::default(),
        )
        .await
        .map_err(|err| match err {
            // a query the compiler rejects is the model's to fix
            CadenzaError::QueryFormatError(message) => ToolError::Arguments(message),
            other => ToolError::Cadenza(other),
        })?;

        let song_ids: Vec<String> = matches.songs.into_iter().map(|song| song.song_id).collect();
        let total = song_ids.len();
        let described = self.describe_songs(&song_ids).await?;
        let mut outcome = ToolOutcome::ok(
            json!({
                "total": total,
                "capped": matches.capped,
                "songs": described,
                "songs_shown": described.len(),
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

    /// Title and artist for the first songs in `song_ids`, in order, from the
    /// stored metadata. A song with none stored still appears, by id.
    async fn describe_songs(&self, song_ids: &[String]) -> Result<Vec<Value>, CadenzaError> {
        let shown: Vec<String> = song_ids.iter().take(MAX_SONGS_TO_MODEL).cloned().collect();
        let rows = db::metadata_tags::get_song_rows(self.db, &shown).await?;
        Ok(shown
            .iter()
            .map(|song_id| {
                let row = rows.get(song_id);
                json!({
                    "song_id": song_id,
                    "title": row.map(|row| row.name.clone()),
                    "artist": row.and_then(|row| row.artist_name.clone()),
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
            "description": "Finds songs matching a Cadenza query, with how many matched and the first 25 with title and artist. The user sees the songs as a card under your answer, so do not list more than a few.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "object",
                        "description": "A Cadenza query: { \"where\": <node> }. See the query format in the instructions."
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["mine", "everything"],
                        "description": "mine (default): the user's library and tagged songs. everything: also songs from other users Cadenza knows."
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
            "description": "The user's most played songs, artists, albums, playlists, queries, or tags over a window, most played first.",
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
