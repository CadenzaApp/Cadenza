use crate::models::tag_generation_model::{
    GeneratedSongTagSuggestions, OpenAiTagGenerationRequest, OpenAiTagGenerationResponse,
};
use dotenvy::dotenv;
use std::env;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenAiApiKeyError {
    OpenAiApiKeyMissing,
}

pub trait OpenAiTagGenerator {
    fn generate_tag_suggestions(
        &self,
        request: OpenAiTagGenerationRequest,
    ) -> Result<OpenAiTagGenerationResponse, OpenAiClientError>;
}

#[derive(Debug, Clone)]
pub struct OpenAiClient {
    model: String,
    api_key: String,
}

impl OpenAiClient {
    fn new(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            model: model.into(),
        }
    }

    pub fn model(&self) -> &str {
        &self.model
    }
}

impl OpenAiClient {
    pub fn from_env() -> Result<Self, OpenAiApiKeyError> {
        let api_key = load_api_from_env()?;
        Ok(Self::new(api_key, "gpt-4o-mini"))
    }
}

impl OpenAiTagGenerator for OpenAiClient {
    fn generate_tag_suggestions(
        &self,
        request: OpenAiTagGenerationRequest,
    ) -> Result<OpenAiTagGenerationResponse, OpenAiClientError> {
        if request.songs.is_empty() {
            return Err(OpenAiClientError::EmptyRequest);
        }

        // Stubbed LLM response for initial backend architecture wiring.
        // This intentionally stays thin and transport-focused; business cleanup
        // is handled in tag_normalizer + tag_generation_service.
        let mut suggestions = Vec::with_capacity(request.songs.len());
        for song in request.songs {
            let mut generated = Vec::new();

            if let Some(artist) = song.artist {
                generated.push(artist);
            }
            if let Some(album) = song.album {
                generated.push(album);
            }
            if let Some(title) = song.title {
                generated.push(title);
            }

            generated.truncate(request.requested_tag_count);

            suggestions.push(
                GeneratedSongTagSuggestions::builder()
                    .song_id(song.song_id)
                    .suggested_tags(generated)
                    .build(),
            );
        }

        Ok(OpenAiTagGenerationResponse::builder()
            .suggestions(suggestions)
            .build())
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
                "source_providers": song.source_providers,
                "existing_global_tag_names": song.existing_global_tag_names,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::sources::SourceProvider;
    use crate::models::tag_generation_model::OpenAiTagGenerationSongInput;

    #[test]
    fn default_client_uses_expected_model_name() {
        let client = OpenAiClient::new("fake_key", "gpt-4o-mini");
        assert_eq!(client.model(), "gpt-4o-mini");
    }

    #[test]
    fn stub_returns_response_mapped_by_song_id() {
        let client = OpenAiClient::new("fake_key", "gpt-4o-mini");
        let request = OpenAiTagGenerationRequest::builder()
            .requested_tag_count(2)
            .songs(vec![
                OpenAiTagGenerationSongInput::builder()
                    .song_id("song-1".to_string())
                    .title("Numb".to_string())
                    .artist("Linkin Park".to_string())
                    .source_providers(vec![SourceProvider::AppleMusic])
                    .build(),
            ])
            .build();

        let response = client
            .generate_tag_suggestions(request)
            .expect("stub should generate");

        assert_eq!(response.suggestions.len(), 1);
        assert_eq!(response.suggestions[0].song_id, "song-1");
        assert_eq!(response.suggestions[0].suggested_tags.len(), 2);
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
                    .source_providers(vec![SourceProvider::AppleMusic])
                    .existing_global_tag_names(vec!["rock".to_string()])
                    .build(),
            ])
            .build();

        let payload = build_tag_generation_user_payload(&request);

        assert_eq!(payload["requested_tag_count"], 5);
        assert_eq!(payload["songs"][0]["song_id"], "song-1");
        assert_eq!(payload["songs"][0]["title"], "Numb");
        assert_eq!(payload["songs"][0]["artist"], "Linkin Park");
        assert_eq!(payload["songs"][0]["album"], "Meteora");
        assert_eq!(payload["songs"][0]["existing_global_tag_names"][0], "rock");
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
                    .source_providers(vec![SourceProvider::AppleMusic])
                    .build(),
            ])
            .build();

        let outbound = build_chat_completions_request("gpt-4o-mini", &request);

        assert_eq!(outbound.model, "gpt-4o-mini");
        assert_eq!(outbound.messages.len(), 2);
        assert_eq!(outbound.messages[0].role, "developer");
        assert!(outbound.messages[0].content.contains("You generate concise music tags"));
        assert_eq!(outbound.messages[1].role, "user");
        assert_eq!(outbound.response_format.format_type, "json_schema");
        assert_eq!(outbound.response_format.json_schema.name, "tag_generation_response");
        assert!(outbound.response_format.json_schema.strict);
    }

    #[test]
    fn chat_completions_request_serializes_cleanly() {
        let request = OpenAiTagGenerationRequest::builder()
            .requested_tag_count(2)
            .songs(vec![
                OpenAiTagGenerationSongInput::builder()
                    .song_id("song-1".to_string())
                    .title("Numb".to_string())
                    .artist("Linkin Park".to_string())
                    .build(),
            ])
            .build();

        let outbound = build_chat_completions_request("gpt-4o-mini", &request);
        let serialized = serde_json::to_string(&outbound).expect("request should serialize");

        assert!(serialized.contains("\"model\":\"gpt-4o-mini\""));
        assert!(serialized.contains("\"response_format\""));
        assert!(serialized.contains("\"json_schema\""));

        let user_message = &outbound.messages[1].content;
        assert!(user_message.contains("\"song_id\":\"song-1\""));
    }
}
