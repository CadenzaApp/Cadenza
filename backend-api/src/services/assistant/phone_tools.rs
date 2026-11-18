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
    "apple_music_library",
    "favorite_song",
    "favorite_collection",
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
        "apple_music_library" => "Looked in your Apple Music library",
        "favorite_song" => "Updated a favorite",
        "favorite_collection" => "Updated a favorite",
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
    if matches!(name, "play" | "queue_songs") {
        keep_one_source(&mut args);
    }
    if name == "open_screen" {
        builder_mode_only_for_cadenza(&mut args)?;
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
        // a playlist, an album, or an artist by id needs no songs
        Value::Null
            if ["apple_music_playlist_id", "album_id", "artist_id"]
                .iter()
                .any(|key| args[*key].is_string())
                && matches!(name, "play" | "queue_songs") =>
        {
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

/// Keeps `open_screen`'s `mode` only for the Cadenza tab, where it picks the simple or the
/// advanced query builder. Anywhere else it means nothing, so it goes rather than reach the
/// phone. An empty one goes too.
fn builder_mode_only_for_cadenza(args: &mut Value) -> Result<(), String> {
    let Some(object) = args.as_object_mut() else {
        return Ok(());
    };
    let cadenza = object.get("screen").and_then(Value::as_str) == Some("cadenza");
    match object.get("mode") {
        None | Some(Value::Null) => {
            object.remove("mode");
        }
        Some(Value::String(mode)) if mode.trim().is_empty() || !cadenza => {
            object.remove("mode");
        }
        Some(Value::String(mode)) if mode == "simple" || mode == "advanced" => {}
        Some(_) => return Err("mode must be simple or advanced".to_owned()),
    }
    Ok(())
}

/// The ways `play` and `queue_songs` can name what to play, besides `songs`.
const OTHER_SOURCES: [&str; 3] = ["apple_music_playlist_id", "album_id", "artist_id"];

/// Leaves `play` or `queue_songs` one thing to play. The model sometimes fills every
/// optional field, with empty strings or with an id from somewhere else, and the phone would
/// take the first it finds. Empty ones go, and `songs`, when given, wins over the rest.
fn keep_one_source(args: &mut Value) {
    let Some(object) = args.as_object_mut() else {
        return;
    };
    for key in OTHER_SOURCES {
        let empty = match object.get(key) {
            Some(Value::String(id)) => id.trim().is_empty(),
            Some(Value::Null) => true,
            _ => false,
        };
        if empty {
            object.remove(key);
        }
    }
    let has_songs = match object.get("songs") {
        Some(Value::Array(ids)) => !ids.is_empty(),
        Some(Value::String(_)) => true,
        _ => false,
    };
    if has_songs {
        for key in OTHER_SOURCES {
            object.remove(key);
        }
    } else {
        object.remove("songs");
    }
}

/// Ids that must have come from a tool field of the same kind, as (field, id): an album
/// id from an `album_id`, an artist id from an `artist_id`. A song id passed as an album id
/// came from a tool too, so the plain check alone would let it through.
pub fn typed_ids_named(name: &str, args: &Value) -> Vec<(&'static str, String)> {
    let mut ids = Vec::new();
    match name {
        "play" | "queue_songs" => {
            for (key, field) in [("album_id", "album_id"), ("artist_id", "artist_id")] {
                if let Some(id) = id_value(&args[key]) {
                    ids.push((field, id));
                }
            }
        }
        "open_screen" => {
            let field = match args["screen"].as_str() {
                Some("album") => Some("album_id"),
                Some("artist") => Some("artist_id"),
                _ => None,
            };
            if let (Some(field), Some(id)) = (field, id_value(&args["id"])) {
                ids.push((field, id));
            }
        }
        "favorite_collection" if args["kind"] == "album" => {
            if let Some(id) = id_value(&args["id"]) {
                ids.push(("album_id", id));
            }
        }
        _ => {}
    }
    ids
}

/// The ids a phone tool call names, in its prepared arguments: every one must have come
/// from a tool result in this answer (or the user's tags in the prompt, or a card), never
/// from the model's memory. `"current"` (the song playing) is not an id.
pub fn ids_named(name: &str, args: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    let mut take = |key: &str| {
        if let Some(id) = id_value(&args[key]) {
            ids.push(id);
        }
    };
    match name {
        "open_screen" => take("id"),
        "play" | "queue_songs" => {
            take("apple_music_playlist_id");
            take("album_id");
            take("artist_id");
        }
        "favorite_song" => {
            if args["song_id"] != "current" {
                take("song_id");
            }
        }
        "favorite_collection" => take("id"),
        "apple_music_playlist_songs" | "add_to_apple_music_playlist" => take("playlist_id"),
        _ => {}
    }
    if let Some(songs) = args["songs"].as_array() {
        ids.extend(songs.iter().filter_map(id_value));
    }
    ids
}

/// An id as a string, from a JSON string or number.
pub fn id_value(value: &Value) -> Option<String> {
    match value {
        Value::String(id) if !id.trim().is_empty() => Some(id.trim().to_owned()),
        Value::Number(id) => Some(id.to_string()),
        _ => None,
    }
}

/// What the model is told when a phone call names an id no tool gave it.
pub fn unsourced_message(ids: &[String]) -> String {
    format!(
        "Not done: {} did not come from a tool result in this answer, so it may be wrong. Never use an id from memory or from an earlier answer. Look it up first (find_album for an album, find_artist for an artist, apple_music_playlists for an Apple Music playlist, list_saved_queries for a saved query, list_playlists for a shared playlist, now_playing for what is playing, or a song tool like find_songs or run_query for songs), then call this again with the id it returns.",
        ids.join(", ")
    )
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
            "description": "What is playing on the phone right now: the song (id, title, artist, album, artist id, album id), whether it is playing or paused, how far in, the next songs in the queue, and shuffle and repeat. Use for \"what is this song\", \"what's next\", or anything about \"this song\". Also says when playback is locked, like in a live session the user cannot control.",
            "parameters": { "type": "object", "properties": {} }
        }),
        json!({
            "type": "function",
            "name": "play",
            "description": "Plays songs now, replacing the queue: the songs on the card, a list of song ids, one of the user's Apple Music playlists, an album (all its tracks), or an artist (their top songs). Pass exactly one of songs, apple_music_playlist_id, album_id, or artist_id. To play a saved query or a shared playlist, get its songs as a card first. Shuffle shuffles the list itself.",
            "parameters": {
                "type": "object",
                "properties": {
                    "songs": songs.clone(),
                    "apple_music_playlist_id": { "type": "string", "description": "Instead of songs: an id from apple_music_playlists." },
                    "album_id": { "type": "string", "description": "Instead of songs: an album_id from find_album, now_playing, or find_songs." },
                    "artist_id": { "type": "string", "description": "Instead of songs: an artist_id from find_artist or now_playing; plays their top songs." },
                    "shuffle": { "type": "boolean", "description": "Play in a random order. Defaults to false." }
                }
            }
        }),
        json!({
            "type": "function",
            "name": "playback",
            "description": "Pause, resume, skip to the next or previous song, restart the current one, or clear the queue (clear_queue: keeps only the song playing now, at the same spot, and drops everything after it).",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["pause", "resume", "next", "previous", "restart", "clear_queue"] }
                },
                "required": ["action"]
            }
        }),
        json!({
            "type": "function",
            "name": "queue_songs",
            "description": "Adds songs to the queue without stopping what is playing: next (right after the current song) or at the end. Pass exactly one of songs, album_id (all its tracks), or artist_id (their top songs).",
            "parameters": {
                "type": "object",
                "properties": {
                    "songs": songs.clone(),
                    "album_id": { "type": "string" },
                    "artist_id": { "type": "string" },
                    "position": { "type": "string", "enum": ["next", "end"] }
                },
                "required": ["position"]
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
            "description": "A free-text search of the whole Apple Music catalog, run on the phone, for when the user asks to search for something. Returns songs with ids, title, artist, and album; they show as a card. For specific songs you can name yourself, use find_songs instead.",
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
            "description": "The songs in one of the user's own Apple Music playlists, in order, as a card. Only for an id from apple_music_playlists; never an album id (use get_album_songs for an album).",
            "parameters": {
                "type": "object",
                "properties": { "playlist_id": { "type": "string" } },
                "required": ["playlist_id"]
            }
        }),
        json!({
            "type": "function",
            "name": "apple_music_library",
            "description": "Reads the user's own Apple Music library on the phone, including songs Cadenza has not seen yet. recently_added: what they added lately, albums, playlists, and songs, newest first. search: songs in their library matching a term, to answer \"do I have X\". Songs show as a card.",
            "parameters": {
                "type": "object",
                "properties": {
                    "view": { "type": "string", "enum": ["recently_added", "search"] },
                    "term": { "type": "string", "description": "For search: a song title, artist, or album." },
                    "title": { "type": "string", "description": "The card's title, Title Case, 2 to 4 words, no period." }
                },
                "required": ["view"]
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
            "name": "favorite_collection",
            "description": "Favorites or unfavorites an album or an Apple Music playlist in Apple Music.",
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "enum": ["album", "apple_music_playlist"] },
                    "id": { "type": "string", "description": "An album_id (find_album, now_playing) or an Apple Music playlist id (apple_music_playlists)." },
                    "favorite": { "type": "boolean" }
                },
                "required": ["kind", "id", "favorite"]
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
            "description": "Opens a screen in the app, closing the chat. The tabs (social, analytics, cadenza, library, search; cadenza is the query builder, and mode picks simple or advanced), the settings sheets, now_playing (the player), song_tags (the player's Tags page for the song playing, where the user tags it), friends (friend requests and friends), notifications, and friends_listening (every friend listening now) need no id. analytics_ranking (a full Most Played list) and library_category (a Library section) take kind instead. Every other screen needs an id from a tool result in this conversation, never one you remember or guess: tag a tag id, saved_query an id from list_saved_queries, shared_playlist an id from list_playlists, apple_music_playlist an id from apple_music_playlists, artist an artist_id from find_artist or now_playing, album an album_id from find_album, now_playing, or find_songs, song_discussion (the posts about one song) a song_id from any tool.",
            "parameters": {
                "type": "object",
                "properties": {
                    "screen": {
                        "type": "string",
                        "enum": ["social", "analytics", "cadenza", "library", "search", "account", "appearance", "apple_music", "listening_preferences", "sharing", "privacy", "your_data", "now_playing", "song_tags", "friends", "notifications", "friends_listening", "analytics_ranking", "library_category", "tag", "saved_query", "shared_playlist", "apple_music_playlist", "artist", "album", "song_discussion"]
                    },
                    "id": { "type": "string" },
                    "kind": {
                        "type": "string",
                        "description": "For analytics_ranking: song, artist, album, playlist, query, shared_playlist, live_session, or tag. For library_category: playlist, artist, album, song, query, or tag."
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["simple", "advanced"],
                        "description": "For cadenza only: which query builder to show, when the user names one (\"open the advanced query builder\"). Leave out to keep the one the user had. Switching never changes their query."
                    }
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
    fn a_builder_mode_is_only_for_the_cadenza_tab() {
        let open = |args: &str| prepare_arguments("open_screen", args, None);
        assert_eq!(
            open(r#"{"screen":"cadenza","mode":"advanced"}"#).unwrap(),
            json!({ "screen": "cadenza", "mode": "advanced" })
        );
        assert_eq!(
            open(r#"{"screen":"library","mode":"advanced"}"#).unwrap(),
            json!({ "screen": "library" })
        );
        assert_eq!(
            open(r#"{"screen":"cadenza","mode":""}"#).unwrap(),
            json!({ "screen": "cadenza" })
        );
        assert!(open(r#"{"screen":"cadenza","mode":"fancy"}"#).is_err());
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
    fn a_playlist_album_or_artist_plays_without_songs() {
        let args = prepare_arguments("play", r#"{"apple_music_playlist_id":"p.1"}"#, None).unwrap();
        assert_eq!(args["apple_music_playlist_id"], "p.1");
        assert!(prepare_arguments("play", r#"{"album_id":"1440"}"#, None).is_ok());
        assert!(
            prepare_arguments("queue_songs", r#"{"artist_id":"9","position":"end"}"#, None).is_ok()
        );
        // one of them is still needed
        assert!(prepare_arguments("queue_songs", r#"{"position":"end"}"#, None).is_err());
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
    fn play_keeps_one_source() {
        // the model filled every field: the songs win, empty ids go
        let args = prepare_arguments(
            "play",
            r#"{"songs":["1","2"],"album_id":"1","apple_music_playlist_id":"","artist_id":"","shuffle":false}"#,
            None,
        )
        .unwrap();
        assert_eq!(args, json!({ "songs": ["1", "2"], "shuffle": false }));
        // no songs: the one real id stays
        let args = prepare_arguments(
            "play",
            r#"{"songs":[],"album_id":"9","artist_id":""}"#,
            None,
        )
        .unwrap();
        assert_eq!(args, json!({ "album_id": "9" }));
    }

    #[test]
    fn album_and_artist_ids_are_typed() {
        assert_eq!(
            typed_ids_named("open_screen", &json!({ "screen": "album", "id": "5" })),
            [("album_id", "5".to_owned())]
        );
        assert_eq!(
            typed_ids_named("play", &json!({ "artist_id": "7" })),
            [("artist_id", "7".to_owned())]
        );
        assert!(typed_ids_named("open_screen", &json!({ "screen": "tag", "id": "5" })).is_empty());
    }

    #[test]
    fn ids_named_cover_every_id_argument() {
        let ids = |name: &str, args: Value| ids_named(name, &args);
        assert_eq!(
            ids("open_screen", json!({ "screen": "album", "id": "1440" })),
            ["1440"]
        );
        assert!(ids("open_screen", json!({ "screen": "appearance" })).is_empty());
        assert_eq!(ids("play", json!({ "album_id": "9" })), ["9"]);
        assert_eq!(
            ids(
                "queue_songs",
                json!({ "songs": ["1", "2"], "position": "end" })
            ),
            ["1", "2"]
        );
        assert!(
            ids(
                "favorite_song",
                json!({ "song_id": "current", "favorite": true })
            )
            .is_empty()
        );
        assert_eq!(
            ids("favorite_collection", json!({ "kind": "album", "id": "7" })),
            ["7"]
        );
        assert_eq!(
            ids(
                "add_to_apple_music_playlist",
                json!({ "playlist_id": "p.1", "songs": ["3"] })
            ),
            ["p.1", "3"]
        );
        // a number counts the same as a string
        assert_eq!(
            ids("open_screen", json!({ "screen": "tag", "id": 12 })),
            ["12"]
        );
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
