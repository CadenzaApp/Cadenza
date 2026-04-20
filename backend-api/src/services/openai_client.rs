use std::env;
use std::env::VarError;
use dotenvy::dotenv;
use crate::models::tag_generation_model::{
    GeneratedSongTagSuggestions, OpenAiTagGenerationRequest, OpenAiTagGenerationResponse,
};

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

pub fn load_api_from_env() -> Result<String, OpenAiApiKeyError>{
    dotenv().ok();
    let api_key = match env::var("OPENAI_API_KEY") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => return Err(OpenAiApiKeyError::OpenAiApiKeyMissing),
    };

    Ok(api_key)
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
            .songs(vec![OpenAiTagGenerationSongInput::builder()
                .song_id("song-1".to_string())
                .title("Numb".to_string())
                .artist("Linkin Park".to_string())
                .source_providers(vec![SourceProvider::AppleMusic])
                .build()])
            .build();

        let response = client
            .generate_tag_suggestions(request)
            .expect("stub should generate");

        assert_eq!(response.suggestions.len(), 1);
        assert_eq!(response.suggestions[0].song_id, "song-1");
        assert_eq!(response.suggestions[0].suggested_tags.len(), 2);
    }
}
