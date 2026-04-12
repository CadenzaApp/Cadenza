use bon::Builder;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum SourceProvider {
    AppleMusic,
    Spotify,
    Deezer,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Builder)]
pub struct ExternalSource {
    pub provider: SourceProvider,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_id: Option<String>,
}

impl ExternalSource {
    pub fn normalized(mut self) -> Self {
        self.normalize_mut();
        self
    }

    pub fn normalize_mut(&mut self) {
        self.track_id = normalize_optional_string(self.track_id.take());
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|input| {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builder_normalizes_track_id() {
        let source = ExternalSource::builder()
            .provider(SourceProvider::Spotify)
            .track_id("  12345 ".to_string())
            .build()
            .normalized();

        assert_eq!(source.provider, SourceProvider::Spotify);
        assert_eq!(source.track_id.as_deref(), Some("12345"));
    }

    #[test]
    fn builder_drops_empty_track_id() {
        let source = ExternalSource::builder()
            .provider(SourceProvider::AppleMusic)
            .track_id("   ".to_string())
            .build()
            .normalized();

        assert_eq!(source.track_id, None);
    }

    #[test]
    fn builder_drops_empty_track_id2() {
        let source = ExternalSource::builder()
            .provider(SourceProvider::AppleMusic)
            .track_id("".to_string())
            .build()
            .normalized();

        assert_eq!(source.track_id, None);
    }
}
