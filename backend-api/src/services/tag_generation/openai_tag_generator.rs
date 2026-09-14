use crate::services::tag_generation::{TagSpecs, MAX_COMBINED_SONG_DESC_LENGTH, TagGenerator};
use crate::services::tag_normalizer::normalize_tag_name;
use dotenvy::dotenv;
use reqwest::Client;
use sea_orm::prelude::async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::env;
use std::time::Duration;

const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_HTTP_TIMEOUT_SECS: u64 = 60;
const OPENAI_MODEL: &str = "gpt-4o-mini";
const TAG_GENERATION_SYSTEM_PROMPT: &str = r#"Generate one word music tags for each given song. The ordering of the returned 2d array must match the order of input songs. Generate `requested_tag_count` tags per song. Give every tag a `#RRGGBB` hex color that reflects what it evokes - its mood, energy, genre or era. Warm bright colors for energetic or happy tags, cool dark colors for somber or calm ones. When the same tag appears on more than one song, give it the same color each time."#;

/// color used when the model returns a color we can't parse
const FALLBACK_TAG_COLOR: &str = "#808080";

fn normalize_tag_color(color: &str) -> String {
    let color = color.trim();

    let is_hex_color = color.len() == 7
        && color.starts_with('#')
        && color[1..].chars().all(|c| c.is_ascii_hexdigit());

    match is_hex_color {
        true => color.to_lowercase(),
        false => FALLBACK_TAG_COLOR.to_owned(),
    }
}

fn get_tag_generation_req_body(song_descs: &[String], requested_tag_count: usize) -> Value {
    let user_content = format!(
        "{{ songs: [{}], requested_tag_count: {} }}",
        song_descs.join(","),
        requested_tag_count
    );

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
                            "description": "one list of tags per input song, in input order",
                            "items": {
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

        let text = self.output.remove(0).content.remove(0).text;
        let text = text.replace("\\\"", "\""); // response text has \" instead of "

        Ok(text)
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

/// the reply the json schema asks for: a list of tags per song, each tag carrying its own color
#[derive(Deserialize)]
struct OpenAiGeneratedTags {
    tags: Vec<Vec<TagSpecs>>,
}

/// Cleans up the model's tags. Keeps at most `requested_tag_count` tags per song, normalizes every
/// name and color, and gives every copy of a name the first usable color that name got anywhere in
/// the reply. A name that never got a usable color falls back to `FALLBACK_TAG_COLOR`.
fn to_tag_specs(generated_tags: Vec<Vec<TagSpecs>>, requested_tag_count: usize) -> Vec<Vec<TagSpecs>> {
    // drop tags past the requested count, and normalize each name and color
    let songs_tags: Vec<Vec<TagSpecs>> = generated_tags
        .into_iter()
        .map(|tags| {
            tags.into_iter()
                .take(requested_tag_count)
                .map(|tag| TagSpecs {
                    name: normalize_tag_name(&tag.name),
                    color: normalize_tag_color(&tag.color),
                })
                .collect()
        })
        .collect();

    // the first usable color each name got, so one name is one color across the whole reply
    let mut name_to_color: HashMap<String, String> = HashMap::new();
    for tag in songs_tags.iter().flatten() {
        if tag.color != FALLBACK_TAG_COLOR {
            name_to_color
                .entry(tag.name.clone())
                .or_insert_with(|| tag.color.clone());
        }
    }

    // give each tag its name's color, keeping the fallback for names that never got a usable one
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
    ) -> Result<Vec<Vec<TagSpecs>>, String> {
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

        let resp_text = resp
            .json::<OpenAiApiResponse>()
            .await
            .map_err(|err| format!("openai returned malformed response: {}", err))?
            .into_text()?;

        let generated_tags: OpenAiGeneratedTags =
            serde_json::from_str(&resp_text).map_err(|e| e.to_string())?;

        Ok(to_tag_specs(generated_tags.tags, requested_tag_count))
    }
}

// ---------------------------------------------------------------------------------------------
// These tests call the OpenAI API and use tokens! Use `cargo test -- --ignored` to run them.
// Last ran: Jul 26
// ---------------------------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::string_of_length;

    /// true if `color` is a lowercase `#rrggbb` hex color
    fn is_normalized_hex_color(color: &str) -> bool {
        color.len() == 7
            && color.starts_with('#')
            && color[1..]
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    }

    // ----- normalize_tag_color, no api calls -----

    #[test]
    fn normalize_tag_color_keeps_hex_colors() {
        assert_eq!(normalize_tag_color("#1a2b3c"), "#1a2b3c");
        assert_eq!(normalize_tag_color("#FF0000"), "#ff0000");
        assert_eq!(normalize_tag_color("  #00ff00  "), "#00ff00");
    }

    #[test]
    fn normalize_tag_color_falls_back_on_bad_input() {
        for bad in ["", "red", "#12345", "#1234567", "#ggghhh", "1a2b3c", "#1a2b3g"] {
            assert_eq!(
                normalize_tag_color(bad),
                FALLBACK_TAG_COLOR,
                "expected fallback for {:?}",
                bad
            );
        }
    }

    #[test]
    fn fallback_tag_color_is_normalized() {
        assert!(is_normalized_hex_color(FALLBACK_TAG_COLOR));
    }

    // ----- to_tag_specs, no api calls -----

    /// a tag as the model might return it, before any cleanup
    fn raw_tag(name: &str, color: &str) -> TagSpecs {
        TagSpecs {
            name: name.into(),
            color: color.into(),
        }
    }

    #[test]
    fn to_tag_specs_reads_the_schema_shape() {
        // a reply in the shape the json schema asks for
        let reply = r##"{"tags": [[{"name": "Pop", "color": "#FF6F61"}], [{"name": "metal", "color": "#000000"}]]}"##;
        let generated: OpenAiGeneratedTags = serde_json::from_str(reply).unwrap();

        let res = to_tag_specs(generated.tags, 10);

        assert_eq!(res.len(), 2);
        assert_eq!((res[0][0].name.as_str(), res[0][0].color.as_str()), ("pop", "#ff6f61"));
        assert_eq!((res[1][0].name.as_str(), res[1][0].color.as_str()), ("metal", "#000000"));
    }

    #[test]
    fn to_tag_specs_drops_tags_past_the_requested_count() {
        let res = to_tag_specs(
            vec![vec![raw_tag("a", "#111111"), raw_tag("b", "#222222"), raw_tag("c", "#333333")]],
            2,
        );

        assert_eq!(res[0].len(), 2);
    }

    #[test]
    fn to_tag_specs_gives_a_repeated_name_its_first_usable_color() {
        // the first copy has a bad color, so the second copy's color should win everywhere
        let res = to_tag_specs(
            vec![
                vec![raw_tag("Dreamy", "not a color")],
                vec![raw_tag("dreamy", "#A1C6EA")],
                vec![raw_tag(" dreamy ", "#000000")],
            ],
            10,
        );

        for tags in &res {
            assert_eq!(tags[0].name, "dreamy");
            assert_eq!(tags[0].color, "#a1c6ea");
        }
    }

    #[test]
    fn to_tag_specs_falls_back_when_a_name_never_gets_a_usable_color() {
        let res = to_tag_specs(vec![vec![raw_tag("dreamy", "blue")]], 10);

        assert_eq!(res[0][0].color, FALLBACK_TAG_COLOR);
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
        let res = g.generate_tags(&["One by Metallica".into()], 0).await.unwrap();

        assert_eq!(res.len(), 1);
        assert!(res[0].is_empty());
    }
}
