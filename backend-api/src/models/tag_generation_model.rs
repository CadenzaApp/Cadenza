use bon::Builder;
use serde::{Deserialize, Serialize};

use crate::models::sources::SourceProvider;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder, Default)]
pub struct TagGenerationBatchRequest {
    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub song_ids: Vec<String>,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub apple_music_song_ids: Vec<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_tag_count: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder)]
pub struct ResolvedTagGenerationSongInput {
    pub song_id: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_providers: Vec<SourceProvider>,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub existing_global_tag_names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder)]
pub struct OpenAiTagGenerationSongInput {
    pub song_id: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_providers: Vec<SourceProvider>,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub existing_global_tag_names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder)]
pub struct OpenAiTagGenerationRequest {
    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub songs: Vec<OpenAiTagGenerationSongInput>,

    pub requested_tag_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder)]
pub struct GeneratedSongTagSuggestions {
    pub song_id: String,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub suggested_tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder, Default)]
pub struct OpenAiTagGenerationResponse {
    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub suggestions: Vec<GeneratedSongTagSuggestions>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder)]
pub struct TagGenerationSongResponse {
    pub song_id: String,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub suggested_tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder, Default)]
pub struct TagGenerationBatchResponse {
    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub songs: Vec<TagGenerationSongResponse>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TagGenerationRequestError {
    EmptySelection,
    InvalidRequestedTagCount,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trips_through_json() {
        let request = TagGenerationBatchRequest::builder()
            .song_ids(vec!["song-1".to_string()])
            .apple_music_song_ids(vec!["am-1".to_string()])
            .requested_tag_count(5)
            .build();

        let serialized = serde_json::to_string(&request).expect("serialize request");
        let deserialized: TagGenerationBatchRequest =
            serde_json::from_str(&serialized).expect("deserialize request");

        assert_eq!(deserialized.song_ids, vec!["song-1".to_string()]);
        assert_eq!(deserialized.apple_music_song_ids, vec!["am-1".to_string()]);
        assert_eq!(deserialized.requested_tag_count, Some(5));
    }

    #[test]
    fn generated_suggestion_model_maps_song_id_and_tags() {
        let suggestion = GeneratedSongTagSuggestions::builder()
            .song_id("song-123".to_string())
            .suggested_tags(vec!["rock".to_string(), "alt".to_string()])
            .build();

        assert_eq!(suggestion.song_id, "song-123");
        assert_eq!(suggestion.suggested_tags.len(), 2);
    }
}
