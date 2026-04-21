use bon::Builder;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum SourceProvider {
    AppleMusic,
    Spotify,
    Local,
    Deezer,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Builder)]
pub struct ExternalSource {
    pub provider: SourceProvider,
    pub track_id: String,
}

impl ExternalSource {
    pub fn normalized(mut self) -> Self {
        self.normalize_mut();
        self
    }

    pub fn normalize_mut(&mut self) {
        self.track_id = self.track_id.trim().to_string();
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.track_id.trim().is_empty() {
            return Err("track_id cannot be empty");
        }

        Ok(())
    }
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
        assert_eq!(source.track_id, "12345");
        assert!(source.validate().is_ok());
    }

    #[test]
    fn validate_rejects_empty_track_id() {
        let source = ExternalSource::builder()
            .provider(SourceProvider::Spotify)
            .track_id("   ".to_string())
            .build()
            .normalized();

        assert!(source.validate().is_err());
    }

    #[test]
    fn apple_music_source_can_be_represented() {
        let source = ExternalSource::builder()
            .provider(SourceProvider::AppleMusic)
            .track_id("am-123".to_string())
            .build()
            .normalized();

        assert_eq!(source.provider, SourceProvider::AppleMusic);
        assert_eq!(source.track_id, "am-123");
        assert!(source.validate().is_ok());
    }
}
