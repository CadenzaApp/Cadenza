use std::collections::HashMap;

use crate::models::song::Song;
use crate::models::sources::SourceProvider;
use crate::models::tag_generation_model::*;
use crate::services::openai_client::{OpenAiClientError, OpenAiTagGenerator};
use crate::services::tag_normalizer::{
    normalize_existing_tags_for_prompt, normalize_generated_tags_for_song,
};

const DEFAULT_REQUESTED_TAG_COUNT: usize = 5;
const MAX_EXISTING_TAGS_IN_PROMPT: usize = 25;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TagGenerationServiceError {
    EmptySelection,
    InvalidRequestedTagCount,
    MissingSongs {
        song_ids: Vec<String>,
        apple_music_song_ids: Vec<String>,
    },
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
        request: &TagGenerationBatchRequest,
    ) -> Result<usize, TagGenerationServiceError> {
        request.validate().map_err(|err| match err {
            TagGenerationRequestError::EmptySelection => TagGenerationServiceError::EmptySelection,
            TagGenerationRequestError::InvalidRequestedTagCount => {
                TagGenerationServiceError::InvalidRequestedTagCount
            }
        })?;

        Ok(request
            .requested_tag_count
            .unwrap_or(self.default_requested_tag_count))
    }

    pub async fn generate_tags_for_songs(
        &self,
        request: TagGenerationBatchRequest,
        canonical_songs: &[Song],
    ) -> Result<TagGenerationBatchResponse, TagGenerationServiceError> {
        let requested_tag_count = self.resolve_requested_tag_count(&request)?;
        let resolved_inputs = self.resolve_requested_songs(&request, canonical_songs)?;
        let openai_request = self.build_openai_request(&resolved_inputs, requested_tag_count);

        let openai_response = self
            .openai_client
            .generate_tag_suggestions(openai_request)
            .await
            .map_err(TagGenerationServiceError::OpenAi)?;

        let mut by_song_id: HashMap<String, Vec<String>> = HashMap::new();
        for song_suggestion in openai_response.suggestions {
            by_song_id
                .entry(song_suggestion.song_id)
                .or_default()
                .extend(song_suggestion.suggested_tags);
        }

        let songs = resolved_inputs
            .into_iter()
            .map(|resolved_song| {
                let generated = by_song_id
                    .remove(&resolved_song.song_id)
                    .unwrap_or_default();

                let normalized = normalize_generated_tags_for_song(
                    &generated,
                    &resolved_song.existing_global_tag_names,
                    Some(requested_tag_count),
                );

                TagGenerationSongResponse::builder()
                    .song_id(resolved_song.song_id)
                    .suggested_tags(normalized)
                    .build()
            })
            .collect();

        Ok(TagGenerationBatchResponse::builder().songs(songs).build())
    }

    fn build_openai_request(
        &self,
        resolved_inputs: &[ResolvedTagGenerationSongInput],
        requested_tag_count: usize,
    ) -> OpenAiTagGenerationRequest {
        let songs = resolved_inputs
            .iter()
            .map(|song| self.build_openai_song_input(song))
            .collect();

        OpenAiTagGenerationRequest::builder()
            .songs(songs)
            .requested_tag_count(requested_tag_count)
            .build()
    }

    fn build_openai_song_input(
        &self,
        resolved_song: &ResolvedTagGenerationSongInput,
    ) -> OpenAiTagGenerationSongInput {
        let existing_global_tag_names = normalize_existing_tags_for_prompt(
            &resolved_song.existing_global_tag_names,
            MAX_EXISTING_TAGS_IN_PROMPT,
        );

        OpenAiTagGenerationSongInput::builder()
            .song_id(resolved_song.song_id.clone())
            .maybe_title(resolved_song.title.clone())
            .maybe_artist(resolved_song.artist.clone())
            .maybe_album(resolved_song.album.clone())
            .source_providers(resolved_song.source_providers.clone())
            .existing_global_tag_names(existing_global_tag_names)
            .build()
    }

    fn resolve_requested_songs(
        &self,
        request: &TagGenerationBatchRequest,
        canonical_songs: &[Song],
    ) -> Result<Vec<ResolvedTagGenerationSongInput>, TagGenerationServiceError> {
        let mut missing_song_ids = Vec::new();
        let mut missing_apple_music_song_ids = Vec::new();
        let mut resolved_by_song_id: HashMap<String, ResolvedTagGenerationSongInput> =
            HashMap::new();

        for requested_song in &request.songs {
            match &requested_song.selection {
                SongSelection::InternalSongId { song_id } => {
                    let normalized_song_id = song_id.trim();

                    if normalized_song_id.is_empty() {
                        continue;
                    }

                    match canonical_songs
                        .iter()
                        .find(|song| song.song_id == normalized_song_id)
                    {
                        Some(song) => {
                            resolved_by_song_id
                                .insert(song.song_id.clone(), resolved_input_from_song(song));
                        }
                        None => missing_song_ids.push(normalized_song_id.to_string()),
                    }
                }

                SongSelection::ExternalSource { provider, track_id } => {
                    let normalized_track_id = track_id.trim();

                    if normalized_track_id.is_empty() {
                        continue;
                    }

                    match canonical_songs.iter().find(|song| {
                        song.sources.iter().any(|source| {
                            source.provider == *provider && source.track_id == normalized_track_id
                        })
                    }) {
                        Some(song) => {
                            resolved_by_song_id
                                .insert(song.song_id.clone(), resolved_input_from_song(song));
                        }
                        None => {
                            if *provider == SourceProvider::AppleMusic {
                                missing_apple_music_song_ids.push(normalized_track_id.to_string());
                            } else {
                                missing_song_ids.push(normalized_track_id.to_string());
                            }
                        }
                    }
                }
            }
        }

        if resolved_by_song_id.is_empty() {
            return Err(TagGenerationServiceError::EmptySelection);
        }

        if !missing_song_ids.is_empty() || !missing_apple_music_song_ids.is_empty() {
            return Err(TagGenerationServiceError::MissingSongs {
                song_ids: missing_song_ids,
                apple_music_song_ids: missing_apple_music_song_ids,
            });
        }

        let mut resolved: Vec<ResolvedTagGenerationSongInput> =
            resolved_by_song_id.into_values().collect();
        resolved.sort_by(|a, b| a.song_id.cmp(&b.song_id));

        Ok(resolved)
    }
}

fn resolved_input_from_song(song: &Song) -> ResolvedTagGenerationSongInput {
    let mut source_providers: Vec<SourceProvider> =
        song.sources.iter().map(|s| s.provider).collect();
    source_providers.sort();
    source_providers.dedup();

    let existing_global_tag_names = song
        .global_tags
        .iter()
        .map(|tag| tag.name.clone())
        .collect();

    ResolvedTagGenerationSongInput {
        song_id: song.song_id.clone(),
        title: song.metadata.title.clone(),
        artist: song.metadata.artist.clone(),
        album: song.metadata.album.clone(),
        source_providers,
        existing_global_tag_names,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::metadata::Metadata;
    use crate::models::sources::ExternalSource;
    use crate::models::tag::Tag;
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

    fn song_with_apple_source(apple_track_id: &str) -> Song {
        Song::builder()
            .song_id("song-apple".to_string())
            .metadata(
                Metadata::builder()
                    .title("Numb".to_string())
                    .artist("Linkin Park".to_string())
                    .album("Meteora".to_string())
                    .build(),
            )
            .global_tags(vec![Tag::builder().name("rock".to_string()).build()])
            .sources(vec![
                ExternalSource::builder()
                    .provider(SourceProvider::AppleMusic)
                    .track_id(apple_track_id.to_string())
                    .build(),
            ])
            .build()
            .normalized()
    }

    #[tokio::test]
    async fn service_generates_tags_for_small_batch_and_maps_to_internal_song_ids() {
        let apple_song = song_with_apple_source("am-111");
        let local_song = Song::builder()
            .song_id("song-local".to_string())
            .metadata(
                Metadata::builder()
                    .title("Basement Demo".to_string())
                    .artist("Local Band".to_string())
                    .album("Demo".to_string())
                    .build(),
            )
            .build()
            .normalized();

        let client = TestOpenAiClient {
            suggestions: vec![
                GeneratedSongTagSuggestions::builder()
                    .song_id("song-apple".to_string())
                    .suggested_tags(vec!["indie rock".to_string()])
                    .build(),
                GeneratedSongTagSuggestions::builder()
                    .song_id("song-local".to_string())
                    .suggested_tags(vec!["lo-fi".to_string()])
                    .build(),
            ],
        };

        let service = TagGenerationService::new(client);
        let response = service
            .generate_tags_for_songs(
                TagGenerationBatchRequest::builder()
                    .songs(vec![
                        TagGenerationSongRequest::builder()
                            .selection(SongSelection::ExternalSource {
                                provider: SourceProvider::AppleMusic,
                                track_id: " am-111 ".to_string(),
                            })
                            .build(),
                        TagGenerationSongRequest::builder()
                            .selection(SongSelection::InternalSongId {
                                song_id: "song-local".to_string(),
                            })
                            .build(),
                    ])
                    .requested_tag_count(5)
                    .build(),
                &[apple_song, local_song],
            )
            .await
            .expect("tag generation should succeed");

        assert_eq!(response.songs.len(), 2);
        assert!(
            response
                .songs
                .iter()
                .any(|song| song.song_id == "song-apple")
        );
        assert!(
            response
                .songs
                .iter()
                .any(|song| song.song_id == "song-local")
        );
    }

    #[tokio::test]
    async fn service_filters_existing_tags_and_normalized_duplicates() {
        let apple_song = song_with_apple_source("am-111");
        let client = TestOpenAiClient {
            suggestions: vec![
                GeneratedSongTagSuggestions::builder()
                    .song_id("song-apple".to_string())
                    .suggested_tags(vec![
                        " rock ".to_string(),
                        "ROCK".to_string(),
                        " alt   rock ".to_string(),
                        "".to_string(),
                    ])
                    .build(),
            ],
        };

        let service = TagGenerationService::new(client);
        let response = service
            .generate_tags_for_songs(
                TagGenerationBatchRequest::builder()
                    .songs(vec![
                        TagGenerationSongRequest::builder()
                            .selection(SongSelection::ExternalSource {
                                provider: SourceProvider::AppleMusic,
                                track_id: "am-111".to_string(),
                            })
                            .build(),
                    ])
                    .requested_tag_count(5)
                    .build(),
                &[apple_song],
            )
            .await
            .expect("tag generation should succeed");

        assert_eq!(response.songs.len(), 1);
        assert_eq!(
            response.songs[0].suggested_tags,
            vec!["alt rock".to_string()]
        );
    }

    #[test]
    fn openai_song_input_drops_empty_existing_tags() {
        let service = TagGenerationService::new(TestOpenAiClient {
            suggestions: Vec::new(),
        });

        let resolved_song = ResolvedTagGenerationSongInput::builder()
            .song_id("song-1".to_string())
            .existing_global_tag_names(vec!["".to_string(), "   ".to_string(), "indie".to_string()])
            .build();

        let openai_song = service.build_openai_song_input(&resolved_song);

        assert_eq!(
            openai_song.existing_global_tag_names,
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
            .existing_global_tag_names(vec![
                "Alt   Rock".to_string(),
                " alt rock ".to_string(),
                "dream pop".to_string(),
            ])
            .build();

        let openai_song = service.build_openai_song_input(&resolved_song);

        assert_eq!(
            openai_song.existing_global_tag_names,
            vec!["alt rock".to_string(), "dream pop".to_string()]
        );
    }

    #[test]
    fn openai_song_input_caps_existing_tags_at_prompt_limit() {
        let service = TagGenerationService::new(TestOpenAiClient {
            suggestions: Vec::new(),
        });

        let existing_global_tag_names: Vec<String> = (1..=40).map(|i| format!("Tag {i}")).collect();
        let resolved_song = ResolvedTagGenerationSongInput::builder()
            .song_id("song-1".to_string())
            .existing_global_tag_names(existing_global_tag_names)
            .build();

        let openai_song = service.build_openai_song_input(&resolved_song);

        assert_eq!(
            openai_song.existing_global_tag_names.len(),
            MAX_EXISTING_TAGS_IN_PROMPT
        );
        assert_eq!(openai_song.existing_global_tag_names[0], "tag 1");
        assert_eq!(
            openai_song.existing_global_tag_names[MAX_EXISTING_TAGS_IN_PROMPT - 1],
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
            .existing_global_tag_names(vec!["Jazz".to_string(), " evening ".to_string()])
            .build();

        let openai_song = service.build_openai_song_input(&resolved_song);

        assert_eq!(
            openai_song.existing_global_tag_names,
            vec!["jazz".to_string(), "evening".to_string()]
        );
    }
}
