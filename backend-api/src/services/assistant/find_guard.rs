//! Memory first, then browsing to fill, and a short card that explains itself.
//!
//! Songs the model names from memory come first (`find_songs`), since those are the most
//! relevant. What Apple Music does not have is filled from songs it does have
//! (`browse_apple_music`, then `edit_card`). An answer gets [`MAX_SEARCH_CALLS`] searches
//! of either kind. A `find_songs` retry is only for names corrected from Apple's close
//! matches (`apple_music_has`) and searches that failed: a name that already came back not
//! found is left out, a new guess is left out (browsing fills instead), and a retry with
//! nothing left to search is refused. Everything is read back from the answer's own calls
//! and outputs, so it holds across a phone tool's round trip without extra state.
//!
//! When the answer's card is built on the last `find_songs` result and holds fewer songs
//! than the user asked for, the reply must say why: Apple Music had fewer, or one card holds
//! at most 25. The tool output asks the model to say so; [`explain_shortfall`] adds the
//! sentence when the reply did not.

use std::collections::HashSet;

use serde_json::{Value, json};

use super::tools::{MAX_FIND_COUNT, match_key};

pub const FIND_SONGS: &str = "find_songs";
pub const BROWSE: &str = "browse_apple_music";
/// Searches an answer may make, `find_songs` and `browse_apple_music` together: the first
/// try from memory, a fix, and a browse to fill.
pub const MAX_SEARCH_CALLS: usize = 3;

/// What this answer's earlier searches did.
#[derive(Debug, Default)]
pub struct FindHistory {
    /// `find_songs` and `browse_apple_music` calls that have an output.
    pub calls: usize,
    /// The `find_songs` ones.
    pub find_calls: usize,
    /// Names Apple Music did not have, as [`key`]s.
    missed: HashSet<String>,
    /// Names whose search failed, worth another try.
    failed: HashSet<String>,
    /// Names Apple Music offered for a miss (`apple_music_has`): corrections to try.
    suggested: HashSet<String>,
    /// Every name searched.
    tried: HashSet<String>,
    /// The last `find_songs` call's count, for the reply.
    pub last: Option<FindResult>,
}

/// One `find_songs` call's result, as the reply needs it.
#[derive(Clone, Debug, PartialEq)]
pub struct FindResult {
    pub asked_for: usize,
    /// The songs it found, which the answer's card keeps.
    pub song_ids: Vec<String>,
}

/// A song name as one comparable string, title and artist.
fn key(title: &str, artist: Option<&str>) -> String {
    format!(
        "{}|{}",
        match_key(title),
        artist.map(match_key).unwrap_or_default()
    )
}

fn named(song: &Value) -> Option<String> {
    let title = song["title"].as_str()?;
    Some(key(title, song["artist"].as_str()))
}

/// Reads this answer's searches out of its items.
pub fn history(items: &[Value]) -> FindHistory {
    let mut history = FindHistory::default();
    let searches = items.iter().filter(|item| {
        item["type"] == "function_call"
            && matches!(item["name"].as_str(), Some(FIND_SONGS | BROWSE))
    });
    for call in searches {
        let Some(output) = items
            .iter()
            .find(|item| {
                item["type"] == "function_call_output" && item["call_id"] == call["call_id"]
            })
            .and_then(|item| item["output"].as_str())
            .and_then(|output| serde_json::from_str::<Value>(output).ok())
        else {
            continue;
        };
        history.calls += 1;
        if call["name"] == BROWSE {
            continue;
        }
        history.find_calls += 1;
        let arguments: Value = call["arguments"]
            .as_str()
            .and_then(|arguments| serde_json::from_str(arguments).ok())
            .unwrap_or_default();
        if let Some(songs) = arguments["songs"].as_array() {
            history.tried.extend(songs.iter().filter_map(named));
        }
        if let Some(missing) = output["not_found"].as_array() {
            history.missed.extend(missing.iter().filter_map(named));
            for close in missing
                .iter()
                .filter_map(|song| song["apple_music_has"].as_array())
            {
                history.suggested.extend(close.iter().filter_map(named));
            }
        }
        if let Some(failed) = output["lookup_failed"].as_array() {
            history.failed.extend(failed.iter().filter_map(named));
        }
        history.last = output["asked_for"].as_u64().map(|asked_for| FindResult {
            asked_for: asked_for as usize,
            song_ids: output["songs"]
                .as_array()
                .map(|songs| {
                    songs
                        .iter()
                        .filter_map(|song| song["song_id"].as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default(),
        });
    }
    history
}

/// A search call, checked against the answer's earlier ones.
#[derive(Debug, PartialEq)]
pub enum Prepared {
    /// Run it with these arguments, which leave out `skipped` names that already missed
    /// and `guesses` new names a retry may not try.
    Run {
        arguments: String,
        skipped: usize,
        guesses: usize,
    },
    /// Do not run it; give the model this output instead.
    Refuse(Value),
}

fn run_as_sent(arguments: &str) -> Prepared {
    Prepared::Run {
        arguments: arguments.to_owned(),
        skipped: 0,
        guesses: 0,
    }
}

/// Checks a `find_songs` or `browse_apple_music` call before it runs: at most
/// [`MAX_SEARCH_CALLS`] in an answer, and a `find_songs` retry keeps only the songs it
/// already found, names corrected from `apple_music_has`, and searches that failed.
pub fn prepare(name: &str, arguments: &str, history: &FindHistory) -> Prepared {
    if history.calls >= MAX_SEARCH_CALLS {
        return Prepared::Refuse(json!({
            "error": format!("This answer already searched {MAX_SEARCH_CALLS} times, the most it may. Do not search again. Show what you have and say how many you found of how many the user asked for."),
        }));
    }
    if name != FIND_SONGS || history.find_calls == 0 {
        return run_as_sent(arguments);
    }
    let Ok(mut arguments_json) = serde_json::from_str::<Value>(arguments) else {
        return run_as_sent(arguments);
    };
    let Some(songs) = arguments_json["songs"].as_array().cloned() else {
        return run_as_sent(arguments);
    };
    let mut skipped = 0;
    let mut guesses = 0;
    let mut searches_left = false;
    let mut kept: Vec<Value> = Vec::new();
    for song in songs {
        let Some(name) = named(&song) else {
            kept.push(song);
            continue;
        };
        if history.missed.contains(&name) {
            skipped += 1;
        } else if history.suggested.contains(&name) || history.failed.contains(&name) {
            searches_left = true;
            kept.push(song);
        } else if history.tried.contains(&name) {
            // found already: kept so the card keeps it
            kept.push(song);
        } else {
            guesses += 1;
        }
    }
    if !searches_left {
        return Prepared::Refuse(json!({
            "error": "A find_songs retry is only for titles corrected exactly as apple_music_has shows them, and for lookup_failed songs; this one has none, and names that missed already are left out. To fill the rest, call browse_apple_music and pick songs that fit from what Apple Music has.",
        }));
    }
    if skipped == 0 && guesses == 0 {
        return run_as_sent(arguments);
    }
    arguments_json["songs"] = Value::from(kept);
    Prepared::Run {
        arguments: arguments_json.to_string(),
        skipped,
        guesses,
    }
}

/// How many songs one card can show of `asked_for`.
pub fn wanted_on_card(asked_for: usize) -> usize {
    asked_for.min(MAX_FIND_COUNT)
}

/// What the reply must tell the user when a card of `shown` songs is short of the
/// `asked_for` the user wanted, or None when it is not.
pub fn shortfall_sentence(asked_for: usize, shown: usize) -> Option<String> {
    if shown >= asked_for {
        None
    } else if shown >= MAX_FIND_COUNT {
        Some(format!(
            "One list holds at most {MAX_FIND_COUNT} songs, so here are {shown} of the {asked_for} you asked for."
        ))
    } else if shown == 0 {
        Some("I couldn't find any of those songs on Apple Music.".to_owned())
    } else {
        Some(format!(
            "I could only find {shown} of the {asked_for} songs you asked for on Apple Music, so these are the most I could find."
        ))
    }
}

const NUMBER_WORDS: [&str; 26] = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
    "twenty-one",
    "twenty-two",
    "twenty-three",
    "twenty-four",
    "twenty-five",
];

/// Whether `text` says `n`, in digits or, up to 25, in words.
fn mentions_number(text: &str, n: usize) -> bool {
    let digits = n.to_string();
    let word = NUMBER_WORDS.get(n).copied();
    text.to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || c == '-'))
        .any(|token| token == digits || Some(token) == word)
}

/// `text` with the shortfall sentence added when the answer's card is built on the last
/// `find_songs` result (every song it found is on the card, with or without browsed songs
/// added), holds fewer songs than the user asked for, and the reply does not already say
/// how many it found of how many asked.
pub fn explain_shortfall(text: &str, history: &FindHistory, card: Option<&[String]>) -> String {
    let Some(result) = &history.last else {
        return text.to_owned();
    };
    let card = card.unwrap_or_default();
    if !result.song_ids.iter().all(|id| card.contains(id)) {
        // the answer moved on from that card, like an edit that took songs off
        return text.to_owned();
    }
    let shown = card.len();
    let Some(sentence) = shortfall_sentence(result.asked_for, shown) else {
        return text.to_owned();
    };
    let lowered = text.to_lowercase();
    let explained = if shown == 0 {
        [
            "couldn't",
            "could not",
            "can't",
            "cannot",
            "wasn't able",
            "unable",
            "no luck",
        ]
        .iter()
        .any(|phrase| lowered.contains(phrase))
    } else {
        mentions_number(text, shown) && mentions_number(text, result.asked_for)
    };
    if explained {
        return text.to_owned();
    }
    let text = text.trim_end();
    if text.is_empty() {
        sentence
    } else {
        format!("{text} {sentence}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(id: &str, name: &str, arguments: Value) -> Value {
        json!({
            "type": "function_call",
            "call_id": id,
            "name": name,
            "arguments": arguments.to_string(),
        })
    }

    fn output(id: &str, output: Value) -> Value {
        json!({ "type": "function_call_output", "call_id": id, "output": output.to_string() })
    }

    fn song(title: &str, artist: &str) -> Value {
        json!({ "title": title, "artist": artist })
    }

    fn first_try() -> Vec<Value> {
        vec![
            call(
                "c1",
                FIND_SONGS,
                json!({
                    "count": 10,
                    "songs": [
                        song("Pokémon Theme", "Jason Paige"),
                        song("Route 1", "Junichi Masuda"),
                        song("Lavender Town", "Junichi Masuda"),
                    ],
                }),
            ),
            output(
                "c1",
                json!({
                    "found": 1,
                    "asked_for": 10,
                    "outcome": "short",
                    "songs": [{ "song_id": "1", "title": "Pokémon Theme", "artist": "Jason Paige" }],
                    "not_found": [{
                        "title": "Route 1",
                        "artist": "Junichi Masuda",
                        "apple_music_has": [{ "title": "Route 1", "artist": "GAME FREAK", "album": "Pokémon Red" }],
                    }],
                    "lookup_failed": [{ "title": "Lavender Town", "artist": "Junichi Masuda" }],
                }),
            ),
        ]
    }

    fn retry(songs: Value) -> String {
        json!({ "count": 10, "songs": songs }).to_string()
    }

    #[test]
    fn a_retry_keeps_found_songs_corrections_and_failures_only() {
        let history = history(&first_try());
        assert_eq!((history.calls, history.find_calls), (1, 1));
        let sent = retry(json!([
            song("Pokémon Theme", "Jason Paige"),
            song("Route 1", "Junichi Masuda"),
            song("Route 1", "GAME FREAK"),
            song("Lavender Town", "Junichi Masuda"),
            song("A New Guess", "Someone"),
        ]));
        let Prepared::Run {
            arguments,
            skipped,
            guesses,
        } = prepare(FIND_SONGS, &sent, &history)
        else {
            panic!("a correction is worth a retry");
        };
        assert_eq!((skipped, guesses), (1, 1));
        let sent: Value = serde_json::from_str(&arguments).unwrap();
        let artists: Vec<&str> = sent["songs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|song| song["artist"].as_str().unwrap())
            .collect();
        assert_eq!(artists, ["Jason Paige", "GAME FREAK", "Junichi Masuda"]);
        assert_eq!(sent["count"], 10);
    }

    #[test]
    fn a_retry_of_only_guesses_is_sent_to_browse() {
        let history = history(&first_try());
        let sent = retry(json!([
            song("Pokémon Theme", "Jason Paige"),
            song("New", "Guess")
        ]));
        let Prepared::Refuse(output) = prepare(FIND_SONGS, &sent, &history) else {
            panic!("guesses go to browse_apple_music");
        };
        assert!(
            output["error"]
                .as_str()
                .unwrap()
                .contains("browse_apple_music")
        );
    }

    #[test]
    fn three_searches_is_the_most() {
        let mut items = first_try();
        items.push(call("c2", BROWSE, json!({ "terms": ["pokemon"] })));
        items.push(output("c2", json!({ "candidates": [] })));
        items.push(call("c3", BROWSE, json!({ "terms": ["pokemon theme"] })));
        items.push(output("c3", json!({ "candidates": [] })));
        let history = history(&items);
        assert_eq!((history.calls, history.find_calls), (3, 1));
        assert!(matches!(
            prepare(BROWSE, &json!({ "terms": ["x"] }).to_string(), &history),
            Prepared::Refuse(_)
        ));
        // the last find_songs result still counts after browsing
        assert_eq!(history.last.unwrap().asked_for, 10);
    }

    #[test]
    fn the_first_call_and_browsing_run_as_sent() {
        let arguments = json!({ "songs": [song("A", "B")] }).to_string();
        assert_eq!(
            prepare(FIND_SONGS, &arguments, &FindHistory::default()),
            run_as_sent(&arguments)
        );
        let browse = json!({ "terms": ["pokemon"] }).to_string();
        assert_eq!(
            prepare(BROWSE, &browse, &history(&first_try())),
            run_as_sent(&browse)
        );
    }

    fn found(asked_for: usize, found: usize) -> FindHistory {
        FindHistory {
            calls: 1,
            find_calls: 1,
            last: Some(FindResult {
                asked_for,
                song_ids: ids(found),
            }),
            ..FindHistory::default()
        }
    }

    fn ids(n: usize) -> Vec<String> {
        (0..n).map(|i| i.to_string()).collect()
    }

    #[test]
    fn a_silent_short_reply_gets_the_reason() {
        let history = found(10, 3);
        let card = ids(3);
        assert_eq!(
            explain_shortfall("Here are some Pokémon songs.", &history, Some(&card)),
            "Here are some Pokémon songs. I could only find 3 of the 10 songs you asked for on Apple Music, so these are the most I could find."
        );
        let said = "I could only find three of the 10 Pokémon songs on Apple Music.";
        assert_eq!(explain_shortfall(said, &history, Some(&card)), said);
    }

    #[test]
    fn browsed_songs_count_toward_the_card() {
        let history = found(10, 3);
        let filled = ids(7);
        assert!(explain_shortfall("Here.", &history, Some(&filled)).contains("7 of the 10"));
        let full = ids(10);
        assert_eq!(explain_shortfall("Here.", &history, Some(&full)), "Here.");
    }

    #[test]
    fn a_full_card_of_a_bigger_ask_says_the_limit() {
        let history = found(100, 25);
        let card = ids(25);
        assert_eq!(
            explain_shortfall("Here are some anime songs.", &history, Some(&card)),
            "Here are some anime songs. One list holds at most 25 songs, so here are 25 of the 100 you asked for."
        );
    }

    #[test]
    fn nothing_is_added_when_the_answer_moved_on_from_the_card() {
        let history = found(10, 3);
        let other = vec!["9".to_owned(), "8".to_owned()];
        assert_eq!(explain_shortfall("Here.", &history, Some(&other)), "Here.");
    }

    #[test]
    fn nothing_found_says_so() {
        let history = found(5, 0);
        assert_eq!(
            explain_shortfall("", &history, None),
            "I couldn't find any of those songs on Apple Music."
        );
        let said = "I couldn't find any of those on Apple Music.";
        assert_eq!(explain_shortfall(said, &history, None), said);
    }
}
