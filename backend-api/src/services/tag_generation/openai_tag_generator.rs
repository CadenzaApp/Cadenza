use crate::services::tag_generation::TagGenerator;
use crate::services::tag_normalizer::normalize_tag_name;
use dotenvy::dotenv;
use reqwest::Client;
use sea_orm::prelude::async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use std::env;
use std::time::Duration;

const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_HTTP_TIMEOUT_SECS: u64 = 20;
const OPENAI_MODEL: &str = "gpt-4o-mini";
const TAG_GENERATION_SYSTEM_PROMPT: &str = r#"Generate one word music tags for each given song. The ordering of the returned 2d array must match the order of input songs. Generate `requested_tag_count` tags per song."#;
const MAX_COMBINED_SONG_DESC_LENGTH: usize = 200;

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
                            "items": {
                                "type": "array",
                                "items": {
                                    "type": "string"
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

#[derive(Deserialize)]
struct OpenAiGeneratedTags {
    tags: Vec<Vec<String>>,
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
    ) -> Result<Vec<Vec<String>>, String> {
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

        let mut generated_tags: OpenAiGeneratedTags =
            serde_json::from_str(&resp_text).map_err(|e| e.to_string())?;

        // normalize all generated tags (if more tags returned than requested, ignore them)
        for tags in &mut generated_tags.tags {
            if tags.len() > requested_tag_count {
                *tags = tags[..requested_tag_count].to_vec();
            }
            for tag in tags.iter_mut() {
                *tag = normalize_tag_name(tag);
            }
        }

        Ok(generated_tags.tags)
    }
}

// ---------------------------------------------------------------------------------------------
// These tests call the OpenAI API and use tokens! Remove #[ignore] to run them.
// Last ran: Jul 26
// ---------------------------------------------------------------------------------------------
mod tests {
    use super::*;
    use crate::test_utils::string_of_length;

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
        assert_eq!(res[0].len(), 3);

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
        assert_ne!(metallica_tags[0], harry_tags[0]);
    }
}
