use crate::services::tag_generation::{
    MAX_COMBINED_SONG_DESC_LENGTH, TagGenerationError, TagGenerator, TagSpecs,
};
use crate::services::tag_normalizer::normalize_tag_name;
use dotenvy::dotenv;
use reqwest::{Client, StatusCode, header::HeaderMap};
use sea_orm::prelude::async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::env;
use std::time::Duration;
use uuid::Uuid;

const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_HTTP_TIMEOUT_SECS: u64 = 60;
const OPENAI_MODEL: &str = "gpt-4o-mini";
const TAG_GENERATION_SYSTEM_PROMPT: &str = r#"Generate one word music tags for each given song. Prefer tags that describe the song's genre or sound (e.g. pop, metal, instrumental). Return one entry per input song, copying that song's description back exactly in `song` alongside its tags, so tags are never matched to the wrong song. Generate `requested_tag_count` tags per song. Give every tag a six-digit `#RRGGBB` color. Cadenza replaces the color with one from its accessible tag palette, so the exact color you provide is not important."#;

/// Curated colors in hue order, followed by brown and gray. Each has at least
/// 4.5:1 contrast against its preferred black or white foreground.
const SUGGESTED_TAG_COLORS: &[&str] = &[
    "#b01843", "#f22933", "#ee5300", "#dc8f00", "#6f9808", "#00a446", "#00907f", "#0092b4",
    "#2061f1", "#6d35d5", "#ae6ff1", "#dd34e5", "#f83ca0", "#8c5939", "#6b7281",
];

/// A header's value as a string, when it is there and is not binary.
fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name)?.to_str().ok()
}

/// Parses one of OpenAI's rate limit reset headers, which are written as
/// concatenated value and unit parts: `1s`, `88ms`, `6m0s`, `1h2m3s`.
///
/// Returns `None` for anything that does not parse, including a bare number, since a
/// reset window with no unit is not a shape OpenAI sends.
fn parse_reset_duration(value: &str) -> Option<Duration> {
    let mut rest = value.trim();
    if rest.is_empty() {
        return None;
    }

    let mut total = Duration::ZERO;
    while !rest.is_empty() {
        // the number, which openai can write with a decimal point
        let unit_start = rest.find(|c: char| !c.is_ascii_digit() && c != '.')?;
        let (number, after) = rest.split_at(unit_start);
        let number: f64 = number.parse().ok()?;

        // longest unit first, so `ms` is never read as `m` with a stray `s` after it
        let (secs_per_unit, unit_len) = match after {
            _ if after.starts_with("ms") => (0.001, 2),
            _ if after.starts_with('h') => (3600.0, 1),
            _ if after.starts_with('m') => (60.0, 1),
            _ if after.starts_with('s') => (1.0, 1),
            _ => return None,
        };

        total += Duration::try_from_secs_f64(number * secs_per_unit).ok()?;
        rest = &after[unit_len..];
    }

    Some(total)
}

/// How long OpenAI's headers say to wait before asking again, when they say anything.
///
/// `retry-after` is plain seconds and wins when it is there. Otherwise the two reset
/// headers say when each bucket refills, and the longer of the two is when both are
/// usable again. A response carrying none of them gives `None`, which means rate
/// limited with no stated wait rather than not rate limited.
fn rate_limit_wait(headers: &HeaderMap) -> Option<Duration> {
    if let Some(secs) =
        header_str(headers, "retry-after").and_then(|value| value.trim().parse::<u64>().ok())
    {
        return Some(Duration::from_secs(secs));
    }

    let requests = header_str(headers, "x-ratelimit-reset-requests").and_then(parse_reset_duration);
    let tokens = header_str(headers, "x-ratelimit-reset-tokens").and_then(parse_reset_duration);
    requests.max(tokens)
}

/** Chooses an accessible color for one suggested tag. */
fn random_suggested_tag_color() -> String {
    let index = (Uuid::new_v4().as_u128() % SUGGESTED_TAG_COLORS.len() as u128) as usize;
    SUGGESTED_TAG_COLORS[index].to_owned()
}

fn get_tag_generation_req_body(song_descs: &[String], requested_tag_count: usize) -> Value {
    // serde does the quoting and escaping, so a comma or a quote inside a title
    // cannot split one song into two entries
    let user_content = json!({
        "songs": song_descs,
        "requested_tag_count": requested_tag_count,
    })
    .to_string();

    json!({
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "developer",
                "content": TAG_GENERATION_SYSTEM_PROMPT
            },
            {
                "role": "user",
                "content": user_content
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "tags_schema",
                "strict": true,
                "schema": {
                    "type": "object",
                    "required": ["tags"],
                    "additionalProperties": false,
                    "properties": {
                        "tags": {
                            "type": "array",
                            "description": "one entry per input song, each echoing that song's description",
                            "items": {
                                "type": "object",
                                "required": ["song", "tags"],
                                "additionalProperties": false,
                                "properties": {
                                    "song": {
                                        "type": "string",
                                        "description": "the input song description these tags belong to, copied exactly"
                                    },
                                    "tags": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "required": ["name", "color"],
                                            "additionalProperties": false,
                                            "properties": {
                                                "name": { "type": "string" },
                                                "color": {
                                                    "type": "string",
                                                    "description": "#RRGGBB hex color reflecting the tag's mood"
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    })
}

// models for OpenAI API response, struct names match what they're called in the docs
// https://developers.openai.com/api/reference/resources/responses/methods/create
#[derive(Deserialize)]
struct OpenAiApiResponse {
    error: Option<ResponseError>,
    output: Vec<ResponseOutputMessage>,
}
impl OpenAiApiResponse {
    pub fn into_text(mut self) -> Result<String, String> {
        if let Some(error) = self.error {
            return Err(error.message);
        }
        if self.output.is_empty() {
            return Err("openai returned empty response".into());
        }

        // serde already unescaped this field while parsing the response, so any
        // `\"` still in it belongs to the payload's own json, around a title or
        // a tag carrying a quote. Unescaping again would break that json.
        Ok(self.output.remove(0).content.remove(0).text)
    }
}
#[derive(Deserialize)]
struct ResponseError {
    message: String,
}
#[derive(Deserialize)]
struct ResponseOutputMessage {
    content: Vec<ResponseOutputText>,
}
#[derive(Deserialize)]
struct ResponseOutputText {
    text: String,
}

/// one song's tags, tied back to its song by the description the model echoes
#[derive(Deserialize)]
struct SongTags {
    /// the input description these tags are for, copied back by the model
    song: String,
    tags: Vec<TagSpecs>,
}

/// the key a description is matched by, so a description echoed back with different casing
/// or spacing still lands on the right song
fn desc_match_key(desc: &str) -> String {
    desc.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// the reply the json schema asks for: one entry per song, each tag carrying its own color
#[derive(Deserialize)]
struct OpenAiGeneratedTags {
    tags: Vec<SongTags>,
}

/// Cleans up the model's tags and returns exactly one list per input song, in input order.
///
/// Each entry goes to the song whose description it echoes, so a song the model skipped, repeated,
/// or answered out of order leaves an empty list instead of shifting every later song onto the
/// wrong tags. Two songs sharing a description get the same tags. Keeps at most
/// `requested_tag_count` tags per song, normalizes every name, gives each one a random accessible
/// palette color, and gives every copy of one name the first color it got anywhere in the reply.
fn to_tag_specs(
    generated_tags: Vec<SongTags>,
    song_descs: &[String],
    requested_tag_count: usize,
) -> Vec<Vec<TagSpecs>> {
    // every input position each description sits at, so a description shared by more than
    // one song fills all of them
    let mut desc_to_indices: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, desc) in song_descs.iter().enumerate() {
        desc_to_indices
            .entry(desc_match_key(desc))
            .or_default()
            .push(index);
    }

    // one slot per input song, left empty for any song the model did not answer for
    let mut songs_tags: Vec<Vec<TagSpecs>> = vec![Vec::new(); song_descs.len()];
    let mut answered = vec![false; song_descs.len()];

    // Drop tags past the requested count. Model colors are never used, so every
    // suggested tag stays within Cadenza's accessible Oklch color range.
    for song in generated_tags {
        // a description matching no input song belongs in no slot
        let Some(indices) = desc_to_indices.get(&desc_match_key(&song.song)) else {
            continue;
        };

        let tags: Vec<TagSpecs> = song
            .tags
            .into_iter()
            .take(requested_tag_count)
            .map(|tag| TagSpecs {
                name: normalize_tag_name(&tag.name),
                color: random_suggested_tag_color(),
            })
            .collect();

        // a second entry for a description already answered is dropped
        for &index in indices {
            if answered[index] {
                continue;
            }
            answered[index] = true;
            songs_tags[index] = tags.clone();
        }
    }

    // The first generated color each name got, so one name is one color across the whole reply.
    let mut name_to_color: HashMap<String, String> = HashMap::new();
    for tag in songs_tags.iter().flatten() {
        name_to_color
            .entry(tag.name.clone())
            .or_insert_with(|| tag.color.clone());
    }

    // Give each tag its name's color.
    songs_tags
        .into_iter()
        .map(|tags| {
            tags.into_iter()
                .map(|TagSpecs { name, color }| {
                    let color = name_to_color.get(&name).cloned().unwrap_or(color);
                    TagSpecs { name, color }
                })
                .collect()
        })
        .collect()
}

#[derive(Clone)]
pub struct OpenAiTagGenerator {
    api_key: String,
    http_client: Client,
}
impl OpenAiTagGenerator {
    pub fn new() -> Self {
        dotenv().unwrap();

        Self {
            api_key: env::var("OPENAI_API_KEY").expect("error getting OPENAI_API_KEY env var"),
            http_client: Client::builder()
                .timeout(Duration::from_secs(OPENAI_HTTP_TIMEOUT_SECS))
                .build()
                .expect("failed to build http client for OpenAiTagGenerator"),
        }
    }
}

#[async_trait]
impl TagGenerator for OpenAiTagGenerator {
    async fn generate_tags(
        &self,
        song_descs: &[String],
        requested_tag_count: usize,
    ) -> Result<Vec<Vec<TagSpecs>>, TagGenerationError> {
        if song_descs.is_empty() {
            return Ok(vec![]);
        }

        if requested_tag_count == 0 {
            return Ok(song_descs.iter().map(|_| vec![]).collect());
        }

        if song_descs.iter().map(|s| s.len()).sum::<usize>() > MAX_COMBINED_SONG_DESC_LENGTH {
            return Err("song descriptions are too long!".into());
        }

        let resp = self
            .http_client
            .post(OPENAI_RESPONSES_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&get_tag_generation_req_body(
                song_descs,
                requested_tag_count,
            ))
            .send()
            .await
            .map_err(|err| format!("request to openai failed: {}", err))?;

        // checked before the body, because a 429 body has no `output` and would come
        // back as a parse failure rather than as the rate limit it is
        if resp.status() == StatusCode::TOO_MANY_REQUESTS {
            return Err(TagGenerationError::RateLimited {
                retry_after: rate_limit_wait(resp.headers()),
            });
        }

        let resp_text = resp
            .json::<OpenAiApiResponse>()
            .await
            .map_err(|err| format!("openai returned malformed response: {}", err))?
            .into_text()?;

        let generated_tags: OpenAiGeneratedTags =
            serde_json::from_str(&resp_text).map_err(|e| e.to_string())?;

        Ok(to_tag_specs(
            generated_tags.tags,
            song_descs,
            requested_tag_count,
        ))
    }
}

// ---------------------------------------------------------------------------------------------
// These tests call the OpenAI API and use tokens! Use `cargo test -- --ignored` to run them.
// Last ran: Sep 16
// ---------------------------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::string_of_length;
    use reqwest::header::{HeaderName, HeaderValue};

    /// true if `color` is a lowercase `#rrggbb` hex color
    fn is_normalized_hex_color(color: &str) -> bool {
        color.len() == 7
            && color.starts_with('#')
            && color[1..]
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    }

    // ----- suggested colors, no api calls -----

    #[test]
    fn random_suggested_colors_always_come_from_the_accessible_palette() {
        for _ in 0..100 {
            let color = random_suggested_tag_color();
            assert!(SUGGESTED_TAG_COLORS.contains(&color.as_str()));
            assert!(is_normalized_hex_color(&color));
        }
    }

    // ----- rate limit headers, no api calls -----

    /// the headers of a 429, built from name and value pairs
    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs {
            headers.insert(
                HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        headers
    }

    #[test]
    fn parse_reset_duration_reads_openais_unit_format() {
        assert_eq!(parse_reset_duration("1s"), Some(Duration::from_secs(1)));
        assert_eq!(parse_reset_duration("6m0s"), Some(Duration::from_secs(360)));
        assert_eq!(
            parse_reset_duration("1h2m3s"),
            Some(Duration::from_secs(3723))
        );
        assert_eq!(parse_reset_duration(" 30s "), Some(Duration::from_secs(30)));
    }

    /// `ms` has to win over `m`, or an 88 millisecond wait reads as 88 minutes
    #[test]
    fn parse_reset_duration_does_not_read_ms_as_minutes() {
        assert_eq!(
            parse_reset_duration("88ms"),
            Some(Duration::from_millis(88))
        );
        assert_eq!(
            parse_reset_duration("1m500ms"),
            Some(Duration::from_millis(60_500))
        );
    }

    #[test]
    fn parse_reset_duration_rejects_what_it_cannot_read() {
        // a bare number has no unit, and the rest are not shapes openai sends
        for bad in ["", "   ", "30", "soon", "1d", "s", "1x", "1s2"] {
            assert_eq!(parse_reset_duration(bad), None, "expected None for {bad:?}");
        }
    }

    #[test]
    fn rate_limit_wait_prefers_retry_after() {
        let wait = rate_limit_wait(&headers(&[
            ("retry-after", "12"),
            ("x-ratelimit-reset-requests", "5m"),
        ]));

        assert_eq!(wait, Some(Duration::from_secs(12)));
    }

    /// both buckets have to refill before the next call can work, so the longer wait wins
    #[test]
    fn rate_limit_wait_takes_the_longer_reset_window() {
        let wait = rate_limit_wait(&headers(&[
            ("x-ratelimit-reset-requests", "2s"),
            ("x-ratelimit-reset-tokens", "6m0s"),
        ]));

        assert_eq!(wait, Some(Duration::from_secs(360)));
    }

    /// a rate limit with nothing readable about the wait is still a rate limit. the
    /// caller decides how long to stand down
    #[test]
    fn rate_limit_wait_is_none_when_the_headers_say_nothing() {
        assert_eq!(rate_limit_wait(&headers(&[])), None);
        assert_eq!(
            rate_limit_wait(&headers(&[("x-ratelimit-reset-requests", "whenever")])),
            None
        );
    }

    // ----- to_tag_specs, no api calls -----

    /// a tag as the model might return it, before any cleanup
    fn raw_tag(name: &str, color: &str) -> TagSpecs {
        TagSpecs {
            name: name.into(),
            color: color.into(),
        }
    }

    /// one song's reply as the model might return it, before any cleanup
    fn raw_song(song: &str, tags: Vec<TagSpecs>) -> SongTags {
        SongTags {
            song: song.into(),
            tags,
        }
    }

    /// the input descriptions a test batch was built from
    fn descs(descs: &[&str]) -> Vec<String> {
        descs.iter().map(|desc| (*desc).to_owned()).collect()
    }

    #[test]
    fn to_tag_specs_reads_the_schema_shape() {
        // a reply in the shape the json schema asks for
        let reply = r##"{"tags": [{"song": "Bad Guy by Billie Eilish", "tags": [{"name": "Pop", "color": "#FF6F61"}]}, {"song": "One by Metallica", "tags": [{"name": "metal", "color": "#000000"}]}]}"##;
        let generated: OpenAiGeneratedTags = serde_json::from_str(reply).unwrap();

        let res = to_tag_specs(
            generated.tags,
            &descs(&["Bad Guy by Billie Eilish", "One by Metallica"]),
            10,
        );

        assert_eq!(res.len(), 2);
        assert_eq!(res[0][0].name, "pop");
        assert_eq!(res[1][0].name, "metal");
        assert!(SUGGESTED_TAG_COLORS.contains(&res[0][0].color.as_str()));
        assert!(SUGGESTED_TAG_COLORS.contains(&res[1][0].color.as_str()));
    }

    #[test]
    fn to_tag_specs_drops_tags_past_the_requested_count() {
        let res = to_tag_specs(
            vec![raw_song(
                "song",
                vec![
                    raw_tag("a", "#111111"),
                    raw_tag("b", "#222222"),
                    raw_tag("c", "#333333"),
                ],
            )],
            &descs(&["song"]),
            2,
        );

        assert_eq!(res[0].len(), 2);
    }

    #[test]
    fn to_tag_specs_gives_a_repeated_name_its_first_generated_color() {
        let res = to_tag_specs(
            vec![
                raw_song("first", vec![raw_tag("Dreamy", "not a color")]),
                raw_song("second", vec![raw_tag("dreamy", "#A1C6EA")]),
                raw_song("third", vec![raw_tag(" dreamy ", "#000000")]),
            ],
            &descs(&["first", "second", "third"]),
            10,
        );

        for tags in &res {
            assert_eq!(tags[0].name, "dreamy");
            assert_eq!(tags[0].color, res[0][0].color);
            assert!(SUGGESTED_TAG_COLORS.contains(&tags[0].color.as_str()));
        }
    }

    #[test]
    fn to_tag_specs_replaces_an_invalid_model_color_with_a_palette_color() {
        let res = to_tag_specs(
            vec![raw_song("song", vec![raw_tag("dreamy", "blue")])],
            &descs(&["song"]),
            10,
        );

        assert!(SUGGESTED_TAG_COLORS.contains(&res[0][0].color.as_str()));
    }

    /// the shape of the reported bug: the model answered for one song fewer than it was
    /// given, which used to slide every later song onto the previous song's tags
    #[test]
    fn to_tag_specs_leaves_a_skipped_song_empty_instead_of_shifting() {
        // three songs, but the model never answers for Master of Puppets
        let res = to_tag_specs(
            vec![
                raw_song("Jolene by Dolly Parton", vec![raw_tag("folk", "#c19a6b")]),
                raw_song(
                    "Linger by The Cranberries",
                    vec![raw_tag("dreamy", "#a1c6ea")],
                ),
            ],
            &descs(&[
                "Jolene by Dolly Parton",
                "Master of Puppets by Metallica",
                "Linger by The Cranberries",
            ]),
            10,
        );

        // Linger keeps its own tags rather than taking Master of Puppets'
        assert_eq!(res.len(), 3);
        assert_eq!(res[0][0].name, "folk");
        assert!(res[1].is_empty());
        assert_eq!(res[2][0].name, "dreamy");
    }

    #[test]
    fn to_tag_specs_puts_out_of_order_songs_back_in_input_order() {
        let res = to_tag_specs(
            vec![
                raw_song("c", vec![raw_tag("third", "#333333")]),
                raw_song("a", vec![raw_tag("first", "#111111")]),
                raw_song("b", vec![raw_tag("second", "#222222")]),
            ],
            &descs(&["a", "b", "c"]),
            10,
        );

        let names: Vec<&str> = res.iter().map(|tags| tags[0].name.as_str()).collect();
        assert_eq!(names, ["first", "second", "third"]);
    }

    #[test]
    fn to_tag_specs_drops_a_description_that_matches_no_input_song() {
        let res = to_tag_specs(
            vec![
                raw_song("a song never sent", vec![raw_tag("invented", "#111111")]),
                raw_song("real song", vec![raw_tag("real", "#222222")]),
            ],
            &descs(&["real song"]),
            10,
        );

        assert_eq!(res.len(), 1);
        assert_eq!(res[0][0].name, "real");
    }

    #[test]
    fn to_tag_specs_matches_a_description_echoed_with_different_case_and_spacing() {
        let res = to_tag_specs(
            vec![raw_song(
                "linger   BY The   Cranberries",
                vec![raw_tag("dreamy", "#a1c6ea")],
            )],
            &descs(&["Linger by The Cranberries"]),
            10,
        );

        assert_eq!(res[0][0].name, "dreamy");
    }

    #[test]
    fn to_tag_specs_gives_two_songs_sharing_a_description_the_same_tags() {
        // the same title and artist can turn up under two song ids
        let res = to_tag_specs(
            vec![raw_song(
                "One by Metallica",
                vec![raw_tag("metal", "#000000")],
            )],
            &descs(&["One by Metallica", "One by Metallica"]),
            10,
        );

        assert_eq!(res.len(), 2);
        assert_eq!(res[0][0].name, "metal");
        assert_eq!(res[1][0].name, "metal");
    }

    #[test]
    fn to_tag_specs_keeps_the_first_entry_for_a_repeated_description() {
        let res = to_tag_specs(
            vec![
                raw_song("song", vec![raw_tag("first", "#111111")]),
                raw_song("song", vec![raw_tag("duplicate", "#222222")]),
            ],
            &descs(&["song"]),
            10,
        );

        assert_eq!(res[0].len(), 1);
        assert_eq!(res[0][0].name, "first");
    }

    // ----- get_tag_generation_req_body, no api calls -----

    /// pulls the user message back out of the request body and parses it
    fn user_content_of(body: &Value) -> Value {
        let content = body["input"][1]["content"].as_str().unwrap().to_owned();
        serde_json::from_str(&content).unwrap()
    }

    /// a comma in a title used to split one song into two entries, which slid every
    /// later song onto the previous song's tags
    #[test]
    fn req_body_keeps_a_title_with_a_comma_as_one_song() {
        let body = get_tag_generation_req_body(
            &[
                "September by Earth, Wind & Fire".into(),
                "Linger by The Cranberries".into(),
            ],
            10,
        );

        let content = user_content_of(&body);
        let songs = content["songs"].as_array().unwrap();

        assert_eq!(songs.len(), 2);
        assert_eq!(songs[0], "September by Earth, Wind & Fire");
        assert_eq!(songs[1], "Linger by The Cranberries");
    }

    #[test]
    fn req_body_escapes_quotes_and_brackets_in_a_title() {
        let body = get_tag_generation_req_body(&[r#"Say "Hello" [Remix] by Someone"#.into()], 10);

        let content = user_content_of(&body);
        let songs = content["songs"].as_array().unwrap();

        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0], r#"Say "Hello" [Remix] by Someone"#);
    }

    #[test]
    fn req_body_sends_songs_as_strings_in_input_order() {
        let body = get_tag_generation_req_body(&["a".into(), "b".into(), "c".into()], 7);

        let content = user_content_of(&body);
        let songs = content["songs"].as_array().unwrap();

        assert_eq!(content["requested_tag_count"], 7);
        let sent: Vec<&str> = songs.iter().map(|s| s.as_str().unwrap()).collect();
        assert_eq!(sent, ["a", "b", "c"]);
    }

    // ----- OpenAiApiResponse::into_text, no api calls -----

    /// A song whose title carries a quote is escaped inside the model's payload,
    /// and that escaping is what keeps the payload parseable. Undoing it here
    /// failed the whole batch with a serde error pointing into the middle of it.
    #[test]
    fn into_text_keeps_an_escaped_quote_in_the_payload() {
        // escaped twice on the wire: once for the payload's own json, and once
        // for the response field carrying that payload as a string
        let wire = r#"{"output":[{"content":[{"text":"{\"tags\":[{\"song\":\"\\\"Heroes\\\" by David Bowie\",\"tags\":[]}]}"}]}]}"#;

        let text = serde_json::from_str::<OpenAiApiResponse>(wire)
            .unwrap()
            .into_text()
            .unwrap();

        // still parses, and the title keeps the quotes it came with
        let parsed: OpenAiGeneratedTags = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed.tags[0].song, "\"Heroes\" by David Bowie");
    }

    // ----- these call the api -----

    #[tokio::test]
    #[ignore]
    async fn generate_tags_works() {
        let g = OpenAiTagGenerator::new();
        let res = g
            .generate_tags(
                &[
                    "Into The Night by YOASOBI".into(),
                    "As It Was by Harry Styles".into(),
                ],
                3,
            )
            .await
            .unwrap();

        assert_eq!(res.len(), 2);
        assert_eq!(res[0].len(), 3);
        assert_eq!(res[1].len(), 3);

        // every tag gets a usable color
        for tags in &res {
            for tag in tags {
                assert!(
                    is_normalized_hex_color(&tag.color),
                    "{:?} is not a #rrggbb color",
                    tag
                );
            }
        }

        println!(
            "generate_tags_works -- Into The Night by YOASOBI: {:?}, As It Was by Harry Styles: {:?}",
            res[0], res[1]
        );
    }

    #[tokio::test]
    #[ignore]
    async fn empty_input_arr() {
        let g = OpenAiTagGenerator::new();
        let res = g.generate_tags(&[], 1).await.unwrap();
        assert!(res.is_empty());
    }

    #[tokio::test]
    #[ignore]
    async fn request_zero_tags() {
        let g = OpenAiTagGenerator::new();
        let res = g
            .generate_tags(
                &[
                    "Into The Night by YOASOBI".into(),
                    "As It Was by Harry Styles".into(),
                ],
                0,
            )
            .await
            .unwrap();

        assert_eq!(res.len(), 2);
        assert!(res[0].is_empty());
        assert!(res[1].is_empty());
    }

    #[tokio::test]
    #[ignore]
    async fn request_song_names_too_long() {
        let g = OpenAiTagGenerator::new();

        let res = g
            .generate_tags(&[string_of_length(MAX_COMBINED_SONG_DESC_LENGTH + 1)], 1)
            .await;

        assert!(res.is_err());
    }

    #[tokio::test]
    #[ignore]
    async fn same_song_name_different_genre() {
        let g = OpenAiTagGenerator::new();

        let res = g
            .generate_tags(
                &["One by Metallica".into(), "One by Harry Nilsson".into()],
                1,
            )
            .await
            .unwrap();

        assert_eq!(res.len(), 2);

        let metallica_tags = &res[0];
        let harry_tags = &res[1];

        println!(
            "same_song_name_different_genre -- metallica: {:?}, harry nilsson: {:?}",
            metallica_tags, harry_tags
        );

        assert_eq!(metallica_tags.len(), 1);
        assert_eq!(harry_tags.len(), 1);
        assert_ne!(metallica_tags[0].name, harry_tags[0].name);
    }

    /// requesting zero tags means no colors to assign
    #[tokio::test]
    #[ignore]
    async fn colors_absent_when_no_tags() {
        let g = OpenAiTagGenerator::new();
        let res = g
            .generate_tags(&["One by Metallica".into()], 0)
            .await
            .unwrap();

        assert_eq!(res.len(), 1);
        assert!(res[0].is_empty());
    }
}
