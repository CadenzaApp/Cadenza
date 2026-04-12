use bon::Builder;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Builder)]
pub struct Metadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<u32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_date: Option<NaiveDate>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explicit: Option<bool>,
}

impl Metadata {
    pub fn normalized(mut self) -> Self {
        self.normalize_mut();
        self
    }

    pub fn normalize_mut(&mut self) {
        self.title = normalize_optional_string(self.title.take());
        self.artist = normalize_optional_string(self.artist.take());
        self.album = normalize_optional_string(self.album.take());

        if self.duration_seconds == Some(0) {
            self.duration_seconds = None;
        }
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
        if self.duration_seconds.is_none() {
            self.duration_seconds = fallback.duration_seconds;
        }
        if self.release_date.is_none() {
            self.release_date = fallback.release_date;
        }
        if self.explicit.is_none() {
            self.explicit = fallback.explicit;
        }
    }

    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.artist.is_none()
            && self.album.is_none()
            && self.duration_seconds.is_none()
            && self.release_date.is_none()
            && self.explicit.is_none()
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
    fn builder_normalizes_strings() {
        let metadata = Metadata::builder()
            .title("  Numb  ".to_string())
            .artist("  Linkin Park ".to_string())
            .album("  Meteora\t".to_string())
            .build()
            .normalized();

        assert_eq!(metadata.title.as_deref(), Some("Numb"));
        assert_eq!(metadata.artist.as_deref(), Some("Linkin Park"));
        assert_eq!(metadata.album.as_deref(), Some("Meteora"));
    }

    #[test]
    fn builder_drops_zero_duration() {
        let metadata = Metadata::builder().duration_seconds(0).build().normalized();
        assert_eq!(metadata.duration_seconds, None);
    }

    #[test]
    fn merge_missing_from_fills_only_missing_values() {
        let mut primary = Metadata::builder().title("Numb".to_string()).build();
        let fallback = Metadata::builder()
            .title("Fallback title".to_string())
            .artist("Linkin Park".to_string())
            .duration_seconds(185)
            .build();

        primary.merge_missing_from(&fallback);

        assert_eq!(primary.title.as_deref(), Some("Numb"));
        assert_eq!(primary.artist.as_deref(), Some("Linkin Park"));
        assert_eq!(primary.duration_seconds, Some(185));
    }

    #[test]
    fn is_empty_returns_true_for_default_metadata() {
        assert!(Metadata::default().is_empty());
    }
}
