//! The changes the assistant can make, each only after the user confirms it.
//!
//! A write tool never runs when the model calls it. The loop asks [`Writer::preview`] for a
//! confirm card and stops with a `pending_action`; the phone shows the card, and on the
//! user's yes sends the conversation back, and only then does [`Writer::execute`] make the
//! change. Both work out the change the same way ([`Writer::plan`]), from the model's
//! arguments, so what runs is what the card described. Every change is written to the
//! activity log (`db::assistant_actions`) with exactly what it did, and
//! [`undo`] reverses that.
//!
//! What is deliberately missing: deleting tags, saved queries, or playlists, settings and
//! privacy, the profile, anything social, members and invites, live sessions, activity and
//! suggested tags. The prompt tells the model to say so when asked.

use std::collections::HashSet;

use sea_orm::{ConnectionTrait, DatabaseConnection, TransactionTrait, prelude::Uuid};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::db::{
    self,
    assistant_actions::{self as actions, ActionRow, NewAction},
    entity::{saved_queries, sea_orm_active_enums::TagType as DbTagType, tags},
    queries::{Arrangement, QueryOptions, QuerySongs},
    saved_queries::{NewSavedQuery, SavedQueryPatch},
};
use crate::err::CadenzaError;
use crate::routes::json::{
    assistant::{BuilderSettings, CardQuery, WritePreview},
    query::Query,
    tag::TagType,
};
use crate::services::realtime::SharedEventBus;
use crate::services::saved_queries::{spawn_add_retagged_songs, store_saved_songs};
use crate::services::tag_values::canonicalize_tag_value;

pub const APPLY_TAG: &str = "apply_tag";
pub const REMOVE_TAG: &str = "remove_tag";
pub const CREATE_TAG: &str = "create_tag";
pub const UPDATE_TAG: &str = "update_tag";
pub const SAVE_QUERY: &str = "save_query";
pub const RENAME_SAVED_QUERY: &str = "rename_saved_query";
pub const UNDO_ACTION: &str = "undo_action";

/// Every tool that changes something, and so waits for the user.
const WRITE_TOOLS: &[&str] = &[
    APPLY_TAG,
    REMOVE_TAG,
    CREATE_TAG,
    UPDATE_TAG,
    SAVE_QUERY,
    RENAME_SAVED_QUERY,
    UNDO_ACTION,
];

/// The most songs one change can touch, the same as the app's own batch tag edit.
pub const MAX_WRITE_SONGS: usize = 4_000;
/// The longest saved query name, the same as `POST /saved-queries`.
const MAX_QUERY_NAME_CHARS: usize = 100;
/// The longest tag name the assistant gives.
const MAX_TAG_NAME_CHARS: usize = 60;
/// How many song titles a confirm card names.
const SAMPLE_SONGS: usize = 3;

/// The app's tag colors (`client-app/src/lib/tag-color-palette.ts`). A new tag with no
/// color asked for gets one picked from its name.
const TAG_COLORS: &[&str] = &[
    "#b01843", "#f22933", "#ee5300", "#dc8f00", "#6f9808", "#00a446", "#00907f", "#0092b4",
    "#2061f1", "#6d35d5", "#ae6ff1", "#dd34e5", "#f83ca0", "#8c5939", "#6b7281",
];

pub fn is_write_tool(name: &str) -> bool {
    WRITE_TOOLS.contains(&name)
}

/// The status row a change shows once it is done.
pub fn label_for(name: &str) -> &'static str {
    match name {
        APPLY_TAG => "Applied a tag",
        REMOVE_TAG => "Removed a tag",
        CREATE_TAG => "Made a tag",
        UPDATE_TAG => "Changed a tag",
        SAVE_QUERY => "Saved a query",
        RENAME_SAVED_QUERY => "Renamed a saved query",
        UNDO_ACTION => "Undid a change",
        _ => "Made a change",
    }
}

/// The card a change can use: its songs, and a `run_query` card's query.
#[derive(Clone, Copy, Default)]
pub struct CardRef<'a> {
    pub song_ids: &'a [String],
    pub query: Option<&'a CardQuery>,
}

/// What makes the changes: the database, the user, and how their queries run.
pub struct Writer<'a> {
    pub db: &'a DatabaseConnection,
    pub user_id: Uuid,
    pub hide_explicit: bool,
    pub builder_settings: BuilderSettings,
    /// For telling a shared playlist's other members about a change.
    pub bus: Option<&'a SharedEventBus>,
}

/// A new tag a change makes.
#[derive(Clone, Debug)]
struct NewTag {
    name: String,
    color: String,
    tag_type: TagType,
}

#[derive(Debug)]
enum TagChoice {
    Existing(tags::Model),
    New(NewTag),
}

impl TagChoice {
    fn tag_type(&self) -> TagType {
        match self {
            TagChoice::Existing(tag) => TagType::from(tag.r#type),
            TagChoice::New(new) => new.tag_type,
        }
    }
}

/// A change, worked out from the model's arguments, before it runs.
#[derive(Debug)]
enum Plan {
    ApplyTag {
        tag: TagChoice,
        songs: Vec<String>,
        value: Option<String>,
        /// The query had more songs than it could count, so `songs` is a lower bound.
        capped: bool,
    },
    RemoveTag {
        tag: tags::Model,
        songs: Vec<String>,
    },
    CreateTag(NewTag),
    UpdateTag {
        tag: tags::Model,
        name: Option<String>,
        color: Option<String>,
    },
    SaveQuery {
        name: String,
        query: Value,
        library_or_tagged: bool,
        include_suggested: bool,
    },
    RenameSavedQuery {
        saved: saved_queries::Model,
        name: String,
    },
    Undo(ActionRow),
}

/// The songs a change names: `"card"`, a list of ids, or a query it runs.
#[derive(Deserialize, Default)]
struct SongArgs {
    #[serde(default)]
    songs: Option<Value>,
    #[serde(default)]
    query: Option<Value>,
    #[serde(default)]
    scope: Option<String>,
}

#[derive(Deserialize)]
struct NewTagArgs {
    name: String,
    #[serde(default)]
    color: Option<String>,
    #[serde(default, rename = "type")]
    tag_type: Option<TagType>,
}

#[derive(Deserialize)]
struct ApplyTagArgs {
    #[serde(default)]
    tag_id: Option<i64>,
    #[serde(default)]
    new_tag: Option<NewTagArgs>,
    #[serde(default)]
    value: Option<String>,
    #[serde(flatten)]
    songs: SongArgs,
}

#[derive(Deserialize)]
struct RemoveTagArgs {
    tag_id: i64,
    #[serde(flatten)]
    songs: SongArgs,
}

#[derive(Deserialize)]
struct UpdateTagArgs {
    tag_id: i64,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    color: Option<String>,
}

#[derive(Deserialize)]
struct SaveQueryArgs {
    name: String,
    #[serde(default)]
    query: Option<Value>,
    #[serde(default)]
    scope: Option<String>,
}

#[derive(Deserialize)]
struct RenameSavedQueryArgs {
    saved_query_id: i64,
    name: String,
}

#[derive(Deserialize, Default)]
struct UndoArgs {
    #[serde(default)]
    action_id: Option<i64>,
}

fn parse<T: for<'de> Deserialize<'de>>(arguments: &str) -> Result<T, String> {
    let arguments = if arguments.trim().is_empty() {
        "{}"
    } else {
        arguments
    };
    serde_json::from_str(arguments).map_err(|err| format!("the arguments are not valid: {err}"))
}

/// `n` songs, with the number grouped: "1 song", "1,243 songs".
pub fn songs_count(n: usize) -> String {
    format!("{} {}", grouped(n), if n == 1 { "song" } else { "songs" })
}

/// `n` with thousands separated by commas.
pub fn grouped(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn type_word(tag_type: TagType) -> &'static str {
    match tag_type {
        TagType::Basic => "basic",
        TagType::Text => "text",
        TagType::Datetime => "date and time",
        TagType::Number => "number",
        TagType::Duration => "duration",
        TagType::Checkbox => "checkbox",
        TagType::Date => "date",
    }
}

/// A color for a new tag: the one asked for when it is one of the app's, otherwise one
/// picked from the name, so the same name always gets the same color.
fn color_for(name: &str, asked: Option<&str>) -> String {
    if let Some(asked) = asked
        && let Some(color) = TAG_COLORS
            .iter()
            .find(|color| color.eq_ignore_ascii_case(asked.trim()))
    {
        return (*color).to_owned();
    }
    let hash = name.to_lowercase().bytes().fold(0usize, |acc, b| {
        acc.wrapping_mul(31).wrapping_add(b as usize)
    });
    TAG_COLORS[hash % TAG_COLORS.len()].to_owned()
}

fn checked_tag_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("a tag needs a name".into());
    }
    if name.chars().count() > MAX_TAG_NAME_CHARS {
        return Err(format!(
            "a tag name is at most {MAX_TAG_NAME_CHARS} characters"
        ));
    }
    Ok(name.to_owned())
}

fn checked_query_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("a saved query needs a name".into());
    }
    if name.chars().count() > MAX_QUERY_NAME_CHARS {
        return Err(format!(
            "a saved query name is at most {MAX_QUERY_NAME_CHARS} characters"
        ));
    }
    Ok(name.to_owned())
}

fn db_error(err: CadenzaError) -> String {
    match err {
        CadenzaError::TagNameAlreadyTaken => {
            "the user already has a tag with that name; use it instead of making a new one".into()
        }
        CadenzaError::QueryNameAlreadyTaken => {
            "the user already has a saved query with that name; pick another name".into()
        }
        CadenzaError::NotFound => "that does not exist or is not the user's".into(),
        CadenzaError::InvalidTagValue(message) | CadenzaError::QueryFormatError(message) => message,
        other => format!("the change could not be made: {other}"),
    }
}

impl Writer<'_> {
    /// One of the user's own tags. Activity and suggested tags are not theirs to change.
    async fn own_tag(&self, tag_id: i64) -> Result<tags::Model, String> {
        db::tags::get_user_tag(self.db, self.user_id, tag_id)
            .await
            .map_err(db_error)?
            .ok_or_else(|| {
                "that tag id is not one of the user's own tags; activity tags (My Plays, Favorited, ...) and suggested tags cannot be changed, and other ids come from list_tags".to_owned()
            })
    }

    /// The songs a change names, each once, at most [`MAX_WRITE_SONGS`], and whether a
    /// query had more than it could count.
    async fn songs(
        &self,
        args: &SongArgs,
        card: CardRef<'_>,
    ) -> Result<(Vec<String>, bool), String> {
        let (ids, capped) = if let Some(query) = args.query.as_ref().filter(|q| !q.is_null()) {
            let query: Query = serde_json::from_value(query.clone())
                .map_err(|err| format!("the query is not valid: {err}"))?;
            let songs = match args.scope.as_deref() {
                Some("mine") => QuerySongs::LibraryOrTagged,
                Some("everything") => QuerySongs::Everything,
                None if self.builder_settings.library_or_tagged => QuerySongs::LibraryOrTagged,
                None => QuerySongs::Everything,
                Some(other) => {
                    return Err(format!("scope must be everything or mine, not {other}"));
                }
            };
            let options = QueryOptions {
                consider_default_tags: self.builder_settings.include_suggested,
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
            .map_err(db_error)?;
            (
                matches.songs.into_iter().map(|song| song.song_id).collect(),
                matches.capped,
            )
        } else {
            let ids: Vec<String> = match &args.songs {
                Some(Value::String(which)) if which == "card" => card.song_ids.to_vec(),
                Some(Value::Array(ids)) => ids
                    .iter()
                    .filter_map(super::phone_tools::id_value)
                    .collect(),
                _ => {
                    return Err("say which songs: songs \"card\" for the card, a list of song ids from a tool, or a query (with scope) for every song it matches".into());
                }
            };
            (ids, false)
        };
        let mut seen = HashSet::new();
        let ids: Vec<String> = ids
            .into_iter()
            .filter(|id| seen.insert(id.clone()))
            .collect();
        if ids.is_empty() {
            return Err("there are no songs to change".into());
        }
        if ids.len() > MAX_WRITE_SONGS {
            return Err(format!(
                "that is {}, and one change can touch at most {}; narrow it down, or split it",
                songs_count(ids.len()),
                songs_count(MAX_WRITE_SONGS)
            ));
        }
        Ok((ids, capped))
    }

    /// Works out a change from the model's arguments, checking everything it can before
    /// anything runs. An error is the model's to fix or to tell the user about.
    async fn plan(&self, name: &str, arguments: &str, card: CardRef<'_>) -> Result<Plan, String> {
        match name {
            APPLY_TAG => {
                let args: ApplyTagArgs = parse(arguments)?;
                let tag = match (args.tag_id, args.new_tag) {
                    (Some(tag_id), _) => TagChoice::Existing(self.own_tag(tag_id).await?),
                    (None, Some(new)) => {
                        let name = checked_tag_name(&new.name)?;
                        TagChoice::New(NewTag {
                            color: color_for(&name, new.color.as_deref()),
                            tag_type: new.tag_type.unwrap_or_default(),
                            name,
                        })
                    }
                    (None, None) => {
                        return Err(
                            "pass tag_id for one of the user's tags, or new_tag to make one".into(),
                        );
                    }
                };
                let value = canonicalize_tag_value(&DbTagType::from(tag.tag_type()), args.value)
                    .map_err(db_error)?;
                if value.is_some() && tag.tag_type() == TagType::Basic {
                    return Err("a basic tag holds no value; leave value out".into());
                }
                let (songs, capped) = self.songs(&args.songs, card).await?;
                Ok(Plan::ApplyTag {
                    tag,
                    songs,
                    value,
                    capped,
                })
            }
            REMOVE_TAG => {
                let args: RemoveTagArgs = parse(arguments)?;
                let tag = self.own_tag(args.tag_id).await?;
                let (songs, _) = self.songs(&args.songs, card).await?;
                // only the songs that have it are a change
                let songs = actions::songs_with_tag(self.db, self.user_id, tag.tag_id, &songs)
                    .await
                    .map_err(db_error)?;
                if songs.is_empty() {
                    return Err(format!(
                        "none of those songs have {}, so there is nothing to remove",
                        tag.name
                    ));
                }
                Ok(Plan::RemoveTag { tag, songs })
            }
            CREATE_TAG => {
                let args: NewTagArgs = parse(arguments)?;
                let name = checked_tag_name(&args.name)?;
                Ok(Plan::CreateTag(NewTag {
                    color: color_for(&name, args.color.as_deref()),
                    tag_type: args.tag_type.unwrap_or_default(),
                    name,
                }))
            }
            UPDATE_TAG => {
                let args: UpdateTagArgs = parse(arguments)?;
                let tag = self.own_tag(args.tag_id).await?;
                let name = args
                    .name
                    .as_deref()
                    .map(checked_tag_name)
                    .transpose()?
                    .filter(|name| *name != tag.name);
                let color = args
                    .color
                    .as_deref()
                    .map(|asked| color_for(&tag.name, Some(asked)))
                    .filter(|color| *color != tag.color);
                if name.is_none() && color.is_none() {
                    return Err("that changes nothing; pass a new name or a new color".into());
                }
                Ok(Plan::UpdateTag { tag, name, color })
            }
            SAVE_QUERY => {
                let args: SaveQueryArgs = parse(arguments)?;
                let name = checked_query_name(&args.name)?;
                let (query, library_or_tagged, include_suggested) = match (
                    args.query.filter(|q| !q.is_null()),
                    card.query,
                ) {
                    (Some(query), _) => (
                        query,
                        match args.scope.as_deref() {
                            Some("mine") => true,
                            Some("everything") => false,
                            _ => self.builder_settings.library_or_tagged,
                        },
                        self.builder_settings.include_suggested,
                    ),
                    (None, Some(card)) => (
                        card.query.clone(),
                        card.library_or_tagged,
                        card.include_suggested,
                    ),
                    (None, None) => {
                        return Err("there is no query to save: pass query, or save the card of a run_query answer".into());
                    }
                };
                serde_json::from_value::<Query>(query.clone())
                    .map_err(|err| format!("the query is not valid: {err}"))?;
                Ok(Plan::SaveQuery {
                    name,
                    query,
                    library_or_tagged,
                    include_suggested,
                })
            }
            RENAME_SAVED_QUERY => {
                let args: RenameSavedQueryArgs = parse(arguments)?;
                let saved = db::saved_queries::get_saved_query(self.db, self.user_id, args.saved_query_id)
                    .await
                    .map_err(|_| "that saved query id is not one of the user's; look it up with list_saved_queries".to_owned())?;
                let name = checked_query_name(&args.name)?;
                if name == saved.name {
                    return Err("that is already its name".into());
                }
                Ok(Plan::RenameSavedQuery { saved, name })
            }
            UNDO_ACTION => {
                let args: UndoArgs = parse(arguments)?;
                let action_id = match args.action_id {
                    Some(id) => id,
                    None => actions::latest_undoable(self.db, self.user_id)
                        .await
                        .map_err(db_error)?
                        .ok_or("there is no change the assistant made that can still be undone")?,
                };
                let row = actions::list(self.db, self.user_id)
                    .await
                    .map_err(db_error)?
                    .into_iter()
                    .find(|row| row.action_id == action_id)
                    .ok_or("that action id is not in the user's activity log; look it up with list_recent_actions")?;
                if row.undone_at.is_some() {
                    return Err(format!("\"{}\" is already undone", row.summary));
                }
                if !row.undoable {
                    return Err(format!(
                        "\"{}\" cannot be undone in Cadenza; tell the user they can change it in Apple Music",
                        row.summary
                    ));
                }
                Ok(Plan::Undo(row))
            }
            other => Err(format!("{other} is not a change the assistant can make")),
        }
    }

    /// "Purple Rain, Redbone, Nights, and 1,240 more", from what Cadenza stores.
    async fn sample(&self, songs: &[String]) -> String {
        let shown: Vec<String> = songs.iter().take(SAMPLE_SONGS * 2).cloned().collect();
        let rows = db::metadata_tags::get_song_rows(self.db, &shown)
            .await
            .unwrap_or_default();
        let titles: Vec<String> = shown
            .iter()
            .filter_map(|id| rows.get(id).map(|row| row.name.clone()))
            .take(SAMPLE_SONGS)
            .collect();
        if titles.is_empty() {
            return songs_count(songs.len());
        }
        let rest = songs.len() - titles.len();
        match rest {
            0 => titles.join(", "),
            _ => format!("{}, and {} more", titles.join(", "), grouped(rest)),
        }
    }

    /// The confirm card for a change, or why it cannot be made.
    pub async fn preview(
        &self,
        name: &str,
        arguments: &str,
        card: CardRef<'_>,
    ) -> Result<WritePreview, String> {
        let plan = self.plan(name, arguments, card).await?;
        Ok(match plan {
            Plan::ApplyTag {
                tag,
                songs,
                value,
                capped,
            } => {
                let at_least = if capped { "at least " } else { "" };
                let with_value = value
                    .as_deref()
                    .map(|value| format!(" with the value {value}"))
                    .unwrap_or_default();
                let mut detail = self.sample(&songs).await;
                match &tag {
                    TagChoice::Existing(existing) => {
                        let already =
                            actions::songs_with_tag(self.db, self.user_id, existing.tag_id, &songs)
                                .await
                                .map_err(db_error)?
                                .len();
                        if already == songs.len() && value.is_none() {
                            return Err(format!(
                                "every one of those songs already has {}; nothing would change",
                                existing.name
                            ));
                        }
                        if already > 0 {
                            detail.push_str(&format!(
                                ". {} already {} it",
                                grouped(already),
                                if already == 1 { "has" } else { "have" }
                            ));
                        }
                        WritePreview {
                            title: format!(
                                "Apply {} to {at_least}{}{with_value}?",
                                existing.name,
                                songs_count(songs.len())
                            ),
                            detail: format!("{detail}. You can undo this."),
                            confirm_label: "Apply".into(),
                        }
                    }
                    TagChoice::New(new) => WritePreview {
                        title: format!(
                            "Make {} and apply it to {at_least}{}{with_value}?",
                            new.name,
                            songs_count(songs.len())
                        ),
                        detail: format!(
                            "{detail}. A new {} tag. You can undo this.",
                            type_word(new.tag_type)
                        ),
                        confirm_label: "Make and Apply".into(),
                    },
                }
            }
            Plan::RemoveTag { tag, songs } => WritePreview {
                title: format!("Remove {} from {}?", tag.name, songs_count(songs.len())),
                detail: format!("{}. You can undo this.", self.sample(&songs).await),
                confirm_label: "Remove".into(),
            },
            Plan::CreateTag(new) => WritePreview {
                title: format!("Make the tag {}?", new.name),
                detail: format!("A new {} tag, on no songs yet.", type_word(new.tag_type)),
                confirm_label: "Make Tag".into(),
            },
            Plan::UpdateTag { tag, name, color } => WritePreview {
                title: match &name {
                    Some(name) => format!("Rename {} to {name}?", tag.name),
                    None => format!("Change the color of {}?", tag.name),
                },
                detail: match (&name, &color) {
                    (Some(_), Some(_)) => "Its color changes too. You can undo this.".into(),
                    _ => "You can undo this.".into(),
                },
                confirm_label: "Save".into(),
            },
            Plan::SaveQuery { name, .. } => WritePreview {
                title: format!("Save this query as {name}?"),
                detail: "It keeps the songs it matches now, under Queries in Library. You can undo this.".into(),
                confirm_label: "Save".into(),
            },
            Plan::RenameSavedQuery { saved, name } => WritePreview {
                title: format!("Rename {} to {name}?", saved.name),
                detail: "You can undo this.".into(),
                confirm_label: "Rename".into(),
            },
            Plan::Undo(row) => WritePreview {
                title: format!("Undo \"{}\"?", row.summary),
                detail: undo_description(&row),
                confirm_label: "Undo".into(),
            },
        })
    }

    /// Makes a change the user confirmed. Returns what the model reads and the log row,
    /// or None for the row when nothing changed after all (every song had the tag by now).
    pub async fn execute(
        &self,
        name: &str,
        arguments: &str,
        card: CardRef<'_>,
    ) -> Result<(Value, Option<ActionRow>), String> {
        let plan = self.plan(name, arguments, card).await?;
        let row = match plan {
            Plan::ApplyTag {
                tag, songs, value, ..
            } => self.apply_tag(tag, songs, value).await?,
            Plan::RemoveTag { tag, songs } => self.remove_tag(tag, songs).await?,
            Plan::CreateTag(new) => Some(self.create_tag(new).await?),
            Plan::UpdateTag { tag, name, color } => Some(self.update_tag(tag, name, color).await?),
            Plan::SaveQuery {
                name,
                query,
                library_or_tagged,
                include_suggested,
            } => Some(
                self.save_query(name, query, library_or_tagged, include_suggested)
                    .await?,
            ),
            Plan::RenameSavedQuery { saved, name } => {
                Some(self.rename_saved_query(saved, name).await?)
            }
            Plan::Undo(row) => {
                let (row, message) = undo(self.db, self.bus, self.user_id, row.action_id)
                    .await
                    .map_err(|err| match err {
                        CadenzaError::CannotUndo(message) => message,
                        other => db_error(other),
                    })?;
                return Ok((json!({ "undone": row.summary, "result": message }), None));
            }
        };
        let output = match &row {
            Some(row) => json!({
                "done": row.summary,
                "action_id": row.action_id,
                "undo": "the user can undo it from the card under your answer, or by asking",
            }),
            None => json!({ "done": "nothing changed: every song already had it that way" }),
        };
        Ok((output, row))
    }

    async fn apply_tag(
        &self,
        tag: TagChoice,
        songs: Vec<String>,
        value: Option<String>,
    ) -> Result<Option<ActionRow>, String> {
        let (tag, created) = match tag {
            TagChoice::Existing(tag) => (tag, false),
            TagChoice::New(new) => (self.insert_tag(&new).await?, true),
        };
        let txn = self.db.begin().await.map_err(|err| db_error(err.into()))?;
        let applied = actions::apply_tag(&txn, self.user_id, &tag, &songs, value.clone())
            .await
            .map_err(db_error)?;
        if applied.added.is_empty() && applied.overwritten.is_empty() && !created {
            return Ok(None);
        }
        let changed = applied.added.len() + applied.overwritten.len();
        let summary = if created {
            format!(
                "Made {} and applied it to {}",
                tag.name,
                songs_count(applied.added.len())
            )
        } else {
            format!("Applied {} to {}", tag.name, songs_count(changed))
        };
        let row = actions::record(
            &txn,
            self.user_id,
            NewAction {
                kind: APPLY_TAG,
                summary,
                target_kind: Some("tag"),
                target_id: Some(tag.tag_id.to_string()),
                target_name: Some(tag.name.clone()),
                changes: json!({
                    "tag_id": tag.tag_id,
                    "created_tag": created,
                    "added": applied.added,
                    "value": value,
                    "overwritten": applied.overwritten
                        .iter()
                        .map(|(song_id, old)| json!({ "song_id": song_id, "value": old }))
                        .collect::<Vec<_>>(),
                }),
                undoable: true,
            },
        )
        .await
        .map_err(db_error)?;
        txn.commit().await.map_err(|err| db_error(err.into()))?;
        applied
            .recorded
            .into_iter()
            .for_each(|recorded| recorded.log());
        let retagged: Vec<String> = applied
            .added
            .iter()
            .cloned()
            .chain(
                applied
                    .overwritten
                    .iter()
                    .map(|(song_id, _)| song_id.clone()),
            )
            .collect();
        spawn_add_retagged_songs(self.db.clone(), self.user_id, retagged, vec![tag.tag_id]);
        Ok(Some(row))
    }

    async fn remove_tag(
        &self,
        tag: tags::Model,
        songs: Vec<String>,
    ) -> Result<Option<ActionRow>, String> {
        let txn = self.db.begin().await.map_err(|err| db_error(err.into()))?;
        let removed = actions::remove_tag(&txn, self.user_id, &tag, &songs)
            .await
            .map_err(db_error)?;
        if removed.removed.is_empty() {
            return Ok(None);
        }
        let row = actions::record(
            &txn,
            self.user_id,
            NewAction {
                kind: REMOVE_TAG,
                summary: format!(
                    "Removed {} from {}",
                    tag.name,
                    songs_count(removed.removed.len())
                ),
                target_kind: Some("tag"),
                target_id: Some(tag.tag_id.to_string()),
                target_name: Some(tag.name.clone()),
                changes: json!({
                    "tag_id": tag.tag_id,
                    "removed": removed.removed
                        .iter()
                        .map(|(song_id, value)| json!({ "song_id": song_id, "value": value }))
                        .collect::<Vec<_>>(),
                }),
                undoable: true,
            },
        )
        .await
        .map_err(db_error)?;
        txn.commit().await.map_err(|err| db_error(err.into()))?;
        removed
            .recorded
            .into_iter()
            .for_each(|recorded| recorded.log());
        let songs: Vec<String> = removed
            .removed
            .into_iter()
            .map(|(song_id, _)| song_id)
            .collect();
        spawn_add_retagged_songs(self.db.clone(), self.user_id, songs, vec![tag.tag_id]);
        Ok(Some(row))
    }

    async fn insert_tag(&self, new: &NewTag) -> Result<tags::Model, String> {
        let tag_id = db::tags::new_user_tag(
            self.db.clone(),
            self.user_id,
            new.name.clone(),
            new.color.clone(),
            new.tag_type.into(),
        )
        .await
        .map_err(db_error)?;
        self.own_tag(tag_id).await
    }

    async fn create_tag(&self, new: NewTag) -> Result<ActionRow, String> {
        let tag = self.insert_tag(&new).await?;
        actions::record(
            self.db,
            self.user_id,
            NewAction {
                kind: CREATE_TAG,
                summary: format!("Made the tag {}", tag.name),
                target_kind: Some("tag"),
                target_id: Some(tag.tag_id.to_string()),
                target_name: Some(tag.name.clone()),
                changes: json!({ "tag_id": tag.tag_id, "name": tag.name }),
                undoable: true,
            },
        )
        .await
        .map_err(db_error)
    }

    async fn update_tag(
        &self,
        tag: tags::Model,
        name: Option<String>,
        color: Option<String>,
    ) -> Result<ActionRow, String> {
        let updated = db::tags::update_user_tag(
            self.db.clone(),
            self.user_id,
            tag.tag_id,
            name.clone(),
            color.clone(),
        )
        .await
        .map_err(db_error)?;
        let summary = match &name {
            Some(name) => format!("Renamed {} to {name}", tag.name),
            None => format!("Changed the color of {}", tag.name),
        };
        actions::record(
            self.db,
            self.user_id,
            NewAction {
                kind: UPDATE_TAG,
                summary,
                target_kind: Some("tag"),
                target_id: Some(tag.tag_id.to_string()),
                target_name: Some(updated.name.clone()),
                changes: json!({
                    "tag_id": tag.tag_id,
                    "old_name": tag.name,
                    "new_name": updated.name,
                    "old_color": tag.color,
                    "new_color": updated.color,
                }),
                undoable: true,
            },
        )
        .await
        .map_err(db_error)
    }

    async fn save_query(
        &self,
        name: String,
        query: Value,
        library_or_tagged: bool,
        include_suggested: bool,
    ) -> Result<ActionRow, String> {
        let saved = db::saved_queries::create_saved_query(
            self.db,
            self.user_id,
            NewSavedQuery {
                name,
                query,
                consider_default_tags: include_suggested,
                library_or_tagged,
                favorite: false,
                artwork_urls: None,
            },
        )
        .await
        .map_err(db_error)?;
        let songs = store_saved_songs(self.db, self.user_id, &saved)
            .await
            .map_err(db_error)?;
        actions::record(
            self.db,
            self.user_id,
            NewAction {
                kind: SAVE_QUERY,
                summary: format!(
                    "Saved the query {} with {}",
                    saved.name,
                    songs_count(songs.len())
                ),
                target_kind: Some("saved_query"),
                target_id: Some(saved.saved_query_id.to_string()),
                target_name: Some(saved.name.clone()),
                changes: json!({ "saved_query_id": saved.saved_query_id, "name": saved.name }),
                undoable: true,
            },
        )
        .await
        .map_err(db_error)
    }

    async fn rename_saved_query(
        &self,
        saved: saved_queries::Model,
        name: String,
    ) -> Result<ActionRow, String> {
        let renamed = db::saved_queries::update_saved_query(
            self.db,
            self.user_id,
            saved.saved_query_id,
            SavedQueryPatch {
                name: Some(name),
                ..SavedQueryPatch::default()
            },
        )
        .await
        .map_err(db_error)?;
        actions::record(
            self.db,
            self.user_id,
            NewAction {
                kind: RENAME_SAVED_QUERY,
                summary: format!("Renamed the query {} to {}", saved.name, renamed.name),
                target_kind: Some("saved_query"),
                target_id: Some(saved.saved_query_id.to_string()),
                target_name: Some(renamed.name.clone()),
                changes: json!({
                    "saved_query_id": saved.saved_query_id,
                    "old_name": saved.name,
                    "new_name": renamed.name,
                }),
                undoable: true,
            },
        )
        .await
        .map_err(db_error)
    }
}

/// What undoing a row will do, for its confirm card.
fn undo_description(row: &ActionRow) -> String {
    let changes = &row.changes;
    let count = |key: &str| changes[key].as_array().map_or(0, Vec::len);
    let tag = row.target_name.clone().unwrap_or_else(|| "the tag".into());
    match row.kind.as_str() {
        APPLY_TAG => {
            let mut text = format!(
                "Takes {tag} off the {} it added",
                songs_count(count("added"))
            );
            if count("overwritten") > 0 {
                text.push_str(" and puts back the values it changed");
            }
            if changes["created_tag"].as_bool() == Some(true) {
                text.push_str(", then deletes the tag if no song has it");
            }
            text.push_str(". Anything changed since stays as it is.");
            text
        }
        REMOVE_TAG => format!(
            "Puts {tag} back on {}, with the values they had. Anything changed since stays as it is.",
            songs_count(count("removed"))
        ),
        CREATE_TAG => format!("Deletes the tag {tag}, which only works while no song has it."),
        UPDATE_TAG => "Puts back its old name and color, unless they changed again since.".into(),
        SAVE_QUERY => format!(
            "Deletes the saved query {}.",
            row.target_name.clone().unwrap_or_default()
        ),
        RENAME_SAVED_QUERY => "Puts back its old name, unless it changed again since.".into(),
        _ => "Reverses it, leaving anything changed since as it is.".into(),
    }
}

/// The ids a change's arguments name that must have come from a tool or a card, like the
/// phone tools' ids. A song id from the model's memory would tag the wrong song.
pub fn ids_named(name: &str, arguments: &str) -> Vec<String> {
    let Ok(args) = serde_json::from_str::<Value>(if arguments.trim().is_empty() {
        "{}"
    } else {
        arguments
    }) else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    for key in ["tag_id", "saved_query_id", "action_id"] {
        if let Some(id) = super::phone_tools::id_value(&args[key]) {
            ids.push(id);
        }
    }
    if let Some(songs) = args["songs"].as_array() {
        ids.extend(songs.iter().filter_map(super::phone_tools::id_value));
    }
    let _ = name;
    ids
}

fn song_value_pairs(value: &Value) -> Vec<(String, Option<String>)> {
    value
        .as_array()
        .map(|pairs| {
            pairs
                .iter()
                .filter_map(|pair| {
                    Some((
                        pair["song_id"].as_str()?.to_owned(),
                        pair["value"].as_str().map(str::to_owned),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|ids| {
            ids.iter()
                .filter_map(|id| id.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// Reverses one of `user_id`'s logged changes, leaving alone anything changed since, and
/// marks it undone. Returns the row and what the undo did, in words for the user.
/// `CannotUndo` for one already undone, one Cadenza cannot reverse, or a made tag still
/// on songs.
pub async fn undo(
    db: &DatabaseConnection,
    bus: Option<&SharedEventBus>,
    user_id: Uuid,
    action_id: i64,
) -> Result<(ActionRow, String), CadenzaError> {
    let txn = db.begin().await?;
    let row = actions::get_for_update(&txn, user_id, action_id).await?;
    if row.undone_at.is_some() {
        return Err(CadenzaError::CannotUndo(format!(
            "\"{}\" is already undone.",
            row.summary
        )));
    }
    if !row.undoable {
        return Err(CadenzaError::CannotUndo(format!(
            "\"{}\" can't be undone in Cadenza.",
            row.summary
        )));
    }
    let changes = row.changes.clone();
    let tag_id = changes["tag_id"].as_i64();
    let mut recorded = Vec::new();
    let mut retagged: Vec<String> = Vec::new();
    let message = match row.kind.as_str() {
        APPLY_TAG | REMOVE_TAG => {
            let tag = match tag_id {
                Some(tag_id) => db::tags::get_user_tag(&txn, user_id, tag_id).await?,
                None => None,
            }
            .ok_or_else(|| {
                CadenzaError::CannotUndo(format!(
                    "{} was deleted since, so there is nothing to undo.",
                    row.target_name.clone().unwrap_or_else(|| "The tag".into())
                ))
            })?;
            let reverted = if row.kind == APPLY_TAG {
                let added = strings(&changes["added"]);
                retagged = added.clone();
                actions::undo_apply_tag(
                    &txn,
                    user_id,
                    &tag,
                    &added,
                    changes["value"].as_str().map(str::to_owned),
                    &song_value_pairs(&changes["overwritten"]),
                )
                .await?
            } else {
                let removed = song_value_pairs(&changes["removed"]);
                retagged = removed.iter().map(|(song_id, _)| song_id.clone()).collect();
                actions::undo_remove_tag(&txn, user_id, &tag, &removed).await?
            };
            recorded = reverted.recorded;
            let mut message = if row.kind == APPLY_TAG {
                format!(
                    "Took {} back off {}",
                    tag.name,
                    songs_count(reverted.reverted)
                )
            } else {
                format!(
                    "Put {} back on {}",
                    tag.name,
                    songs_count(reverted.reverted)
                )
            };
            if reverted.skipped > 0 {
                message.push_str(&format!(
                    ". Left {} you changed since",
                    songs_count(reverted.skipped)
                ));
            }
            if row.kind == APPLY_TAG && changes["created_tag"].as_bool() == Some(true) {
                if actions::tag_application_count(&txn, user_id, tag.tag_id).await? == 0 {
                    delete_tag(&txn, user_id, tag.tag_id).await?;
                    message.push_str(&format!(", and deleted {}", tag.name));
                } else {
                    message.push_str(&format!(". Kept {} since songs still have it", tag.name));
                }
            }
            message
        }
        CREATE_TAG => {
            let tag_id = tag_id.unwrap_or_default();
            match db::tags::get_user_tag(&txn, user_id, tag_id).await? {
                None => "The tag was already deleted".to_owned(),
                Some(tag) => {
                    let on = actions::tag_application_count(&txn, user_id, tag_id).await?;
                    if on > 0 {
                        return Err(CadenzaError::CannotUndo(format!(
                            "{} is on {} now. Undo those changes first, or delete the tag in Library.",
                            tag.name,
                            songs_count(on as usize)
                        )));
                    }
                    delete_tag(&txn, user_id, tag_id).await?;
                    format!("Deleted {}", tag.name)
                }
            }
        }
        UPDATE_TAG => {
            let tag_id = tag_id.unwrap_or_default();
            let tag = db::tags::get_user_tag(&txn, user_id, tag_id)
                .await?
                .ok_or_else(|| {
                    CadenzaError::CannotUndo(
                        "The tag was deleted since, so there is nothing to undo.".into(),
                    )
                })?;
            let name_back = (changes["old_name"] != changes["new_name"]
                && changes["new_name"].as_str() == Some(tag.name.as_str()))
            .then(|| changes["old_name"].as_str().map(str::to_owned))
            .flatten();
            let color_back = (changes["old_color"] != changes["new_color"]
                && changes["new_color"].as_str() == Some(tag.color.as_str()))
            .then(|| changes["old_color"].as_str().map(str::to_owned))
            .flatten();
            if name_back.is_none() && color_back.is_none() {
                "Left it as it is, since it changed again since".to_owned()
            } else {
                // a name another tag took since cannot come back
                let restored_name = name_back.clone();
                txn.execute_raw(db::stmt(
                    "UPDATE tags SET name = COALESCE($3, name), color = COALESCE($4, color)
                     WHERE tag_id = $1 AND user_id = $2",
                    vec![
                        tag_id.into(),
                        user_id.into(),
                        restored_name.clone().into(),
                        color_back.clone().into(),
                    ],
                ))
                .await?;
                match restored_name {
                    Some(name) => format!("Renamed it back to {name}"),
                    None => "Put back its old color".to_owned(),
                }
            }
        }
        SAVE_QUERY => {
            let saved_query_id = changes["saved_query_id"].as_i64().unwrap_or_default();
            match txn
                .execute_raw(db::stmt(
                    "DELETE FROM saved_queries WHERE saved_query_id = $1 AND user_id = $2",
                    vec![saved_query_id.into(), user_id.into()],
                ))
                .await?
                .rows_affected()
            {
                0 => "The saved query was already deleted".to_owned(),
                _ => format!(
                    "Deleted the saved query {}",
                    changes["name"].as_str().unwrap_or_default()
                ),
            }
        }
        RENAME_SAVED_QUERY => {
            let saved_query_id = changes["saved_query_id"].as_i64().unwrap_or_default();
            let renamed = txn
                .execute_raw(db::stmt(
                    "UPDATE saved_queries SET name = $3
                     WHERE saved_query_id = $1 AND user_id = $2 AND name = $4",
                    vec![
                        saved_query_id.into(),
                        user_id.into(),
                        changes["old_name"].as_str().unwrap_or_default().into(),
                        changes["new_name"].as_str().unwrap_or_default().into(),
                    ],
                ))
                .await
                .map_err(|_| {
                    CadenzaError::CannotUndo(
                        "Another saved query has its old name now, so it can't go back.".into(),
                    )
                })?
                .rows_affected();
            if renamed == 0 {
                "Left it as it is, since it was renamed again or deleted".to_owned()
            } else {
                format!(
                    "Renamed it back to {}",
                    changes["old_name"].as_str().unwrap_or_default()
                )
            }
        }
        _ => {
            return Err(CadenzaError::CannotUndo(format!(
                "\"{}\" can't be undone.",
                row.summary
            )));
        }
    };
    let row = actions::mark_undone(&txn, user_id, action_id, &message).await?;
    txn.commit().await?;
    recorded.into_iter().for_each(|recorded| recorded.log());
    if let Some(tag_id) = tag_id
        && !retagged.is_empty()
    {
        spawn_add_retagged_songs(db.clone(), user_id, retagged, vec![tag_id]);
    }
    Ok((row, message))
}

async fn delete_tag(
    txn: &sea_orm::DatabaseTransaction,
    user_id: Uuid,
    tag_id: i64,
) -> Result<(), CadenzaError> {
    txn.execute_raw(db::stmt(
        "DELETE FROM tags WHERE tag_id = $1 AND user_id = $2",
        vec![tag_id.into(), user_id.into()],
    ))
    .await?;
    Ok(())
}

/// The write tools' definitions, sent to the model with the others.
pub fn definitions() -> Vec<Value> {
    let songs = json!({
        "description": "Which songs: \"card\" for every song on the card (this answer's, or else the one the user is looking at), or a list of song ids from a tool result. Or leave out and pass query instead.",
        "anyOf": [
            { "type": "string", "enum": ["card"] },
            { "type": "array", "items": { "type": "string" } }
        ]
    });
    let query = json!({
        "type": "object",
        "description": "Instead of songs: a Cadenza query, the same format as run_query's; the change covers every song it matches (up to 4,000), like \"my whole library\" or \"every Frank Ocean song I have\"."
    });
    let scope = json!({
        "type": "string",
        "enum": ["everything", "mine"],
        "description": "With query: mine for only the user's library and tagged songs, everything for every song Cadenza knows. Leave out to follow the user's query builder setting."
    });
    let new_tag = json!({
        "type": "object",
        "description": "Instead of tag_id, a tag to make first, when the user names one they do not have.",
        "properties": {
            "name": { "type": "string" },
            "color": { "type": "string", "description": "Optional hex color from the app's palette. Leave out to pick one." },
            "type": { "type": "string", "enum": ["basic", "text", "number", "date", "datetime", "duration", "checkbox"], "description": "basic (default) unless the user wants the tag to hold a value." }
        },
        "required": ["name"]
    });
    vec![
        json!({
            "type": "function",
            "name": APPLY_TAG,
            "description": "Puts one of the user's tags on songs, or makes a new tag and puts it on them. Waits for the user to confirm on a card, then runs; you get the result. Only when the user asked to tag songs. For an attribute tag, value sets its value on every one of the songs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tag_id": { "type": "integer", "description": "One of the user's own tags, from the prompt or list_tags. Not an activity or suggested tag." },
                    "new_tag": new_tag,
                    "value": { "type": "string", "description": "Optional, for an attribute tag only: the value, like \"4\" for a number or \"2024-06-01\" for a date." },
                    "songs": songs.clone(),
                    "query": query.clone(),
                    "scope": scope.clone()
                }
            }
        }),
        json!({
            "type": "function",
            "name": REMOVE_TAG,
            "description": "Takes one of the user's tags off songs. Waits for the user to confirm. Only the songs that have the tag count.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tag_id": { "type": "integer" },
                    "songs": songs,
                    "query": query,
                    "scope": scope
                },
                "required": ["tag_id"]
            }
        }),
        json!({
            "type": "function",
            "name": CREATE_TAG,
            "description": "Makes a new tag on no songs. Waits for the user to confirm. To make a tag and tag songs with it at once, use apply_tag with new_tag instead.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "color": { "type": "string" },
                    "type": { "type": "string", "enum": ["basic", "text", "number", "date", "datetime", "duration", "checkbox"] }
                },
                "required": ["name"]
            }
        }),
        json!({
            "type": "function",
            "name": UPDATE_TAG,
            "description": "Renames one of the user's tags or changes its color. Waits for the user to confirm. A tag's type cannot change.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tag_id": { "type": "integer" },
                    "name": { "type": "string" },
                    "color": { "type": "string", "description": "A hex color from the app's palette." }
                },
                "required": ["tag_id"]
            }
        }),
        json!({
            "type": "function",
            "name": SAVE_QUERY,
            "description": "Saves a query under a name, with the songs it matches now; it shows under Queries in Library. Waits for the user to confirm. Leave query out to save the query behind the run_query card on screen.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Title Case, 1 to 4 words, like \"Chill Before 2015\"." },
                    "query": { "type": "object", "description": "Optional: a query in run_query's format, instead of the card's." },
                    "scope": { "type": "string", "enum": ["everything", "mine"] }
                },
                "required": ["name"]
            }
        }),
        json!({
            "type": "function",
            "name": RENAME_SAVED_QUERY,
            "description": "Renames one of the user's saved queries. Waits for the user to confirm.",
            "parameters": {
                "type": "object",
                "properties": {
                    "saved_query_id": { "type": "integer", "description": "From list_saved_queries." },
                    "name": { "type": "string" }
                },
                "required": ["saved_query_id", "name"]
            }
        }),
        json!({
            "type": "function",
            "name": UNDO_ACTION,
            "description": "Undoes a change the assistant made, from the activity log: \"undo that\", \"undo the pop tagging\". Leave action_id out for the newest change that can be undone; otherwise get the id from list_recent_actions. Waits for the user to confirm. Only reverses what the change did, leaving alone anything changed since.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action_id": { "type": "integer" }
                }
            }
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_read_like_the_app() {
        assert_eq!(songs_count(1), "1 song");
        assert_eq!(songs_count(0), "0 songs");
        assert_eq!(songs_count(1243), "1,243 songs");
        assert_eq!(grouped(1_000_000), "1,000,000");
        assert_eq!(grouped(999), "999");
    }

    #[test]
    fn a_new_tag_gets_an_app_color() {
        assert_eq!(color_for("chill", Some("#2061F1")), "#2061f1");
        let picked = color_for("chill", Some("#123456"));
        assert!(TAG_COLORS.contains(&picked.as_str()));
        assert_eq!(picked, color_for("Chill", None));
    }

    #[test]
    fn names_are_checked() {
        assert!(checked_tag_name("  ").is_err());
        assert_eq!(checked_tag_name(" late night ").unwrap(), "late night");
        assert!(checked_tag_name(&"x".repeat(MAX_TAG_NAME_CHARS + 1)).is_err());
        assert!(checked_query_name("").is_err());
    }

    #[test]
    fn every_write_tool_has_a_definition_and_a_label() {
        let names: Vec<String> = definitions()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_owned())
            .collect();
        for name in WRITE_TOOLS {
            assert!(
                names.contains(&name.to_string()),
                "{name} has no definition"
            );
            assert_ne!(label_for(name), "Made a change", "{name} has no label");
        }
        assert!(!is_write_tool("run_query"));
    }

    #[test]
    fn a_change_names_ids_that_must_have_come_from_a_tool() {
        let ids = ids_named(APPLY_TAG, r#"{"tag_id":4,"songs":["a","b"]}"#);
        assert_eq!(ids, ["4", "a", "b"]);
        assert!(ids_named(APPLY_TAG, r#"{"tag_id":4,"songs":"card"}"#) == ["4"]);
        assert!(ids_named(UNDO_ACTION, "").is_empty());
    }

    #[test]
    fn an_undo_says_what_it_will_do() {
        let row = ActionRow {
            action_id: 1,
            user_id: Uuid::nil(),
            created_at: chrono::Utc::now().fixed_offset(),
            kind: APPLY_TAG.into(),
            summary: "Applied pop to 2 songs".into(),
            target_kind: Some("tag".into()),
            target_id: Some("4".into()),
            target_name: Some("pop".into()),
            changes: json!({ "added": ["a", "b"], "overwritten": [], "created_tag": true }),
            undoable: true,
            undone_at: None,
            undo_result: None,
        };
        let text = undo_description(&row);
        assert!(text.contains("pop off the 2 songs"));
        assert!(text.contains("deletes the tag"));
    }
}
