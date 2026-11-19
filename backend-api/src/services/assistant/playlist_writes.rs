//! The playlist changes the assistant can make, each after the user confirms it, like the
//! rest of [`super::writes`].
//!
//! Cadenza shared playlists: add, remove, and move songs (`edit_shared_playlist`), and
//! rename or redescribe (`update_shared_playlist`, owner only). Each is logged with
//! exactly what it changed, and its undo leaves alone anything changed since (a song
//! someone took out already, a rename someone made after). Every change tells the
//! playlist's other members, like the app's own edits do.
//!
//! Apple Music playlists run on the phone (`create_apple_music_playlist`,
//! `add_to_apple_music_playlist`), and the phone can only add, so those land in the log
//! as not undoable ([`record_apple_music`]).
//!
//! Deleting a playlist, leaving one, and anything about members or invites are not here
//! on purpose; the prompt tells the model to say so.

use std::collections::HashSet;

use chrono::DateTime;
use sea_orm::{DatabaseConnection, DatabaseTransaction, TransactionTrait, prelude::Uuid};
use serde::Deserialize;
use serde_json::{Value, json};

use super::writes::{CardRef, SongArgs, Writer, db_error, grouped, parse, songs_count};
use crate::db::{
    self,
    assistant_actions::{self as actions, ActionRow, NewAction},
    now_playing::is_catalog_id,
    shared_playlists::{
        self as playlists, MAX_PLAYLIST_SONGS, MAX_SONGS_PER_ADD, PlaylistEntry, PlaylistRole,
        SongEdit,
    },
};
use crate::err::CadenzaError;
use crate::routes::json::assistant::WritePreview;
use crate::services::realtime::{EventKind, SharedEventBus, Topic, publish_version};

pub const EDIT_SHARED_PLAYLIST: &str = "edit_shared_playlist";
pub const UPDATE_SHARED_PLAYLIST: &str = "update_shared_playlist";
pub const ADD_TO_APPLE_MUSIC_PLAYLIST: &str = "add_to_apple_music_playlist";
pub const CREATE_APPLE_MUSIC_PLAYLIST: &str = "create_apple_music_playlist";

/// The longest description, the same as `PATCH /shared-playlists/{id}`.
const MAX_DESCRIPTION_CHARS: usize = 500;

/// A playlist change, worked out from the model's arguments, before it runs.
#[derive(Debug)]
pub enum PlaylistPlan {
    Add {
        playlist_id: i64,
        name: String,
        songs: Vec<String>,
        /// 0 based, None for the end.
        position: Option<i32>,
        already: usize,
        library_only: usize,
    },
    Remove {
        playlist_id: i64,
        name: String,
        songs: Vec<String>,
    },
    Move {
        playlist_id: i64,
        name: String,
        song_id: String,
        title: String,
        /// 0 based.
        to: i32,
    },
    Details {
        playlist_id: i64,
        name: String,
        new_name: Option<String>,
        new_description: Option<String>,
    },
}

#[derive(Deserialize)]
struct EditArgs {
    playlist_id: i64,
    action: String,
    #[serde(default)]
    song_id: Option<String>,
    /// 1 based.
    #[serde(default)]
    position: Option<i64>,
    #[serde(flatten)]
    songs: SongArgs,
}

#[derive(Deserialize)]
struct DetailsArgs {
    playlist_id: i64,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

pub fn label_for(name: &str) -> Option<&'static str> {
    match name {
        EDIT_SHARED_PLAYLIST => Some("Changed a shared playlist"),
        UPDATE_SHARED_PLAYLIST => Some("Renamed a shared playlist"),
        _ => None,
    }
}

fn not_a_member(playlist_id: i64) -> String {
    format!(
        "the user is not in a shared playlist with id {playlist_id}; call list_playlists for their ids"
    )
}

/// A 1 based position from the model as 0 based, at least 0.
fn zero_based(position: i64) -> i32 {
    (position - 1).clamp(0, i32::MAX as i64) as i32
}

/// Works out a playlist change, checking the user's role and the songs before anything runs.
pub async fn plan(
    writer: &Writer<'_>,
    name: &str,
    arguments: &str,
    card: CardRef<'_>,
) -> Result<PlaylistPlan, String> {
    match name {
        EDIT_SHARED_PLAYLIST => {
            let args: EditArgs = parse(arguments)?;
            let (playlist, _, role) =
                playlists::name_and_role(writer.db, writer.user_id, args.playlist_id)
                    .await
                    .map_err(|_| not_a_member(args.playlist_id))?;
            if role == PlaylistRole::Viewer {
                return Err(format!(
                    "the user is a viewer of {playlist}, so they cannot change its songs; tell them the owner can make them an editor"
                ));
            }
            let entries = playlists::entries_in(writer.db, args.playlist_id)
                .await
                .map_err(db_error)?;
            let present: HashSet<&str> = entries.iter().map(|e| e.song_id.as_str()).collect();
            match args.action.as_str() {
                "add" => {
                    let (songs, _) = writer.songs(&args.songs, card).await?;
                    let (catalog, library): (Vec<String>, Vec<String>) =
                        songs.into_iter().partition(|id| is_catalog_id(id));
                    if catalog.is_empty() {
                        return Err("those are all library only songs (uploaded or synced from the user's own files), and a shared playlist only holds Apple Music catalog songs; tell the user".into());
                    }
                    let already = catalog
                        .iter()
                        .filter(|id| present.contains(id.as_str()))
                        .count();
                    let fresh: Vec<String> = catalog
                        .into_iter()
                        .filter(|id| !present.contains(id.as_str()))
                        .collect();
                    if fresh.is_empty() {
                        return Err(format!(
                            "every one of those songs is already in {playlist}; nothing would change"
                        ));
                    }
                    if fresh.len() > MAX_SONGS_PER_ADD {
                        return Err(format!(
                            "that is {}, and one add to a shared playlist takes at most {MAX_SONGS_PER_ADD}; narrow it down, or split it",
                            songs_count(fresh.len())
                        ));
                    }
                    if entries.len() + fresh.len() > MAX_PLAYLIST_SONGS {
                        return Err(format!(
                            "{playlist} has {} and a shared playlist holds at most {MAX_PLAYLIST_SONGS}, so {} do not fit",
                            songs_count(entries.len()),
                            songs_count(fresh.len())
                        ));
                    }
                    Ok(PlaylistPlan::Add {
                        playlist_id: args.playlist_id,
                        name: playlist,
                        songs: fresh,
                        position: args.position.map(zero_based),
                        already,
                        library_only: library.len(),
                    })
                }
                "remove" => {
                    let (songs, _) = writer.songs(&args.songs, card).await?;
                    let songs: Vec<String> = songs
                        .into_iter()
                        .filter(|id| present.contains(id.as_str()))
                        .collect();
                    if songs.is_empty() {
                        return Err(format!(
                            "none of those songs are in {playlist}; get its songs with get_playlist_songs"
                        ));
                    }
                    Ok(PlaylistPlan::Remove {
                        playlist_id: args.playlist_id,
                        name: playlist,
                        songs,
                    })
                }
                "move" => {
                    let song_id = args
                        .song_id
                        .ok_or("pass song_id, the song to move, from get_playlist_songs")?;
                    let from = entries
                        .iter()
                        .position(|e| e.song_id == song_id)
                        .ok_or_else(|| format!("that song is not in {playlist}"))?;
                    let position = args
                        .position
                        .ok_or("pass position, where it goes, 1 for the top")?;
                    let to = (zero_based(position) as usize).min(entries.len().saturating_sub(1));
                    if to == from {
                        return Err(format!("it is already at #{} in {playlist}", from + 1));
                    }
                    let title = song_title(writer.db, &song_id).await;
                    Ok(PlaylistPlan::Move {
                        playlist_id: args.playlist_id,
                        name: playlist,
                        song_id,
                        title,
                        to: to as i32,
                    })
                }
                other => Err(format!("action must be add, remove, or move, not {other}")),
            }
        }
        UPDATE_SHARED_PLAYLIST => {
            let args: DetailsArgs = parse(arguments)?;
            let (playlist, description, role) =
                playlists::name_and_role(writer.db, writer.user_id, args.playlist_id)
                    .await
                    .map_err(|_| not_a_member(args.playlist_id))?;
            if role != PlaylistRole::Owner {
                return Err(format!(
                    "only the owner of {playlist} can rename it or change its description; the user is an {}. Tell them so",
                    if role == PlaylistRole::Editor {
                        "editor"
                    } else {
                        "viewer"
                    }
                ));
            }
            let new_name = args
                .name
                .map(|name| name.trim().to_owned())
                .filter(|name| *name != playlist);
            if new_name.as_ref().is_some_and(|name| name.is_empty()) {
                return Err("a playlist needs a name".into());
            }
            let new_description = args
                .description
                .map(|d| d.trim().to_owned())
                .filter(|d| *d != description);
            if new_description
                .as_ref()
                .is_some_and(|d| d.chars().count() > MAX_DESCRIPTION_CHARS)
            {
                return Err(format!(
                    "a description is at most {MAX_DESCRIPTION_CHARS} characters"
                ));
            }
            if new_name.is_none() && new_description.is_none() {
                return Err("that changes nothing; pass a new name or a new description".into());
            }
            Ok(PlaylistPlan::Details {
                playlist_id: args.playlist_id,
                name: playlist,
                new_name,
                new_description,
            })
        }
        other => Err(format!("{other} is not a playlist change")),
    }
}

async fn song_title(db: &DatabaseConnection, song_id: &str) -> String {
    db::metadata_tags::get_song_rows(db, &[song_id.to_owned()])
        .await
        .ok()
        .and_then(|rows| rows.get(song_id).map(|row| row.name.clone()))
        .unwrap_or_else(|| "the song".to_owned())
}

/// The confirm card for a playlist change.
pub async fn preview(writer: &Writer<'_>, plan: &PlaylistPlan) -> WritePreview {
    const EVERYONE: &str = "Everyone in the playlist sees it. You can undo this.";
    match plan {
        PlaylistPlan::Add {
            name,
            songs,
            position,
            already,
            library_only,
            ..
        } => {
            let mut detail = writer.sample(songs).await;
            match position {
                Some(at) => detail.push_str(&format!(". At #{}", at + 1)),
                None => detail.push_str(". At the end"),
            }
            if *already > 0 {
                detail.push_str(&format!(". {} already in it", grouped(*already)));
            }
            if *library_only > 0 {
                detail.push_str(&format!(
                    ". {} only in your library {} left out, since a shared playlist holds Apple Music songs",
                    songs_count(*library_only),
                    if *library_only == 1 { "is" } else { "are" }
                ));
            }
            WritePreview {
                title: format!("Add {} to {name}?", songs_count(songs.len())),
                detail: format!("{detail}. {EVERYONE}"),
                confirm_label: "Add Songs".into(),
            }
        }
        PlaylistPlan::Remove { name, songs, .. } => WritePreview {
            title: format!("Remove {} from {name}?", songs_count(songs.len())),
            detail: format!("{}. {EVERYONE}", writer.sample(songs).await),
            confirm_label: "Remove".into(),
        },
        PlaylistPlan::Move {
            name, title, to, ..
        } => WritePreview {
            title: format!("Move {title} to #{} in {name}?", to + 1),
            detail: EVERYONE.into(),
            confirm_label: "Move".into(),
        },
        PlaylistPlan::Details {
            name,
            new_name,
            new_description,
            ..
        } => WritePreview {
            title: match new_name {
                Some(new_name) => format!("Rename {name} to {new_name}?"),
                None => format!("Change the description of {name}?"),
            },
            detail: match (new_name, new_description) {
                (_, Some(d)) if d.is_empty() => format!("Clears its description. {EVERYONE}"),
                (_, Some(d)) => format!("\"{d}\". {EVERYONE}"),
                (_, None) => EVERYONE.into(),
            },
            confirm_label: "Save".into(),
        },
    }
}

fn entry_json(entry: &PlaylistEntry) -> Value {
    json!({
        "song_id": entry.song_id,
        "position": entry.position,
        "added_by": entry.added_by,
        "added_at": entry.added_at.to_rfc3339(),
    })
}

fn entry_from(value: &Value) -> Option<PlaylistEntry> {
    Some(PlaylistEntry {
        song_id: value["song_id"].as_str()?.to_owned(),
        position: value["position"].as_i64().unwrap_or_default() as i32,
        added_by: value["added_by"]
            .as_str()
            .and_then(|id| Uuid::parse_str(id).ok()),
        added_at: DateTime::parse_from_rfc3339(value["added_at"].as_str()?).ok()?,
    })
}

fn publish(bus: Option<&SharedEventBus>, playlist_id: i64, version: i64) {
    if let Some(bus) = bus {
        publish_version(
            bus,
            Topic::SharedPlaylist(playlist_id),
            version,
            EventKind::Playlist,
        );
    }
}

fn playlist_error(err: CadenzaError) -> String {
    match err {
        CadenzaError::NotFound => "that playlist or song is not there any more".into(),
        CadenzaError::Forbidden(_) => {
            "the user can no longer make that change to this playlist".into()
        }
        CadenzaError::InvalidRequestBody(message) => message,
        other => db_error(other),
    }
}

/// Makes a confirmed playlist change and logs it. None when nothing changed after all.
pub async fn execute(writer: &Writer<'_>, plan: PlaylistPlan) -> Result<Option<ActionRow>, String> {
    let txn = writer
        .db
        .begin()
        .await
        .map_err(|err| db_error(err.into()))?;
    let (row, published) = match plan {
        PlaylistPlan::Add {
            playlist_id,
            name,
            songs,
            position,
            ..
        } => {
            let edited = playlists::edit_songs_in(
                &txn,
                writer.user_id,
                playlist_id,
                SongEdit::Add {
                    song_ids: &songs,
                    position,
                },
            )
            .await
            .map_err(playlist_error)?;
            let Some(version) = edited.version else {
                return Ok(None);
            };
            let summary = format!("Added {} to {name}", songs_count(edited.added.len()));
            let row =
                record_edit(&txn, writer.user_id, playlist_id, &name, summary, &edited).await?;
            (row, (playlist_id, version, edited.added))
        }
        PlaylistPlan::Remove {
            playlist_id,
            name,
            songs,
        } => {
            let edited = playlists::edit_songs_in(
                &txn,
                writer.user_id,
                playlist_id,
                SongEdit::Remove { song_ids: &songs },
            )
            .await
            .map_err(playlist_error)?;
            let Some(version) = edited.version else {
                return Ok(None);
            };
            let summary = format!("Removed {} from {name}", songs_count(edited.removed.len()));
            let row =
                record_edit(&txn, writer.user_id, playlist_id, &name, summary, &edited).await?;
            (row, (playlist_id, version, Vec::new()))
        }
        PlaylistPlan::Move {
            playlist_id,
            name,
            song_id,
            title,
            to,
        } => {
            let edited = playlists::edit_songs_in(
                &txn,
                writer.user_id,
                playlist_id,
                SongEdit::Move {
                    song_id: &song_id,
                    to_position: to,
                },
            )
            .await
            .map_err(playlist_error)?;
            let (Some(version), Some((_, _, at))) = (edited.version, &edited.moved) else {
                return Ok(None);
            };
            let summary = format!("Moved {title} to #{} in {name}", at + 1);
            let row =
                record_edit(&txn, writer.user_id, playlist_id, &name, summary, &edited).await?;
            (row, (playlist_id, version, Vec::new()))
        }
        PlaylistPlan::Details {
            playlist_id,
            name,
            new_name,
            new_description,
        } => {
            let changed = playlists::update_details_in(
                &txn,
                writer.user_id,
                playlist_id,
                new_name.as_deref(),
                new_description.as_deref(),
                None,
            )
            .await
            .map_err(playlist_error)?
            .ok_or("the playlist changed while you were confirming; try again")?;
            let summary = if changed.new_name != changed.old_name {
                format!("Renamed the playlist {name} to {}", changed.new_name)
            } else {
                format!("Changed the description of {name}")
            };
            let row = actions::record(
                &txn,
                writer.user_id,
                NewAction {
                    kind: UPDATE_SHARED_PLAYLIST,
                    summary,
                    target_kind: Some("shared_playlist"),
                    target_id: Some(playlist_id.to_string()),
                    target_name: Some(changed.new_name.clone()),
                    changes: json!({
                        "playlist_id": playlist_id,
                        "old_name": changed.old_name,
                        "new_name": changed.new_name,
                        "old_description": changed.old_description,
                        "new_description": changed.new_description,
                    }),
                    undoable: true,
                },
            )
            .await
            .map_err(db_error)?;
            (row, (playlist_id, changed.version, Vec::new()))
        }
    };
    txn.commit().await.map_err(|err| db_error(err.into()))?;
    let (playlist_id, version, added) = published;
    publish(writer.bus, playlist_id, version);
    if !added.is_empty() {
        // the playlist screen shows titles and artwork from Cadenza's song rows
        if let Some(song_meta) = writer.song_meta {
            crate::services::metadata_tags::spawn_store_song_metadata(
                writer.db.clone(),
                song_meta.clone(),
                added,
            );
        }
    }
    Ok(Some(row))
}

async fn record_edit(
    txn: &DatabaseTransaction,
    user_id: Uuid,
    playlist_id: i64,
    name: &str,
    summary: String,
    edited: &playlists::SongsEdited,
) -> Result<ActionRow, String> {
    actions::record(
        txn,
        user_id,
        NewAction {
            kind: EDIT_SHARED_PLAYLIST,
            summary,
            target_kind: Some("shared_playlist"),
            target_id: Some(playlist_id.to_string()),
            target_name: Some(name.to_owned()),
            changes: json!({
                "playlist_id": playlist_id,
                "added": edited.added,
                "removed": edited.removed.iter().map(entry_json).collect::<Vec<_>>(),
                "moved": edited.moved.as_ref().map(|(song_id, from, to)| json!({
                    "song_id": song_id,
                    "from": from,
                    "to": to,
                })),
            }),
            undoable: true,
        },
    )
    .await
    .map_err(db_error)
}

/// What undoing a playlist row will do, for its confirm card.
pub fn undo_description(row: &ActionRow) -> Option<String> {
    let changes = &row.changes;
    let name = row
        .target_name
        .clone()
        .unwrap_or_else(|| "the playlist".into());
    let count = |key: &str| changes[key].as_array().map_or(0, Vec::len);
    match row.kind.as_str() {
        EDIT_SHARED_PLAYLIST => Some(if count("added") > 0 {
            format!(
                "Takes the {} it added back out of {name}. Songs someone already took out stay out.",
                songs_count(count("added"))
            )
        } else if count("removed") > 0 {
            format!(
                "Puts the {} it removed back in {name}, where they were. Songs someone already put back stay where they are.",
                songs_count(count("removed"))
            )
        } else {
            format!("Moves the song back where it was in {name}, unless someone moved it since.")
        }),
        UPDATE_SHARED_PLAYLIST => Some(
            "Puts back its old name and description, unless someone changed them again since."
                .into(),
        ),
        ADD_TO_APPLE_MUSIC_PLAYLIST | CREATE_APPLE_MUSIC_PLAYLIST => {
            Some("Cadenza can't change Apple Music playlists afterwards.".into())
        }
        _ => None,
    }
}

fn cannot(row: &ActionRow, err: CadenzaError) -> CadenzaError {
    let name = row
        .target_name
        .clone()
        .unwrap_or_else(|| "The playlist".into());
    match err {
        CadenzaError::NotFound => CadenzaError::CannotUndo(format!(
            "{name} was deleted, or you left it, so there is nothing to undo."
        )),
        CadenzaError::Forbidden(_) => CadenzaError::CannotUndo(format!(
            "You can't change {name} any more, so this can't be undone."
        )),
        CadenzaError::InvalidRequestBody(message) => CadenzaError::CannotUndo(message),
        other => other,
    }
}

/// Reverses a logged playlist change in `txn`. Returns what it did in words and, when the
/// playlist changed, its id and new version to tell the other members once `txn` commits.
/// None for a row that is not a playlist change.
pub async fn undo(
    txn: &DatabaseTransaction,
    user_id: Uuid,
    row: &ActionRow,
) -> Option<Result<(String, Option<(i64, i64)>), CadenzaError>> {
    let changes = &row.changes;
    let playlist_id = changes["playlist_id"].as_i64().unwrap_or_default();
    let name = row
        .target_name
        .clone()
        .unwrap_or_else(|| "the playlist".into());
    match row.kind.as_str() {
        EDIT_SHARED_PLAYLIST => Some(
            async {
                let added: Vec<String> = changes["added"]
                    .as_array()
                    .map(|ids| {
                        ids.iter()
                            .filter_map(|id| id.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default();
                let removed: Vec<PlaylistEntry> = changes["removed"]
                    .as_array()
                    .map(|entries| entries.iter().filter_map(entry_from).collect())
                    .unwrap_or_default();
                let moved = changes["moved"]["song_id"].as_str().map(|song_id| {
                    (
                        song_id,
                        changes["moved"]["from"].as_i64().unwrap_or_default() as i32,
                        changes["moved"]["to"].as_i64().unwrap_or_default() as i32,
                    )
                });
                let reverted =
                    playlists::revert_songs_in(txn, user_id, playlist_id, &added, &removed, moved)
                        .await
                        .map_err(|err| cannot(row, err))?;
                let mut message = if !added.is_empty() {
                    format!("Took {} back out of {name}", songs_count(reverted.reverted))
                } else if !removed.is_empty() {
                    format!("Put {} back in {name}", songs_count(reverted.reverted))
                } else if reverted.reverted > 0 {
                    format!("Moved the song back in {name}")
                } else {
                    format!("Left {name} as it is, since the song was moved again since")
                };
                if reverted.skipped > 0 && (!added.is_empty() || !removed.is_empty()) {
                    message.push_str(&format!(
                        ". Left {} that changed since",
                        songs_count(reverted.skipped)
                    ));
                }
                Ok((
                    message,
                    reverted.version.map(|version| (playlist_id, version)),
                ))
            }
            .await,
        ),
        UPDATE_SHARED_PLAYLIST => Some(
            async {
                let old_name = changes["old_name"].as_str().unwrap_or_default();
                let new_name = changes["new_name"].as_str().unwrap_or_default();
                let old_description = changes["old_description"].as_str().unwrap_or_default();
                let new_description = changes["new_description"].as_str().unwrap_or_default();
                let changed = playlists::update_details_in(
                    txn,
                    user_id,
                    playlist_id,
                    Some(old_name),
                    Some(old_description),
                    Some((new_name, new_description)),
                )
                .await
                .map_err(|err| cannot(row, err))?;
                Ok(match changed {
                    None => (
                        format!("Left {name} as it is, since it was changed again since"),
                        None,
                    ),
                    Some(changed) => (
                        if old_name != new_name {
                            format!("Renamed it back to {old_name}")
                        } else {
                            "Put back its old description".to_owned()
                        },
                        Some((playlist_id, changed.version)),
                    ),
                })
            }
            .await,
        ),
        _ => None,
    }
}

/// Tells the playlist's other members it changed. For [`super::writes::undo`].
pub fn published(bus: Option<&SharedEventBus>, changed: Option<(i64, i64)>) {
    if let Some((playlist_id, version)) = changed {
        publish(bus, playlist_id, version);
    }
}

/// Logs an Apple Music playlist change the phone made, as not undoable, since the phone
/// can only add. `output` is what the phone sent back; anything but a success (an error,
/// a no on its confirm card) logs nothing.
pub async fn record_apple_music(
    db: &DatabaseConnection,
    user_id: Uuid,
    name: &str,
    arguments: &str,
    output: &Value,
) -> Option<ActionRow> {
    if output.get("error").is_some() || output.get("cancelled").is_some() {
        return None;
    }
    let args: Value = serde_json::from_str(arguments).unwrap_or(Value::Null);
    let (summary, playlist_id, playlist_name, count) = match name {
        CREATE_APPLE_MUSIC_PLAYLIST => {
            let playlist_name = output["created"].as_str()?.to_owned();
            let count = output["songs"].as_u64().unwrap_or_default() as usize;
            (
                format!(
                    "Made the Apple Music playlist {playlist_name} with {}",
                    songs_count(count)
                ),
                output["playlist_id"].as_str().map(str::to_owned),
                playlist_name,
                count,
            )
        }
        ADD_TO_APPLE_MUSIC_PLAYLIST => {
            let count = output["added"].as_u64()? as usize;
            let playlist_name = output["playlist"]
                .as_str()
                .or(args["playlist_name"].as_str())
                .unwrap_or("an Apple Music playlist")
                .to_owned();
            (
                format!(
                    "Added {} to {playlist_name} in Apple Music",
                    songs_count(count)
                ),
                args["playlist_id"].as_str().map(str::to_owned),
                playlist_name,
                count,
            )
        }
        _ => return None,
    };
    let kind = if name == CREATE_APPLE_MUSIC_PLAYLIST {
        CREATE_APPLE_MUSIC_PLAYLIST
    } else {
        ADD_TO_APPLE_MUSIC_PLAYLIST
    };
    let recorded = actions::record(
        db,
        user_id,
        NewAction {
            kind,
            summary,
            target_kind: Some("apple_music_playlist"),
            target_id: playlist_id,
            target_name: Some(playlist_name),
            changes: json!({ "songs": count }),
            undoable: false,
        },
    )
    .await;
    match recorded {
        Ok(row) => Some(row),
        Err(err) => {
            eprintln!("[assistant] logging an Apple Music change failed: {err}");
            None
        }
    }
}

/// The playlist tools' definitions.
pub fn definitions() -> Vec<Value> {
    let songs = json!({
        "description": "For add or remove: \"card\" for every song on the card (this answer's, or else the one the user is looking at), or a list of song ids from a tool result.",
        "anyOf": [
            { "type": "string", "enum": ["card"] },
            { "type": "array", "items": { "type": "string" } }
        ]
    });
    vec![
        json!({
            "type": "function",
            "name": EDIT_SHARED_PLAYLIST,
            "description": "Changes the songs in one Cadenza shared playlist the user can edit (owner or editor): add songs, remove songs, or move one song. One action per call. The user confirms it on a card first, every member sees the change, and it can be undone. Not for Apple Music playlists (add_to_apple_music_playlist) and never deletes the playlist. A shared playlist holds Apple Music catalog songs only, up to 1,000, and an add takes up to 200. Get playlist_id from list_playlists and the songs in it from get_playlist_songs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "playlist_id": { "type": "integer" },
                    "action": { "type": "string", "enum": ["add", "remove", "move"] },
                    "songs": songs,
                    "song_id": { "type": "string", "description": "For move: the song to move, from get_playlist_songs." },
                    "position": { "type": "integer", "description": "1 is the top. For add, where the songs go (leave out for the end); for move, where the song goes." }
                },
                "required": ["playlist_id", "action"]
            }
        }),
        json!({
            "type": "function",
            "name": UPDATE_SHARED_PLAYLIST,
            "description": "Renames a Cadenza shared playlist or changes its description. Only its owner can. The user confirms it on a card first, and it can be undone. Get playlist_id from list_playlists.",
            "parameters": {
                "type": "object",
                "properties": {
                    "playlist_id": { "type": "integer" },
                    "name": { "type": "string", "description": "The new name, Title Case." },
                    "description": { "type": "string", "description": "The new description, up to 500 characters; empty clears it." }
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
    fn positions_from_the_model_are_one_based() {
        assert_eq!(zero_based(1), 0);
        assert_eq!(zero_based(3), 2);
        assert_eq!(zero_based(0), 0);
        assert_eq!(zero_based(-4), 0);
    }

    #[test]
    fn a_removed_entry_survives_the_log() {
        let entry = PlaylistEntry {
            song_id: "1440818588".into(),
            position: 4,
            added_by: Some(Uuid::nil()),
            added_at: DateTime::parse_from_rfc3339("2026-11-01T10:00:00+00:00").unwrap(),
        };
        let back = entry_from(&entry_json(&entry)).unwrap();
        assert_eq!(back.song_id, entry.song_id);
        assert_eq!(back.position, 4);
        assert_eq!(back.added_by, entry.added_by);
        assert_eq!(back.added_at, entry.added_at);
    }
}
