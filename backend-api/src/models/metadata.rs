use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Metadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<u32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_date: Option<NaiveDate>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explicit: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetadataValidationError {
    DurationMustBePositive,
    DurationTooLarge,
}

impl Display for MetadataValidationError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            MetadataValidationError::DurationMustBePositive => {
                write!(f, "duration must be greater than zero")
            }
            MetadataValidationError::DurationTooLarge => {
                write!(f, "duration is unrealistically large")
            }
        }
    }
}

impl Error for MetadataValidationError {}

impl Metadata {
    pub fn new(title: impl Into<String>, artist: impl Into<String>) -> Self {
        Self {
            title: Some(title.into()),
            artist: Some(artist.into()),
            ..Self::default()
        }
        .normalized()
    }

    pub fn with_album(mut self, album: impl Into<String>) -> Self {
        self.album = Some(album.into());
        self
    }

    pub fn with_duration(mut self, duration: u32) -> Self {
        self.duration = Some(duration);
        self
    }

    pub fn with_release_date(mut self, release_date: NaiveDate) -> Self {
        self.release_date = Some(release_date);
        self
    }

    pub fn with_explicit(mut self, explicit: bool) -> Self {
        self.explicit = Some(explicit);
        self
    }

    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.artist.is_none()
            && self.album.is_none()
            && self.duration.is_none()
            && self.release_date.is_none()
            && self.explicit.is_none()
    }

    pub fn normalized(mut self) -> Self {
        self.normalize_mut();
        self
    }

    pub fn normalize_mut(&mut self) {
        self.title = normalize_optional_string(self.title.take());
        self.artist = normalize_optional_string(self.artist.take());
        self.album = normalize_optional_string(self.album.take());
    }

    pub fn merge_missing_from(&mut self, fallback: &Metadata) {
        self.normalize_mut();
        let fallback = fallback.clone().normalized();

        if self.title.is_none() {
            self.title = fallback.title;
        }
        if self.artist.is_none() {
            self.artist = fallback.artist;
        }
        if self.album.is_none() {
            self.album = fallback.album;
        }
        if self.duration.is_none() {
            self.duration = fallback.duration;
        }
        if self.release_date.is_none() {
            self.release_date = fallback.release_date;
        }
        if self.explicit.is_none() {
            self.explicit = fallback.explicit;
        }
    }

    pub fn validate(&self) -> Result<(), MetadataValidationError> {
        if let Some(duration) = self.duration {
            if duration == 0 {
                return Err(MetadataValidationError::DurationMustBePositive);
            }

            if duration > 60 * 60 * 12 {
                return Err(MetadataValidationError::DurationTooLarge);
            }
        }

        Ok(())
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
    fn metadata_new_sets_required_fields() {
        let metadata = Metadata::new("Numb", "Linkin Park");

        assert_eq!(metadata.title.as_deref(), Some("Numb"));
        assert_eq!(metadata.artist.as_deref(), Some("Linkin Park"));
        assert!(metadata.album.is_none());
    }

    #[test]
    fn normalized_trims_and_removes_empty_strings() {
        let metadata = Metadata {
            title: Some("  Song Title  ".to_string()),
            artist: Some("  ".to_string()),
            album: Some("\nAlbum Name\t".to_string()),
            ..Metadata::default()
        };

        let normalized = metadata.normalized();

        assert_eq!(normalized.title.as_deref(), Some("Song Title"));
        assert_eq!(normalized.artist, None);
        assert_eq!(normalized.album.as_deref(), Some("Album Name"));
    }

    #[test]
    fn normalize_mut_trims_in_place() {
        let mut metadata = Metadata {
            title: Some("  Title  ".to_string()),
            artist: Some(" Artist ".to_string()),
            ..Metadata::default()
        };

        metadata.normalize_mut();

        assert_eq!(metadata.title.as_deref(), Some("Title"));
        assert_eq!(metadata.artist.as_deref(), Some("Artist"));
    }

    #[test]
    fn merge_missing_from_uses_fallback_values() {
        let mut metadata = Metadata {
            title: Some("Primary".to_string()),
            ..Metadata::default()
        };

        let fallback = Metadata::new("Fallback", "Artist")
            .with_album("Album")
            .with_duration(180)
            .with_explicit(true);

        metadata.merge_missing_from(&fallback);

        assert_eq!(metadata.title.as_deref(), Some("Primary"));
        assert_eq!(metadata.artist.as_deref(), Some("Artist"));
        assert_eq!(metadata.album.as_deref(), Some("Album"));
        assert_eq!(metadata.duration, Some(180));
        assert_eq!(metadata.explicit, Some(true));
    }

    #[test]
    fn merge_missing_from_treats_whitespace_as_missing() {
        let mut metadata = Metadata {
            title: Some("   ".to_string()),
            artist: None,
            ..Metadata::default()
        };

        let fallback = Metadata::new("Fallback Title", "Fallback Artist");

        metadata.merge_missing_from(&fallback);

        assert_eq!(metadata.title.as_deref(), Some("Fallback Title"));
        assert_eq!(metadata.artist.as_deref(), Some("Fallback Artist"));
    }

    #[test]
    fn is_empty_returns_true_for_default_metadata() {
        let metadata = Metadata::default();
        assert!(metadata.is_empty());
    }

    #[test]
    fn is_empty_returns_false_when_any_field_is_present() {
        let metadata = Metadata::new("Numb", "Linkin Park");
        assert!(!metadata.is_empty());
    }

    #[test]
    fn validate_rejects_zero_duration() {
        let metadata = Metadata::default().with_duration(0);
        let result = metadata.validate();

        assert_eq!(result, Err(MetadataValidationError::DurationMustBePositive));
    }

    #[test]
    fn validate_rejects_unreasonably_large_duration() {
        let metadata = Metadata::default().with_duration(60 * 60 * 12 + 1);
        let result = metadata.validate();

        assert_eq!(result, Err(MetadataValidationError::DurationTooLarge));
    }

    #[test]
    fn validate_accepts_normal_metadata() {
        let metadata = Metadata::new("Numb", "Linkin Park")
            .with_album("Meteora")
            .with_duration(185)
            .with_explicit(false);

        assert_eq!(metadata.validate(), Ok(()));
    }
}
