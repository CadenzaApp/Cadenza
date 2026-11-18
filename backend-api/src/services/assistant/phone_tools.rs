//! The tools only the phone can run: playback, the Apple Music library and
//! catalog, favorites, and opening a screen. The backend never runs them. The
//! loop hands each call to the phone as a `client_tool_call`, and the phone
//! posts the result back (see `run_loop`).
//!
//! The server does two things to a call on the way: a `songs` argument of
//! `"card"` becomes the card's song ids, since the model only ever sees the
//! first few, and a `card` in the phone's output becomes the card under the
//! answer instead of going to the model.

use serde_json::{Value, json};

use super::tools::{MAX_CARD_SONGS, card_title};
use crate::routes::json::assistant::SongsCard;

/// Every phone tool, by name.
const PHONE_TOOLS: &[&str] = &[
    "now_playing",
    "play",
    "playback",
    "queue_songs",
    "set_shuffle",
    "set_repeat",
    "search_apple_music",
    "apple_music_playlists",
    "apple_music_playlist_songs",
    "favorite_song",
    "create_apple_music_playlist",
    "add_to_apple_music_playlist",
    "open_screen",
];

/// The tools that take a `songs` argument.
const TAKES_SONGS: &[&str] = &[
    "play",
    "queue_songs",
    "create_apple_music_playlist",
    "add_to_apple_music_playlist",
];

pub fn is_phone_tool(name: &str) -> bool {
    PHONE_TOOLS.contains(&name)
}

/// The status row for a phone tool.
pub fn label_for(name: &str) -> &'static str {
    match name {
        "now_playing" => "Checked what's playing",
        "play" => "Started playback",
        "playback" => "Controlled playback",
        "queue_songs" => "Queued songs",
        "set_shuffle" => "Changed shuffle",
        "set_repeat" => "Changed repeat",
        "search_apple_music" => "Searched Apple Music",
        "apple_music_playlists" => "Looked up your Apple Music playlists",
        "apple_music_playlist_songs" => "Opened an Apple Music playlist",
        "favorite_song" => "Updated a favorite",
        "create_apple_music_playlist" => "Made an Apple Music playlist",
        "add_to_apple_music_playlist" => "Added to an Apple Music playlist",
        "open_screen" => "Opened a screen",
        _ => "Tried a tool",
    }
}

/// The arguments the phone gets for a call, or an error for the model.
///
/// A `songs` of `"card"` is replaced with the ids on `card`, the card this
/// answer has so far or else the last one shown. A list of ids is kept, cut to
/// [`MAX_CARD_SONGS`].
pub fn prepare_arguments(
    name: &str,
    arguments: &str,
    card: Option<&[String]>,
) -> Result<Value, String> {
    let mut args: Value = if arguments.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(arguments).map_err(|err| format!("arguments are not JSON: {err}"))?
    };
    if !args.is_object() {
        return Err("arguments must be a JSON object".to_owned());
    }
    if !TAKES_SONGS.contains(&name) {
        return Ok(args);
    }

    let songs = match &args["songs"] {
        Value::String(which) if which == "card" => match card {
            Some(ids) if !ids.is_empty() => ids.to_vec(),
            _ => {
                return Err(
                    "there is no song card yet; find the songs first (run_query, a saved query, a playlist, or search_apple_music)"
                        .to_owned(),
                );
            }
        },
        Value::Array(ids) => ids
            .iter()
            .filter_map(|id| id.as_str().map(str::to_owned))
            .collect(),
        // playing an Apple Music playlist by id needs no songs
        Value::Null if name == "play" && args["apple_music_playlist_id"].is_string() => {
            return Ok(args);
        }
        _ => return Err("songs must be \"card\" or a list of song ids".to_owned()),
    };
    if songs.is_empty() {
        return Err("songs is empty".to_owned());
    }
    args["songs"] = songs
        .into_iter()
        .take(MAX_CARD_SONGS)
        .map(Value::from)
        .collect();
    Ok(args)
}

/// Takes the `card` out of a phone tool's output: the songs to show under the
/// answer. What is left is what the model reads. None when there is no usable
/// card.
pub fn take_card(output: &mut Value) -> Option<SongsCard> {
    let card = output.as_object_mut()?.remove("card")?;
    let mut card: SongsCard = serde_json::from_value(card).ok()?;
    card.song_ids.truncate(MAX_CARD_SONGS);
    if card.song_ids.is_empty() {
        return None;
    }
    card.total = card.total.max(card.song_ids.len());
    card.title = card_title(card.title);
    Some(card)
}

/// The phone tools' definitions, sent to the model with the server's.
pub fn definitions() -> Vec<Value> {
    let songs = json!({
        "description": "\"card\" for every song on the card (this answer's, or else the last one shown), which is almost always what you want. Or a list of song ids from a tool result.",
        "anyOf": [
            { "type": "string", "enum": ["card"] },
            { "type": "array", "items": { "type": "string" } }
        ]
    });
    vec![
        json!({
            "type": "function",
            "name": "now_playing",
            "description": "What is playing on the phone right now: the song (id, title, artist, album, artist id), whether it is playing or paused, how far in, the next songs in the queue, and shuffle and repeat. Use for \"what is this song\", \"what's next\", or anything about \"this song\". Also says when playback is locked, like in a live session the user cannot control.",
            "parameters": { "type": "object", "properties": {} }
        }),
        json!({
            "type": "function",
            "name": "play",
            "description": "Plays songs now, replacing the queue: the songs on the card, a list of song ids, or one of the user's Apple Music playlists. To play a saved query or a shared playlist, get its songs as a card first. Shuffle shuffles the list itself.",
            "parameters": {
                "type": "object",
                "properties": {
                    "songs": songs.clone(),
                    "apple_music_playlist_id": { "type": "string", "description": "Instead of songs: an id from apple_music_playlists." },
                    "shuffle": { "type": "boolean", "description": "Play in a random order. Defaults to false." }
                }
            }
        }),
        json!({
            "type": "function",
            "name": "playback",
            "description": "Pause, resume, skip to the next or previous song, or restart the current one.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["pause", "resume", "next", "previous", "restart"] }
                },
                "required": ["action"]
            }
        }),
        json!({
            "type": "function",
            "name": "queue_songs",
            "description": "Adds songs to the queue without stopping what is playing: next (right after the current song) or at the end.",
            "parameters": {
                "type": "object",
                "properties": {
                    "songs": songs.clone(),
                    "position": { "type": "string", "enum": ["next", "end"] }
                },
                "required": ["songs", "position"]
            }
        }),
        json!({
            "type": "function",
            "name": "set_shuffle",
            "description": "Turns Apple Music's shuffle on or off for what is playing.",
            "parameters": {
                "type": "object",
                "properties": { "on": { "type": "boolean" } },
                "required": ["on"]
            }
        }),
        json!({
            "type": "function",
            "name": "set_repeat",
            "description": "Sets repeat: off, one (the current song), or all (the queue).",
            "parameters": {
                "type": "object",
                "properties": { "mode": { "type": "string", "enum": ["off", "one", "all"] } },
                "required": ["mode"]
            }
        }),
        json!({
            "type": "function",
            "name": "search_apple_music",
            "description": "Searches the whole Apple Music catalog for songs, including ones Cadenza has never seen, which run_query cannot find. Use it when the user names a specific song or artist to play or look up, or when run_query found nothing. Returns songs with ids, title, artist, and album; they show as a card.",
            "parameters": {
                "type": "object",
                "properties": {
                    "term": { "type": "string", "description": "What to search for, like \"Blinding Lights The Weeknd\"." },
                    "limit": { "type": "integer", "description": "1 to 25. Defaults to 10." },
                    "title": { "type": "string", "description": "The card's title, Title Case, 2 to 4 words, no period." }
                },
                "required": ["term"]
            }
        }),
        json!({
            "type": "function",
            "name": "apple_music_playlists",
            "description": "The user's own Apple Music library playlists (the ones in the Music app, not Cadenza shared playlists): id and name. Optionally only those whose name contains a word.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name_contains": { "type": "string" }
                }
            }
        }),
        json!({
            "type": "function",
            "name": "apple_music_playlist_songs",
            "description": "The songs in one of the user's Apple Music playlists, in order, as a card. Get the id from apple_music_playlists.",
            "parameters": {
                "type": "object",
                "properties": { "playlist_id": { "type": "string" } },
                "required": ["playlist_id"]
            }
        }),
        json!({
            "type": "function",
            "name": "favorite_song",
            "description": "Favorites or unfavorites a song in Apple Music, which also sets Cadenza's Favorited activity tag.",
            "parameters": {
                "type": "object",
                "properties": {
                    "song_id": { "type": "string", "description": "A song id, or \"current\" for the song playing now." },
                    "favorite": { "type": "boolean", "description": "true to favorite, false to unfavorite." }
                },
                "required": ["song_id", "favorite"]
            }
        }),
        json!({
            "type": "function",
            "name": "create_apple_music_playlist",
            "description": "Makes a new playlist in the user's Apple Music library with these songs. The user confirms it on the phone first; if they cancel, say so and do not try again. Cadenza cannot delete it afterwards.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "The playlist's name, Title Case." },
                    "songs": songs.clone()
                },
                "required": ["name", "songs"]
            }
        }),
        json!({
            "type": "function",
            "name": "add_to_apple_music_playlist",
            "description": "Adds songs to the end of one of the user's Apple Music playlists. The user confirms it on the phone first; if they cancel, say so and do not try again. Cadenza cannot remove them afterwards.",
            "parameters": {
                "type": "object",
                "properties": {
                    "playlist_id": { "type": "string", "description": "From apple_music_playlists." },
                    "playlist_name": { "type": "string", "description": "Its name, shown when the user confirms." },
                    "songs": songs
                },
                "required": ["playlist_id", "playlist_name", "songs"]
            }
        }),
        json!({
            "type": "function",
            "name": "open_screen",
            "description": "Opens a screen in the app, closing the chat. Settings sheets need no id. tag takes a tag id, saved_query a saved query id, shared_playlist a shared playlist id, apple_music_playlist an id from apple_music_playlists, artist an artist id from now_playing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "screen": {
                        "type": "string",
                        "enum": ["account", "appearance", "apple_music", "listening_preferences", "privacy", "your_data", "tag", "saved_query", "shared_playlist", "apple_music_playlist", "artist"]
                    },
                    "id": { "type": "string" }
                },
                "required": ["screen"]
            }
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_phone_tool_has_a_definition_and_a_label() {
        let names: Vec<String> = definitions()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(names, PHONE_TOOLS);
        for name in PHONE_TOOLS {
            assert_ne!(label_for(name), "Tried a tool", "{name} has no label");
        }
    }

    #[test]
    fn card_songs_become_the_cards_ids() {
        let card = ["1".to_owned(), "2".to_owned()];
        let args =
            prepare_arguments("play", r#"{"songs":"card","shuffle":true}"#, Some(&card)).unwrap();
        assert_eq!(args, json!({ "songs": ["1", "2"], "shuffle": true }));
    }

    #[test]
    fn card_songs_without_a_card_are_the_models_to_fix() {
        assert!(prepare_arguments("play", r#"{"songs":"card"}"#, None).is_err());
        assert!(prepare_arguments("play", r#"{"songs":"card"}"#, Some(&[])).is_err());
        assert!(prepare_arguments("queue_songs", r#"{"songs":[]}"#, None).is_err());
        assert!(prepare_arguments("queue_songs", r#"{"songs":7}"#, None).is_err());
    }

    #[test]
    fn listed_songs_pass_and_are_capped() {
        let ids: Vec<String> = (0..MAX_CARD_SONGS + 5).map(|id| id.to_string()).collect();
        let args = prepare_arguments(
            "queue_songs",
            &json!({ "songs": ids, "position": "end" }).to_string(),
            None,
        )
        .unwrap();
        assert_eq!(args["songs"].as_array().unwrap().len(), MAX_CARD_SONGS);
    }

    #[test]
    fn a_playlist_plays_without_songs() {
        let args = prepare_arguments("play", r#"{"apple_music_playlist_id":"p.1"}"#, None).unwrap();
        assert_eq!(args["apple_music_playlist_id"], "p.1");
    }

    #[test]
    fn tools_without_songs_pass_through() {
        assert_eq!(
            prepare_arguments("playback", r#"{"action":"pause"}"#, None).unwrap(),
            json!({ "action": "pause" })
        );
        assert_eq!(
            prepare_arguments("now_playing", "", None).unwrap(),
            json!({})
        );
        assert!(prepare_arguments("now_playing", "[1]", None).is_err());
        assert!(prepare_arguments("now_playing", "{", None).is_err());
    }

    #[test]
    fn a_card_in_the_output_is_taken_out() {
        let mut output = json!({
            "found": 2,
            "card": { "song_ids": ["1", "2"], "total": 1, "title": "weeknd search." }
        });
        let card = take_card(&mut output).unwrap();
        assert_eq!(card.song_ids, ["1", "2"]);
        // never fewer than it holds
        assert_eq!(card.total, 2);
        // the title is cleaned like the server's own
        assert_eq!(card.title.as_deref(), Some("Weeknd Search"));
        assert_eq!(output, json!({ "found": 2 }));

        let mut empty = json!({ "card": { "song_ids": [], "total": 0 } });
        assert_eq!(take_card(&mut empty), None);
        assert_eq!(take_card(&mut json!({ "ok": true })), None);
    }
}
