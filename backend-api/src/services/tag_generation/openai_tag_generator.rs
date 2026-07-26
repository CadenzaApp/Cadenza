use crate::services::tag_generation::TagGenerator;
use reqwest::Client;
use sea_orm::prelude::async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use std::env;
use std::time::Duration;

const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_HTTP_TIMEOUT_SECS: u64 = 20;
const OPENAI_MODEL: &str = "gpt-4o-mini";
const TAG_GENERATION_SYSTEM_PROMPT: &str = r#"You generate concise music tags for songs.
Rules:
- Use only the provided song metadata and existing tags.
- Suggest only likely, useful music tags.
- Prefer short tags.
- Prefer tags about genre, mood, energy, instrumentation, era, or listening context.
- Do not repeat or closely restate existing tags.
- Do not return the song title, artist name, album name, or source provider as tags.
- Do not explain your reasoning.
- Do not output sentences, numbering, or prose.
- Do not invent highly specific facts you are not confident about.
- Return valid JSON only, matching the requested schema."#;

fn get_tag_generation_req_body(song_descs: &Vec<String>, requested_tag_count: usize) -> Value {
    json!({
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "developer",
                "content": TAG_GENERATION_SYSTEM_PROMPT
            },
            {
                "role": "user",
                "content": {
                    "songs": song_descs.join(","),
                    "requested_tag_count": requested_tag_count,
                }
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "strict": true,
                "schema": {
                    "type": "object",
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
    })
}

#[derive(Clone)]
pub struct OpenAiTagGenerator {
    model: String,
    api_key: String,
    http_client: Client,
}

#[derive(Debug, Deserialize)]
struct OpenAiTagsResponse {
    tags: Vec<Vec<String>>,
}

#[async_trait]
impl TagGenerator for OpenAiTagGenerator {
    fn new() -> Self {
        Self {
            model: "gpt-4o-mini".into(),
            api_key: env::var("OPENAI_API_KEY").expect("error getting OPENAI_API_KEY env var"),
            http_client: Client::builder()
                .timeout(Duration::from_secs(OPENAI_HTTP_TIMEOUT_SECS))
                .build()
                .expect("failed to build http client for OpenAiTagGenerator"),
        }
    }

    async fn generate_tags(
        &self,
        song_descs: &Vec<String>,
        requested_tag_count: usize,
    ) -> Result<Vec<Vec<String>>, String> {
        let response = self
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

        let generated_tags_resp = response
            .json::<OpenAiTagsResponse>()
            .await
            .map_err(|err| format!("openai returned malformed response: {}", err))?;

        Ok(generated_tags_resp.tags)
    }
}
