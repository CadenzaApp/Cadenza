use crate::models::tag_generation_model::{
    OpenAiTagGenerationRequest, OpenAiTagGenerationResponse,
};
use dotenvy::dotenv;
use reqwest::Client;
use sea_orm::prelude::async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::env;
use std::time::Duration;

const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";
const OPENAI_HTTP_TIMEOUT_SECS: u64 = 20;
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenAiClientError {
    EmptyRequest,
    HttpClientBuildFailed { message: String },
    RequestSendFailed { message: String },
    ResponseBodyReadFailed { message: String },
    NonSuccessStatusCode { status_code: u16, body: String },
    ResponseJsonParseFailed { message: String },
    MissingResponseContent,
    ModelContentDeserializationFailed { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenAiApiKeyError {
    OpenAiApiKeyMissing,
    HttpClientBuildFailed { message: String },
}

#[async_trait]
pub trait OpenAiTagGenerator {
    async fn generate_tag_suggestions(
        &self,
        request: OpenAiTagGenerationRequest,
    ) -> Result<OpenAiTagGenerationResponse, OpenAiClientError>;
}

#[derive(Clone)]
pub struct OpenAiClient {
    model: String,
    api_key: String,
    http_client: Client,
}

impl OpenAiClient {
    pub fn new(
        api_key: impl Into<String>,
        model: impl Into<String>,
    ) -> Result<Self, OpenAiClientError> {
        let http_client = build_http_client()
            .map_err(|message| OpenAiClientError::HttpClientBuildFailed { message })?;

        Ok(Self {
            api_key: api_key.into(),
            model: model.into(),
            http_client,
        })
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    pub fn from_env() -> Result<Self, OpenAiApiKeyError> {
        let api_key = load_api_from_env()?;
        let http_client = build_http_client()
            .map_err(|message| OpenAiApiKeyError::HttpClientBuildFailed { message })?;

        Ok(Self {
            api_key,
            model: "gpt-4o-mini".to_string(),
            http_client,
        })
    }

    async fn send_chat_completions_request(
        &self,
        outbound_request: &ChatCompletionsRequest,
    ) -> Result<String, OpenAiClientError> {
        let response = self
            .http_client
            .post(OPENAI_CHAT_COMPLETIONS_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(outbound_request)
            .send()
            .await
            .map_err(|err| OpenAiClientError::RequestSendFailed {
                message: err.to_string(),
            })?;

        let status = response.status();
        let body =
            response
                .text()
                .await
                .map_err(|err| OpenAiClientError::ResponseBodyReadFailed {
                    message: err.to_string(),
                })?;

        if !status.is_success() {
            return Err(OpenAiClientError::NonSuccessStatusCode {
                status_code: status.as_u16(),
                body,
            });
        }

        Ok(body)
    }
}

#[async_trait]
impl OpenAiTagGenerator for OpenAiClient {
    async fn generate_tag_suggestions(
        &self,
        request: OpenAiTagGenerationRequest,
    ) -> Result<OpenAiTagGenerationResponse, OpenAiClientError> {
        if request.songs.is_empty() {
            return Err(OpenAiClientError::EmptyRequest);
        }

        let outbound_request = build_chat_completions_request(&self.model, &request);
        let raw_response_body = self
            .send_chat_completions_request(&outbound_request)
            .await?;

        parse_openai_tag_generation_response(&raw_response_body)
    }
}

pub fn load_api_from_env() -> Result<String, OpenAiApiKeyError> {
    dotenv().ok();

    let api_key = match env::var("OPENAI_API_KEY") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => return Err(OpenAiApiKeyError::OpenAiApiKeyMissing),
    };

    Ok(api_key)
}

fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(OPENAI_HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|err| err.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ChatCompletionsRequest {
    model: String,
    messages: Vec<ChatMessage>,
    response_format: ResponseFormat,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
    json_schema: JsonSchemaConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct JsonSchemaConfig {
    name: String,
    strict: bool,
    schema: Value,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatCompletionsResponse {
    #[serde(default)]
    choices: Vec<OpenAiChatCompletionChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatCompletionChoice {
    message: Option<OpenAiChatCompletionMessage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatCompletionMessage {
    content: Option<String>,
}

fn build_tag_generation_user_payload(request: &OpenAiTagGenerationRequest) -> Value {
    let songs: Vec<Value> = request
        .songs
        .iter()
        .map(|song| {
            json!({
                "song_id": song.song_id,
                "title": song.title,
                "artist": song.artist,
                "album": song.album,
                "source_provider": song.source_provider,
                "existing_user_tag_names": song.existing_user_tag_names,
            })
        })
        .collect();

    json!({
        "requested_tag_count": request.requested_tag_count,
        "songs": songs,
    })
}

fn build_tag_generation_json_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "suggestions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "song_id": {
                            "type": "string"
                        },
                        "suggested_tags": {
                            "type": "array",
                            "items": {
                                "type": "string"
                            }
                        }
                    },
                    "required": ["song_id", "suggested_tags"]
                }
            }
        },
        "required": ["suggestions"]
    })
}

fn build_chat_completions_request(
    model: &str,
    request: &OpenAiTagGenerationRequest,
) -> ChatCompletionsRequest {
    let user_payload = build_tag_generation_user_payload(request);

    ChatCompletionsRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: "developer".to_string(),
                content: TAG_GENERATION_SYSTEM_PROMPT.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_payload.to_string(),
            },
        ],
        response_format: ResponseFormat {
            format_type: "json_schema".to_string(),
            json_schema: JsonSchemaConfig {
                name: "tag_generation_response".to_string(),
                strict: true,
                schema: build_tag_generation_json_schema(),
            },
        },
    }
}

fn parse_openai_tag_generation_response(
    raw_response_body: &str,
) -> Result<OpenAiTagGenerationResponse, OpenAiClientError> {
    let raw_response: OpenAiChatCompletionsResponse = serde_json::from_str(raw_response_body)
        .map_err(|err| OpenAiClientError::ResponseJsonParseFailed {
            message: err.to_string(),
        })?;

    let model_content = extract_model_content(&raw_response)?;

    serde_json::from_str::<OpenAiTagGenerationResponse>(model_content).map_err(|err| {
        OpenAiClientError::ModelContentDeserializationFailed {
            message: err.to_string(),
        }
    })
}

fn extract_model_content(
    response: &OpenAiChatCompletionsResponse,
) -> Result<&str, OpenAiClientError> {
    response
        .choices
        .first()
        .and_then(|choice| choice.message.as_ref())
        .and_then(|message| message.content.as_deref())
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .ok_or(OpenAiClientError::MissingResponseContent)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::sources::SourceProvider;
    use crate::models::tag_generation_model::OpenAiTagGenerationSongInput;

    #[test]
    fn default_client_uses_expected_model_name() {
        let client = OpenAiClient::new("fake_key", "gpt-4o-mini")
            .expect("client should build with default settings");
        assert_eq!(client.model(), "gpt-4o-mini");
    }

    #[test]
    fn user_payload_contains_requested_count_and_song_data() {
        let request = OpenAiTagGenerationRequest::builder()
            .requested_tag_count(5)
            .songs(vec![
                OpenAiTagGenerationSongInput::builder()
                    .song_id("song-1".to_string())
                    .title("Numb".to_string())
                    .artist("Linkin Park".to_string())
                    .album("Meteora".to_string())
                    .maybe_source_provider(Some(SourceProvider::AppleMusic))
                    .existing_user_tag_names(vec!["rock".to_string()])
                    .build(),
            ])
            .build();

        let payload = build_tag_generation_user_payload(&request);

        assert_eq!(payload["requested_tag_count"], 5);
        assert_eq!(payload["songs"][0]["song_id"], "song-1");
        assert_eq!(payload["songs"][0]["title"], "Numb");
        assert_eq!(payload["songs"][0]["artist"], "Linkin Park");
        assert_eq!(payload["songs"][0]["album"], "Meteora");
        assert_eq!(payload["songs"][0]["existing_user_tag_names"][0], "rock");
    }

    #[test]
    fn json_schema_requires_suggestions_shape() {
        let schema = build_tag_generation_json_schema();

        assert_eq!(schema["type"], "object");
        assert_eq!(schema["required"][0], "suggestions");
        assert_eq!(schema["properties"]["suggestions"]["type"], "array");
        assert_eq!(
            schema["properties"]["suggestions"]["items"]["required"][0],
            "song_id"
        );
        assert_eq!(
            schema["properties"]["suggestions"]["items"]["required"][1],
            "suggested_tags"
        );
    }

    #[test]
    fn chat_completions_request_contains_prompt_messages_and_schema_format() {
        let request = OpenAiTagGenerationRequest::builder()
            .requested_tag_count(3)
            .songs(vec![
                OpenAiTagGenerationSongInput::builder()
                    .song_id("song-1".to_string())
                    .title("Numb".to_string())
                    .artist("Linkin Park".to_string())
                    .maybe_source_provider(Some(SourceProvider::AppleMusic))
                    .build(),
            ])
            .build();

        let outbound = build_chat_completions_request("gpt-4o-mini", &request);

        assert_eq!(outbound.model, "gpt-4o-mini");
        assert_eq!(outbound.messages.len(), 2);
        assert_eq!(outbound.messages[0].role, "developer");
        assert!(
            outbound.messages[0]
                .content
                .contains("You generate concise music tags")
        );
        assert_eq!(outbound.messages[1].role, "user");
        assert!(
            outbound.messages[1]
                .content
                .contains("\"requested_tag_count\":3")
        );
        assert!(
            outbound.messages[1]
                .content
                .contains("\"song_id\":\"song-1\"")
        );
        assert_eq!(outbound.response_format.format_type, "json_schema");
        assert_eq!(
            outbound.response_format.json_schema.name,
            "tag_generation_response"
        );
        assert!(outbound.response_format.json_schema.strict);
    }

    #[test]
    fn parser_converts_valid_raw_openai_response() {
        let content = json!({
            "suggestions": [
                {
                    "song_id": "song-1",
                    "suggested_tags": ["alt rock", "energetic"]
                }
            ]
        })
        .to_string();

        let raw_response = json!({
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": content
                    }
                }
            ]
        })
        .to_string();

        let parsed = parse_openai_tag_generation_response(&raw_response)
            .expect("parser should convert valid response");

        assert_eq!(parsed.suggestions.len(), 1);
        assert_eq!(parsed.suggestions[0].song_id, "song-1");
        assert_eq!(
            parsed.suggestions[0].suggested_tags,
            vec!["alt rock".to_string(), "energetic".to_string()]
        );
    }

    #[test]
    fn parser_returns_error_when_content_is_missing() {
        let raw_response = json!({
            "choices": [
                {
                    "message": {
                        "role": "assistant"
                    }
                }
            ]
        })
        .to_string();

        let err = parse_openai_tag_generation_response(&raw_response)
            .expect_err("missing content should return an error");

        assert_eq!(err, OpenAiClientError::MissingResponseContent);
    }

    #[test]
    fn parser_returns_error_when_content_is_not_valid_target_json() {
        let raw_response = json!({
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "not valid json"
                    }
                }
            ]
        })
        .to_string();

        let err = parse_openai_tag_generation_response(&raw_response)
            .expect_err("invalid model content should fail to deserialize");

        assert!(matches!(
            err,
            OpenAiClientError::ModelContentDeserializationFailed { .. }
        ));
    }

    // ---------------------------------------------------------------------------------------------
    //                This is an actual test that calls the API and will use tokens!!!
    //                   Should not be ran unless you think something is broken!!!
    //                Tis why it has the [ignore] brackets so it doesn't run every time
    //                             Last test ran: April 21st at 01:15
    // ---------------------------------------------------------------------------------------------
    #[tokio::test]
    #[ignore]
    async fn real_openai_call_returns_structured_response() {
        let client = OpenAiClient::from_env().expect("OPENAI_API_KEY must be set");

        let request = OpenAiTagGenerationRequest::builder()
            .requested_tag_count(10)
            .songs(vec![
                OpenAiTagGenerationSongInput::builder()
                    .song_id("song-1".to_string())
                    .title("Suzume".to_string())
                    .artist("RADWIMPS".to_string())
                    .album("Suzume".to_string())
                    .maybe_source_provider(Some(SourceProvider::AppleMusic))
                    .existing_user_tag_names(vec!["Japanese".to_string()])
                    .build(),
            ])
            .build();

        let response = client
            .generate_tag_suggestions(request)
            .await
            .expect("real OpenAI request should succeed");

        println!("{response:#?}");

        assert_eq!(response.suggestions.len(), 1);
        assert_eq!(response.suggestions[0].song_id, "song-1");
    }
}
