use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ExternalSource {
    pub source_name: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_track_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalSourceValidationError {
    EmptySourceName,
    SourceNameTooLong,
    SourceTrackIdTooLong,
}

impl Display for ExternalSourceValidationError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            ExternalSourceValidationError::EmptySourceName => {
                write!(f, "source name cannot be empty")
            }
            ExternalSourceValidationError::SourceNameTooLong => {
                write!(f, "source name is too long")
            }
            ExternalSourceValidationError::SourceTrackIdTooLong => {
                write!(f, "source track id is too long")
            }
        }
    }
}

impl Error for ExternalSourceValidationError {}

impl ExternalSource {
    pub fn new(source_name: impl Into<String>) -> Self {
        Self {
            source_name: source_name.into(),
            source_track_id: None,
        }
        .normalized()
    }

    pub fn with_source_track_id(mut self, source_track_id: impl Into<String>) -> Self {
        self.source_track_id = Some(source_track_id.into());
        self
    }

    pub fn normalized(mut self) -> Self {
        self.normalize_mut();
        self
    }

    pub fn normalize_mut(&mut self) {
        self.source_name = normalize_required_string(&self.source_name);
        self.source_track_id = normalize_optional_string(self.source_track_id.take());
    }

    pub fn has_track_id(&self) -> bool {
        self.source_track_id.is_some()
    }

    pub fn validate(&self) -> Result<(), ExternalSourceValidationError> {
        if self.source_name.is_empty() {
            return Err(ExternalSourceValidationError::EmptySourceName);
        }

        if self.source_name.len() > 100 {
            return Err(ExternalSourceValidationError::SourceNameTooLong);
        }

        if let Some(source_track_id) = &self.source_track_id {
            if source_track_id.len() > 255 {
                return Err(ExternalSourceValidationError::SourceTrackIdTooLong);
            }
        }

        Ok(())
    }
}

fn normalize_required_string(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|input| {
        let normalized = normalize_required_string(&input);
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

    #[test]
    fn new_normalizes_source_name() {
        let source = ExternalSource::new("  spotify  ");
        assert_eq!(source.source_name, "spotify");
        assert_eq!(source.source_track_id, None);
    }

    #[test]
    fn with_source_track_id_sets_track_id() {
        let source = ExternalSource::new("spotify").with_source_track_id(" 12345 ");

        assert_eq!(source.source_name, "spotify");
        assert_eq!(source.source_track_id.as_deref(), Some(" 12345 "));
    }

    #[test]
    fn normalized_trims_source_name_and_track_id() {
        let source = ExternalSource {
            source_name: "  apple   music  ".to_string(),
            source_track_id: Some("  abc123  ".to_string()),
        };

        let normalized = source.normalized();

        assert_eq!(normalized.source_name, "apple music");
        assert_eq!(normalized.source_track_id.as_deref(), Some("abc123"));
    }

    #[test]
    fn normalize_mut_removes_empty_track_id() {
        let mut source = ExternalSource {
            source_name: " lastfm ".to_string(),
            source_track_id: Some("   ".to_string()),
        };

        source.normalize_mut();

        assert_eq!(source.source_name, "lastfm");
        assert_eq!(source.source_track_id, None);
    }

    #[test]
    fn has_track_id_returns_true_when_present() {
        let source = ExternalSource::new("spotify").with_source_track_id("123");
        assert!(source.has_track_id());
    }

    #[test]
    fn has_track_id_returns_false_when_missing() {
        let source = ExternalSource::new("spotify");
        assert!(!source.has_track_id());
    }

    #[test]
    fn validate_rejects_empty_source_name() {
        let source = ExternalSource::new("   ");
        assert_eq!(
            source.validate(),
            Err(ExternalSourceValidationError::EmptySourceName)
        );
    }

    #[test]
    fn validate_rejects_overlong_source_name() {
        let source = ExternalSource::new("a".repeat(101));
        assert_eq!(
            source.validate(),
            Err(ExternalSourceValidationError::SourceNameTooLong)
        );
    }

    #[test]
    fn validate_rejects_overlong_source_track_id() {
        let source = ExternalSource::new("spotify").with_source_track_id("a".repeat(256));
        assert_eq!(
            source.validate(),
            Err(ExternalSourceValidationError::SourceTrackIdTooLong)
        );
    }

    #[test]
    fn validate_accepts_normal_source() {
        let source = ExternalSource::new("spotify").with_source_track_id("4uLU6hMCjMI75M1A2tKUQC");
        assert_eq!(source.validate(), Ok(()));
    }
}
