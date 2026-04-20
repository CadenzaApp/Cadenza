use std::collections::{HashMap, HashSet};

use crate::models::song::Song;
use crate::models::sources::SourceProvider;
use crate::models::tag_generation_model::{
    OpenAiTagGenerationRequest, OpenAiTagGenerationSongInput, ResolvedTagGenerationSongInput,
    TagGenerationBatchRequest, TagGenerationBatchResponse, TagGenerationSongResponse,
};
use crate::services::openai_client::{OpenAiClientError, OpenAiTagGenerator};
use crate::services::tag_normalizer::normalize_generated_tags_for_song;

const DEFAULT_REQUESTED_TAG_COUNT: usize = 5;

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

    pub fn generate_tags_for_songs(
        &self,
        request: TagGenerationBatchRequest,
        canonical_songs: &[Song],
    ) -> Result<TagGenerationBatchResponse, TagGenerationServiceError> {
        let requested_tag_count = request
            .requested_tag_count
            .unwrap_or(self.default_requested_tag_count);

        if requested_tag_count == 0 {
            return Err(TagGenerationServiceError::InvalidRequestedTagCount);
        }

        let resolved_inputs = self.resolve_requested_songs(&request, canonical_songs)?;
        let openai_request = self.build_openai_request(&resolved_inputs, requested_tag_count);

        let openai_response = self
            .openai_client
            .generate_tag_suggestions(openai_request)
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
            .map(|song| {
                OpenAiTagGenerationSongInput {
                    song_id: song.song_id.clone(),
                    title: song.title.clone(),
                    artist: song.artist.clone(),
                    album: song.album.clone(),
                    source_providers: song.source_providers.clone(),
                    existing_global_tag_names: song.existing_global_tag_names.clone(),
                }
            })
            .collect();

        OpenAiTagGenerationRequest::builder()
            .songs(songs)
            .requested_tag_count(requested_tag_count)
            .build()
    }

    fn resolve_requested_songs(
        &self,
        request: &TagGenerationBatchRequest,
        canonical_songs: &[Song],
    ) -> Result<Vec<ResolvedTagGenerationSongInput>, TagGenerationServiceError> {
        let song_ids = normalize_identifier_list(&request.song_ids);
        let apple_music_song_ids = normalize_identifier_list(&request.apple_music_song_ids);

        if song_ids.is_empty() && apple_music_song_ids.is_empty() {
            return Err(TagGenerationServiceError::EmptySelection);
        }

        let mut missing_song_ids = Vec::new();
        let mut missing_apple_music_song_ids = Vec::new();
        let mut resolved_by_song_id: HashMap<String, ResolvedTagGenerationSongInput> =
            HashMap::new();

        for song_id in song_ids {
            match canonical_songs.iter().find(|song| song.song_id == song_id) {
                Some(song) => {
                    resolved_by_song_id.insert(song.song_id.clone(), resolved_input_from_song(song));
                }
                None => missing_song_ids.push(song_id),
            }
        }

        for apple_music_song_id in apple_music_song_ids {
            match canonical_songs.iter().find(|song| {
                song.sources.iter().any(|source| {
                    source.provider == SourceProvider::AppleMusic
                        && source.track_id == apple_music_song_id
                })
            }) {
                Some(song) => {
                    resolved_by_song_id.insert(song.song_id.clone(), resolved_input_from_song(song));
                }
                None => missing_apple_music_song_ids.push(apple_music_song_id),
            }
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

fn normalize_identifier_list(ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized_ids = Vec::new();

    for raw in ids {
        let normalized = raw.trim();
        if normalized.is_empty() {
            continue;
        }

        if seen.insert(normalized.to_string()) {
            normalized_ids.push(normalized.to_string());
        }
    }

    normalized_ids
}

fn resolved_input_from_song(song: &Song) -> ResolvedTagGenerationSongInput {
    let mut source_providers: Vec<SourceProvider> = song.sources.iter().map(|s| s.provider).collect();
    source_providers.sort();
    source_providers.dedup();

    let existing_global_tag_names = song.global_tags.iter().map(|tag| tag.name.clone()).collect();

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

    #[derive(Debug, Clone)]
    struct TestOpenAiClient {
        suggestions: Vec<GeneratedSongTagSuggestions>,
    }

    impl OpenAiTagGenerator for TestOpenAiClient {
        fn generate_tag_suggestions(
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
            .sources(vec![ExternalSource::builder()
                .provider(SourceProvider::AppleMusic)
                .track_id(apple_track_id.to_string())
                .build()])
            .build()
            .normalized()
    }

    #[test]
    fn service_generates_tags_for_small_batch_and_maps_to_internal_song_ids() {
        let apple_song = song_with_apple_source("am-111");
        let local_song = Song::builder()
            .song_id("song-local".to_string())
            .metadata(
                Metadata::builder()
                    .title("Basement Demo".to_string())
                    .artist("Local Band".to_string())
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
                    .apple_music_song_ids(vec![" am-111 ".to_string()])
                    .song_ids(vec!["song-local".to_string()])
                    .requested_tag_count(5)
                    .build(),
                &[apple_song, local_song],
            )
            .expect("tag generation should succeed");

        assert_eq!(response.songs.len(), 2);
        assert!(response.songs.iter().any(|song| song.song_id == "song-apple"));
        assert!(response.songs.iter().any(|song| song.song_id == "song-local"));
    }

    #[test]
    fn service_filters_existing_tags_and_normalized_duplicates() {
        let apple_song = song_with_apple_source("am-111");
        let client = TestOpenAiClient {
            suggestions: vec![GeneratedSongTagSuggestions::builder()
                .song_id("song-apple".to_string())
                .suggested_tags(vec![
                    " rock ".to_string(),
                    "ROCK".to_string(),
                    " alt   rock ".to_string(),
                    "".to_string(),
                ])
                .build()],
        };

        let service = TagGenerationService::new(client);
        let response = service
            .generate_tags_for_songs(
                TagGenerationBatchRequest::builder()
                    .apple_music_song_ids(vec!["am-111".to_string()])
                    .requested_tag_count(5)
                    .build(),
                &[apple_song],
            )
            .expect("tag generation should succeed");

        assert_eq!(response.songs.len(), 1);
        assert_eq!(response.songs[0].suggested_tags, vec!["alt rock".to_string()]);
    }
}
