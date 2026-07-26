use crate::services::tag_generation::TagGenerator;
use reqwest::Client;
use sea_orm::prelude::async_trait::async_trait;
use sea_orm::sqlx::Encode;
use serde::Deserialize;
use serde_json::{Value, json};
use std::env;
use std::time::Duration;

const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_HTTP_TIMEOUT_SECS: u64 = 20;
const OPENAI_MODEL: &str = "gpt-4o-mini";
const TAG_GENERATION_SYSTEM_PROMPT: &str = r#"You generate concise music tags for songs.
Rules:
- Suggest only likely, useful music tags.
- Prefer short, one word tags.
- Prefer tags about genre, mood, energy, instrumentation, era, or listening context.
- Do not repeat or closely restate existing tags.
- Do not return the song title, artist name, album name, or source provider as tags.
- The "tags" field in the return format is a 2d array - for each input song, return an array of tags.
- The order of returned tags corresponds to the order of input songs.
- The number of tags returned for each song should match `requested_tag_count`.
"#;
const MAX_REQUESTED_TAG_COUNT: usize = 10;
const MAX_REQUEST_BODY_INPUT_CHARS: usize = 200;

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
                    "songs": song_descs,
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
        if requested_tag_count > MAX_REQUESTED_TAG_COUNT {
            return Err(format!(
                "requested {} tags but at most {} is allowed",
                requested_tag_count, MAX_REQUESTED_TAG_COUNT
            ));
        }

        let body = &get_tag_generation_req_body(song_descs, requested_tag_count);

        if body.to_string().len() > MAX_REQUEST_BODY_INPUT_CHARS {
            return Err("body too large!".into());
        }

        let response = self
            .http_client
            .post(OPENAI_RESPONSES_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(body)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    // #[ignore]
    async fn generate_tags_works() {
        let g = OpenAiTagGenerator::new();
        let res = g
            .generate_tags(
                &vec![
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
    // #[ignore]
    async fn empty_input_arr() {
        let g = OpenAiTagGenerator::new();
        let res = g.generate_tags(&vec![], 1).await.unwrap();
        assert!(res.is_empty());
    }

    #[tokio::test]
    // #[ignore]
    async fn request_zero_tags() {
        let g = OpenAiTagGenerator::new();
        let res = g
            .generate_tags(&vec!["Into The Night by YOASOBI".into()], 0)
            .await
            .unwrap();
        assert!(res.is_empty());
    }

    #[tokio::test]
    // #[ignore]
    async fn request_tag_count_over_limit() {
        let g = OpenAiTagGenerator::new();
        let res = g.generate_tags(&vec![], MAX_REQUESTED_TAG_COUNT + 1).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    // #[ignore]
    async fn request_body_too_large() {
        let g = OpenAiTagGenerator::new();

        let mut long_song_name = vec![];
        for _ in 0..MAX_REQUEST_BODY_INPUT_CHARS {
            long_song_name.push("a".to_string());
        }
        let long_song_name = long_song_name.join("");

        let res = g.generate_tags(&vec![long_song_name], 1).await;

        assert!(res.is_err());
    }

    #[tokio::test]
    // #[ignore]
    async fn same_song_name_different_genre() {
        let g = OpenAiTagGenerator::new();

        let res = g
            .generate_tags(
                &vec!["One by Metallica".into(), "One by Harry Nilsson".into()],
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
