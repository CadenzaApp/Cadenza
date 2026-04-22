use bon::Builder;
use serde::{Deserialize, Serialize};

use crate::models::sources::SourceProvider;

pub const MINIMUM_REQUESTED_TAG_COUNT: usize = 1;
// A low maximum so we are capped on the backend and don't blow though credits. Can be changed later.
pub const MAXIMUM_REQUESTED_TAG_COUNT: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder)]
pub struct TagGenerationSongRequest {
    pub song_id: String,
    pub title: String,
    pub artist: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_provider: Option<SourceProvider>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_tag_count: Option<usize>,
}

impl TagGenerationSongRequest {
    pub fn validate(&self) -> Result<(), TagGenerationRequestError> {
        if self.song_id.trim().is_empty() {
            return Err(TagGenerationRequestError::MissingSongId);
        }

        if self.title.trim().is_empty() {
            return Err(TagGenerationRequestError::MissingTitle);
        }

        if self.artist.trim().is_empty() {
            return Err(TagGenerationRequestError::MissingArtist);
        }

        if let Some(count) = self.requested_tag_count {
            if !(MINIMUM_REQUESTED_TAG_COUNT..=MAXIMUM_REQUESTED_TAG_COUNT).contains(&count) {
                return Err(TagGenerationRequestError::InvalidRequestedTagCount);
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder)]
pub struct ResolvedTagGenerationSongInput {
    pub song_id: String,
    pub title: String,
    pub artist: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_provider: Option<SourceProvider>,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub existing_user_tag_names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder)]
pub struct OpenAiTagGenerationSongInput {
    pub song_id: String,
    pub title: String,
    pub artist: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_provider: Option<SourceProvider>,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub existing_user_tag_names: Vec<String>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TagGenerationRequestError {
    MissingSongId,
    MissingTitle,
    MissingArtist,
    InvalidRequestedTagCount,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trips_with_song_metadata() {
        let request = TagGenerationSongRequest::builder()
            .song_id("am-1".to_string())
            .title("Numb".to_string())
            .artist("Linkin Park".to_string())
            .album("Meteora".to_string())
            .maybe_source_provider(Some(SourceProvider::AppleMusic))
            .requested_tag_count(5)
            .build();

        let serialized = serde_json::to_string(&request).expect("serialize request");
        let deserialized: TagGenerationSongRequest =
            serde_json::from_str(&serialized).expect("deserialize request");

        assert_eq!(deserialized.song_id, "am-1");
        assert_eq!(deserialized.title, "Numb");
        assert_eq!(deserialized.artist, "Linkin Park");
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

    #[test]
    fn request_validation_rejects_missing_required_fields() {
        let request = TagGenerationSongRequest::builder()
            .song_id("   ".to_string())
            .title("".to_string())
            .artist("".to_string())
            .build();

        assert_eq!(
            request.validate(),
            Err(TagGenerationRequestError::MissingSongId)
        );
    }
}
