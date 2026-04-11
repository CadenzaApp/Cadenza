use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
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
    pub fn builder() -> MetadataBuilder {
        MetadataBuilder::default()
    }

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

#[derive(Debug, Clone, Default)]
pub struct MetadataBuilder {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_seconds: Option<u32>,
    release_date: Option<NaiveDate>,
    explicit: Option<bool>,
}

impl MetadataBuilder {
    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn artist(mut self, artist: impl Into<String>) -> Self {
        self.artist = Some(artist.into());
        self
    }

    pub fn album(mut self, album: impl Into<String>) -> Self {
        self.album = Some(album.into());
        self
    }

    pub fn duration_seconds(mut self, duration_seconds: u32) -> Self {
        self.duration_seconds = Some(duration_seconds);
        self
    }

    pub fn release_date(mut self, release_date: NaiveDate) -> Self {
        self.release_date = Some(release_date);
        self
    }

    pub fn explicit(mut self, explicit: bool) -> Self {
        self.explicit = Some(explicit);
        self
    }

    pub fn build(self) -> Metadata {
        Metadata {
            title: self.title,
            artist: self.artist,
            album: self.album,
            duration_seconds: self.duration_seconds,
            release_date: self.release_date,
            explicit: self.explicit,
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
    fn builder_normalizes_strings() {
        let metadata = Metadata::builder()
            .title("  Numb  ")
            .artist("  Linkin Park ")
            .album("  Meteora\t")
            .build();

        assert_eq!(metadata.title.as_deref(), Some("Numb"));
        assert_eq!(metadata.artist.as_deref(), Some("Linkin Park"));
        assert_eq!(metadata.album.as_deref(), Some("Meteora"));
    }

    #[test]
    fn builder_drops_zero_duration() {
        let metadata = Metadata::builder().duration_seconds(0).build();
        assert_eq!(metadata.duration_seconds, None);
    }

    #[test]
    fn merge_missing_from_fills_only_missing_values() {
        let mut primary = Metadata::builder().title("Numb").build();
        let fallback = Metadata::builder()
            .title("Fallback title")
            .artist("Linkin Park")
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
