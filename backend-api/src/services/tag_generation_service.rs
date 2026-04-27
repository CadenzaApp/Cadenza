use std::collections::HashMap;

use sea_orm::DatabaseConnection;
use sea_orm::prelude::Uuid;

use crate::db::tag_generation::get_user_tag_names_for_song;
use crate::err::CadenzaError;
use crate::models::tag_generation_model::*;
use crate::services::openai_client::{OpenAiClientError, OpenAiTagGenerator};
use crate::services::tag_normalizer::{
    normalize_existing_tags_for_prompt, normalize_generated_tags_for_song,
};

const DEFAULT_REQUESTED_TAG_COUNT: usize = 5;
const MAX_EXISTING_TAGS_IN_PROMPT: usize = 25;

#[derive(Debug)]
pub enum TagGenerationServiceError {
    InvalidRequest(TagGenerationRequestError),
    Database(CadenzaError),
    OpenAi(OpenAiClientError),
}

pub struct TagGenerationService<C: OpenAiTagGenerator> {
    openai_client: C,
    default_requested_tag_count: usize,
}

impl<C: OpenAiTagGenerator> TagGenerationService<C> {
    pub fn new(openai_client: C) -> Self {
        Self {
            openai_client,
            default_requested_tag_count: DEFAULT_REQUESTED_TAG_COUNT,
        }
    }

    pub fn with_default_requested_tag_count(
        openai_client: C,
        default_requested_tag_count: usize,
    ) -> Self {
        Self {
            openai_client,
            default_requested_tag_count,
        }
    }

    fn resolve_requested_tag_count(
        &self,
        request: &TagGenerationSongRequest,
    ) -> Result<usize, TagGenerationServiceError> {
        request
            .validate()
            .map_err(TagGenerationServiceError::InvalidRequest)?;

        Ok(request
            .requested_tag_count
            .unwrap_or(self.default_requested_tag_count))
    }

    pub async fn generate_tags_for_song(
        &self,
        db: &DatabaseConnection,
        user_id: Uuid,
        request: TagGenerationSongRequest,
    ) -> Result<TagGenerationSongResponse, TagGenerationServiceError> {
        let requested_tag_count = self.resolve_requested_tag_count(&request)?;
        let resolved_song = self.resolve_requested_song(db, user_id, request).await?;
        let openai_request = self.build_openai_request(&resolved_song, requested_tag_count);

        let openai_response = self
            .openai_client
            .generate_tag_suggestions(openai_request)
            .await
            .map_err(TagGenerationServiceError::OpenAi)?;

        let mut generated_by_song_id: HashMap<String, Vec<String>> = HashMap::new();
        for song_suggestion in openai_response.suggestions {
            generated_by_song_id
                .entry(song_suggestion.song_id)
                .or_default()
                .extend(song_suggestion.suggested_tags);
        }

        let generated = generated_by_song_id
            .remove(&resolved_song.song_id)
            .unwrap_or_default();

        let normalized = normalize_generated_tags_for_song(
            &generated,
            &resolved_song.existing_user_tag_names,
            Some(requested_tag_count),
        );

        Ok(TagGenerationSongResponse::builder()
            .song_id(resolved_song.song_id)
            .suggested_tags(normalized)
            .build())
    }

    fn build_openai_request(
        &self,
        resolved_song: &ResolvedTagGenerationSongInput,
        requested_tag_count: usize,
    ) -> OpenAiTagGenerationRequest {
        OpenAiTagGenerationRequest::builder()
            .songs(vec![self.build_openai_song_input(resolved_song)])
            .requested_tag_count(requested_tag_count)
            .build()
    }

    fn build_openai_song_input(
        &self,
        resolved_song: &ResolvedTagGenerationSongInput,
    ) -> OpenAiTagGenerationSongInput {
        let existing_user_tag_names = normalize_existing_tags_for_prompt(
            &resolved_song.existing_user_tag_names,
            MAX_EXISTING_TAGS_IN_PROMPT,
        );

        OpenAiTagGenerationSongInput::builder()
            .song_id(resolved_song.song_id.clone())
            .title(resolved_song.title.clone())
            .artist(resolved_song.artist.clone())
            .maybe_album(resolved_song.album.clone())
            .maybe_source_provider(resolved_song.source_provider)
            .existing_user_tag_names(existing_user_tag_names)
            .build()
    }

    async fn resolve_requested_song(
        &self,
        db: &DatabaseConnection,
        user_id: Uuid,
        request: TagGenerationSongRequest,
    ) -> Result<ResolvedTagGenerationSongInput, TagGenerationServiceError> {
        let song_id = request.song_id.trim().to_string();
        let title = request.title.trim().to_string();
        let artist = request.artist.trim().to_string();
        let album = normalize_optional_string(request.album);
        let source_provider = request.source_provider;

        let existing_user_tag_names = get_user_tag_names_for_song(db, user_id, &song_id)
            .await
            .map_err(TagGenerationServiceError::Database)?;

        Ok(ResolvedTagGenerationSongInput {
            song_id,
            title,
            artist,
            album,
            source_provider,
            existing_user_tag_names,
        })
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let normalized = raw.trim().to_string();
        if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::sources::SourceProvider;
    use crate::models::tag_generation_model::{
        GeneratedSongTagSuggestions, OpenAiTagGenerationResponse,
    };
    use sea_orm::prelude::async_trait::async_trait;

    #[derive(Debug, Clone)]
    struct TestOpenAiClient {
        suggestions: Vec<GeneratedSongTagSuggestions>,
    }

    #[async_trait]
    impl OpenAiTagGenerator for TestOpenAiClient {
        async fn generate_tag_suggestions(
            &self,
            _request: OpenAiTagGenerationRequest,
        ) -> Result<OpenAiTagGenerationResponse, OpenAiClientError> {
            Ok(OpenAiTagGenerationResponse::builder()
                .suggestions(self.suggestions.clone())
                .build())
        }
    }

    #[test]
    fn openai_song_input_drops_empty_existing_tags() {
        let service = TagGenerationService::new(TestOpenAiClient {
            suggestions: Vec::new(),
        });

        let resolved_song = ResolvedTagGenerationSongInput::builder()
            .song_id("song-1".to_string())
            .title("Numb".to_string())
            .artist("Linkin Park".to_string())
            .existing_user_tag_names(vec!["".to_string(), "   ".to_string(), "indie".to_string()])
            .build();

        let openai_song = service.build_openai_song_input(&resolved_song);

        assert_eq!(
            openai_song.existing_user_tag_names,
            vec!["indie".to_string()]
        );
    }

    #[test]
    fn openai_song_input_deduplicates_existing_tags() {
        let service = TagGenerationService::new(TestOpenAiClient {
            suggestions: Vec::new(),
        });

        let resolved_song = ResolvedTagGenerationSongInput::builder()
            .song_id("song-1".to_string())
            .title("Numb".to_string())
            .artist("Linkin Park".to_string())
            .existing_user_tag_names(vec![
                "Alt   Rock".to_string(),
                " alt rock ".to_string(),
                "dream pop".to_string(),
            ])
            .build();

        let openai_song = service.build_openai_song_input(&resolved_song);

        assert_eq!(
            openai_song.existing_user_tag_names,
            vec!["alt rock".to_string(), "dream pop".to_string()]
        );
    }

    #[test]
    fn openai_song_input_caps_existing_tags_at_prompt_limit() {
        let service = TagGenerationService::new(TestOpenAiClient {
            suggestions: Vec::new(),
        });

        let existing_user_tag_names: Vec<String> = (1..=40).map(|i| format!("Tag {i}")).collect();
        let resolved_song = ResolvedTagGenerationSongInput::builder()
            .song_id("song-1".to_string())
            .title("Numb".to_string())
            .artist("Linkin Park".to_string())
            .existing_user_tag_names(existing_user_tag_names)
            .build();

        let openai_song = service.build_openai_song_input(&resolved_song);

        assert_eq!(
            openai_song.existing_user_tag_names.len(),
            MAX_EXISTING_TAGS_IN_PROMPT
        );
        assert_eq!(openai_song.existing_user_tag_names[0], "tag 1");
        assert_eq!(
            openai_song.existing_user_tag_names[MAX_EXISTING_TAGS_IN_PROMPT - 1],
            "tag 25"
        );
    }

    #[test]
    fn openai_song_input_keeps_small_existing_tags_list() {
        let service = TagGenerationService::new(TestOpenAiClient {
            suggestions: Vec::new(),
        });

        let resolved_song = ResolvedTagGenerationSongInput::builder()
            .song_id("song-1".to_string())
            .title("Numb".to_string())
            .artist("Linkin Park".to_string())
            .existing_user_tag_names(vec!["Jazz".to_string(), " evening ".to_string()])
            .build();

        let openai_song = service.build_openai_song_input(&resolved_song);

        assert_eq!(
            openai_song.existing_user_tag_names,
            vec!["jazz".to_string(), "evening".to_string()]
        );
    }

    #[test]
    fn openai_song_input_carries_song_metadata_fields() {
        let service = TagGenerationService::new(TestOpenAiClient {
            suggestions: Vec::new(),
        });

        let resolved_song = ResolvedTagGenerationSongInput::builder()
            .song_id("song-1".to_string())
            .title("Numb".to_string())
            .artist("Linkin Park".to_string())
            .album("Meteora".to_string())
            .maybe_source_provider(Some(SourceProvider::AppleMusic))
            .build();

        let openai_song = service.build_openai_song_input(&resolved_song);

        assert_eq!(openai_song.song_id, "song-1");
        assert_eq!(openai_song.title, "Numb");
        assert_eq!(openai_song.artist, "Linkin Park");
        assert_eq!(openai_song.album, Some("Meteora".to_string()));
        assert_eq!(
            openai_song.source_provider,
            Some(SourceProvider::AppleMusic)
        );
    }
}
