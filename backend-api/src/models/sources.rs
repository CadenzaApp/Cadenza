use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum SourceProvider {
    AppleMusic,
    Spotify,
    Deezer,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ExternalSource {
    pub provider: SourceProvider,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_id: Option<String>,
}

impl ExternalSource {
    pub fn builder(provider: SourceProvider) -> ExternalSourceBuilder {
        ExternalSourceBuilder::new(provider)
    }

    pub fn normalized(mut self) -> Self {
        self.normalize_mut();
        self
    }

    pub fn normalize_mut(&mut self) {
        self.track_id = normalize_optional_string(self.track_id.take());
    }
}

#[derive(Debug, Clone)]
pub struct ExternalSourceBuilder {
    provider: SourceProvider,
    track_id: Option<String>,
}

impl ExternalSourceBuilder {
    fn new(provider: SourceProvider) -> Self {
        Self {
            provider,
            track_id: None,
        }
    }

    pub fn track_id(mut self, track_id: impl Into<String>) -> Self {
        self.track_id = Some(track_id.into());
        self
    }

    pub fn build(self) -> ExternalSource {
        ExternalSource {
            provider: self.provider,
            track_id: self.track_id,
        }
        .normalized()
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
        let source = ExternalSource::builder(SourceProvider::Spotify)
            .track_id("  12345 ")
            .build();

        assert_eq!(source.provider, SourceProvider::Spotify);
        assert_eq!(source.track_id.as_deref(), Some("12345"));
    }

    #[test]
    fn builder_drops_empty_track_id() {
        let source = ExternalSource::builder(SourceProvider::AppleMusic)
            .track_id("   ")
            .build();

        assert_eq!(source.track_id, None);
    }
}
