//! `edit_card`: the model's way to change a song card rather than replace it. It starts
//! from the card under the last answer that showed one (or the card this answer has made
//! so far), adds songs from any tool result, removes songs, and becomes this answer's card:
//! "add 3 Sonic songs to it" keeps the query's songs and puts the three in.
//!
//! It runs in the tool loop rather than against the database, since it only needs the
//! cards the loop already holds and the ids its tools returned.

use std::collections::HashSet;

use serde::Deserialize;
use serde_json::{Value, json};

use super::tools::{MAX_CARD_SONGS, card_title};
use crate::routes::json::assistant::SongsCard;

pub const NAME: &str = "edit_card";
pub const LABEL: &str = "Updated the song card";

/// Which card an edit starts from.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
enum Start {
    /// The card under the last answer that showed one.
    #[default]
    Previous,
    /// The card this answer has made so far, like a find_songs result or an earlier edit.
    ThisAnswer,
    /// No songs: a card made only of what is added.
    Empty,
}

#[derive(Deserialize, Debug)]
struct EditArgs {
    #[serde(default)]
    from: Start,
    #[serde(default)]
    add: Vec<Value>,
    #[serde(default)]
    remove: Vec<Value>,
    /// Where the added songs go, as a 1-based position: 1 puts them first. Left out, they
    /// go at the end.
    #[serde(default)]
    position: Option<usize>,
    #[serde(default)]
    title: Option<String>,
}

/// What an edit made: the new card, and what the model reads back.
#[derive(Debug, PartialEq)]
pub struct Edited {
    pub card: Option<SongsCard>,
    pub output: Value,
}

fn ids_of(values: &[Value]) -> Vec<String> {
    values
        .iter()
        .filter_map(super::phone_tools::id_value)
        .collect()
}

/// Applies an `edit_card` call. `previous` is the last card shown before this answer,
/// `this_answer` the card this answer has so far, and `sourced` every id the model could
/// have read in this answer; an added id outside it is one the model made up and is left
/// out. The new card holds at most [`MAX_CARD_SONGS`], each song once, and carries no
/// query, since it is no longer what a query matched: opening it shows the songs as a list.
pub fn edit(
    arguments: &str,
    previous: &[String],
    this_answer: Option<&SongsCard>,
    sourced: &HashSet<String>,
) -> Edited {
    let args: EditArgs = match serde_json::from_str(if arguments.trim().is_empty() {
        "{}"
    } else {
        arguments
    }) {
        Ok(args) => args,
        Err(err) => {
            return Edited {
                card: None,
                output: json!({ "error": format!("the arguments are not valid: {err}") }),
            };
        }
    };

    let start: Vec<String> = match args.from {
        Start::Previous => previous.to_vec(),
        Start::ThisAnswer => this_answer
            .map(|card| card.song_ids.clone())
            .unwrap_or_default(),
        Start::Empty => Vec::new(),
    };
    if args.from == Start::Previous && start.is_empty() {
        return Edited {
            card: None,
            output: json!({ "error": "there is no earlier card to edit; find the songs first, or use from empty" }),
        };
    }
    if args.from == Start::ThisAnswer && this_answer.is_none() {
        return Edited {
            card: None,
            output: json!({ "error": "this answer has no card yet; use from previous for the card the user is looking at" }),
        };
    }

    let remove: HashSet<String> = ids_of(&args.remove).into_iter().collect();
    let not_on_card: Vec<&String> = remove.iter().filter(|id| !start.contains(id)).collect();
    let mut songs: Vec<String> = start
        .iter()
        .filter(|id| !remove.contains(*id))
        .cloned()
        .collect();
    let removed = start.len() - songs.len();

    let mut unsourced = Vec::new();
    let mut already = Vec::new();
    let mut added = Vec::new();
    for id in ids_of(&args.add) {
        if !sourced.contains(&id) {
            unsourced.push(id);
        } else if songs.contains(&id) || added.contains(&id) {
            already.push(id);
        } else {
            added.push(id);
        }
    }
    let at = args.position.map_or(songs.len(), |position| {
        position.saturating_sub(1).min(songs.len())
    });
    let added_count = added.len();
    songs.splice(at..at, added);
    let cut = songs.len().saturating_sub(MAX_CARD_SONGS);
    songs.truncate(MAX_CARD_SONGS);

    let mut output = json!({
        "total": songs.len(),
        "added": added_count,
        "removed": removed,
    });
    if !unsourced.is_empty() {
        output["not_added"] = json!({
            "ids": unsourced,
            "why": "no tool returned these ids in this answer, so they may be wrong; find the songs first (find_songs, run_query, search_apple_music) and add the ids it returns",
        });
    }
    if !already.is_empty() {
        output["already_on_card"] = json!(already);
    }
    if !not_on_card.is_empty() {
        output["not_on_card"] = json!(not_on_card);
    }
    if cut > 0 {
        output["cut"] = json!(format!(
            "a card holds {MAX_CARD_SONGS} songs, so the last {cut} were left off"
        ));
    }
    if songs.is_empty() {
        output["note"] = json!("the card is empty now, so no card shows");
        return Edited { card: None, output };
    }
    let title = card_title(args.title).or_else(|| this_answer.and_then(|card| card.title.clone()));
    Edited {
        card: Some(SongsCard {
            total: songs.len(),
            capped: false,
            song_ids: songs,
            title,
            query: None,
        }),
        output,
    }
}

/// The tool's definition, sent to the model with the others.
pub fn definition() -> Value {
    json!({
        "type": "function",
        "name": NAME,
        "description": "Changes a song card instead of replacing it: starts from the card the user is looking at (the last one shown) or the card this answer made so far, removes songs, and adds songs from any tool result in this answer. The result is this answer's card. Use it whenever the user asks to add songs to, take songs out of, or rearrange the songs they already have on screen (\"add 3 Sonic songs to it\", \"take out the Drake ones\", \"put these first\"). Get new songs with find_songs, run_query, or another song tool first, then call this with their ids.",
        "parameters": {
            "type": "object",
            "properties": {
                "from": {
                    "type": "string",
                    "enum": ["previous", "this_answer", "empty"],
                    "description": "previous (default): the card under the last answer that showed one, which is what the user means by \"it\", \"this list\", or \"those\". this_answer: the card this answer made so far, for a second edit. empty: only the added songs."
                },
                "add": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Song ids to add, each from a tool result in this answer (find_songs, run_query, search_apple_music, and so on). Songs already on the card are skipped."
                },
                "remove": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Song ids to take off, from the card's song list."
                },
                "position": {
                    "type": "integer",
                    "description": "Where the added songs go, 1-based: 1 puts them first. Leave out to add them at the end."
                },
                "title": {
                    "type": "string",
                    "description": "The list's new title when what it holds changed, Title Case, 2 to 4 words, like \"Chill Songs Plus Sonic\". Leave out to keep it."
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|id| id.to_string()).collect()
    }

    fn sourced(list: &[&str]) -> HashSet<String> {
        list.iter().map(|id| id.to_string()).collect()
    }

    fn card_of(list: &[&str]) -> SongsCard {
        SongsCard {
            song_ids: ids(list),
            total: list.len(),
            capped: false,
            title: Some("Sonic Songs".into()),
            query: None,
        }
    }

    #[test]
    fn adds_new_songs_to_the_card_the_user_is_looking_at() {
        let previous = ids(&["a", "b", "c"]);
        let found = card_of(&["s1", "s2", "s3"]);
        let edited = edit(
            r#"{"add":["s1","s2","s3"],"title":"Chill Plus Sonic"}"#,
            &previous,
            Some(&found),
            &sourced(&["a", "b", "c", "s1", "s2", "s3"]),
        );
        let card = edited.card.unwrap();
        assert_eq!(card.song_ids, ids(&["a", "b", "c", "s1", "s2", "s3"]));
        assert_eq!(card.total, 6);
        assert_eq!(card.title.as_deref(), Some("Chill Plus Sonic"));
        assert_eq!(card.query, None);
        assert_eq!(edited.output["added"], 3);
    }

    #[test]
    fn removes_and_inserts_at_a_position() {
        let previous = ids(&["a", "b", "c"]);
        let edited = edit(
            r#"{"remove":["b","zz"],"add":["x"],"position":1}"#,
            &previous,
            None,
            &sourced(&["a", "b", "c", "x"]),
        );
        assert_eq!(edited.card.unwrap().song_ids, ids(&["x", "a", "c"]));
        assert_eq!(edited.output["removed"], 1);
        assert_eq!(edited.output["not_on_card"], json!(["zz"]));
    }

    #[test]
    fn an_id_no_tool_returned_is_left_out() {
        let edited = edit(
            r#"{"add":["made-up","a"]}"#,
            &ids(&["a"]),
            None,
            &sourced(&["a"]),
        );
        assert_eq!(edited.card.unwrap().song_ids, ids(&["a"]));
        assert_eq!(edited.output["not_added"]["ids"], json!(["made-up"]));
        assert_eq!(edited.output["already_on_card"], json!(["a"]));
    }

    #[test]
    fn a_second_edit_starts_from_this_answers_card() {
        let this_answer = card_of(&["a", "s1"]);
        let edited = edit(
            r#"{"from":"this_answer","remove":["a"]}"#,
            &ids(&["a", "b"]),
            Some(&this_answer),
            &sourced(&["a", "b", "s1"]),
        );
        let card = edited.card.unwrap();
        assert_eq!(card.song_ids, ids(&["s1"]));
        // the title carries over when none is given
        assert_eq!(card.title.as_deref(), Some("Sonic Songs"));
    }

    #[test]
    fn editing_with_nothing_to_start_from_is_the_models_to_fix() {
        let none = HashSet::new();
        assert!(edit(r#"{}"#, &[], None, &none).output["error"].is_string());
        assert!(
            edit(r#"{"from":"this_answer"}"#, &ids(&["a"]), None, &none).output["error"]
                .is_string()
        );
        assert!(edit("not json", &ids(&["a"]), None, &none).output["error"].is_string());
    }

    #[test]
    fn a_card_never_holds_more_than_it_can_show() {
        let previous: Vec<String> = (0..MAX_CARD_SONGS).map(|i| i.to_string()).collect();
        let mut known: HashSet<String> = previous.iter().cloned().collect();
        known.insert("new".into());
        let edited = edit(r#"{"add":["new"]}"#, &previous, None, &known);
        assert_eq!(edited.card.unwrap().song_ids.len(), MAX_CARD_SONGS);
        assert!(edited.output["cut"].is_string());
    }

    #[test]
    fn removing_every_song_shows_no_card() {
        let edited = edit(r#"{"remove":["a"]}"#, &ids(&["a"]), None, &sourced(&["a"]));
        assert_eq!(edited.card, None);
        assert_eq!(edited.output["total"], 0);
    }
}
