use crate::models::metadata::{Metadata, MetadataValidationError};
use crate::models::sources::{ExternalSource, ExternalSourceValidationError};
use crate::models::tag::{Tag, TagValidationError};
use crate::models::user_song_attributes::{UserSongAttributes, UserSongAttributesValidationError};
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Song {
    pub metadata: Metadata,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<Tag>,

    #[serde(default)]
    pub user_song_attributes: UserSongAttributes,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<ExternalSource>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SongValidationError {
    Metadata(MetadataValidationError),
    Tag(TagValidationError),
    ExternalSource(ExternalSourceValidationError),
    UserSongAttributes(UserSongAttributesValidationError),
}

impl Display for SongValidationError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            SongValidationError::Metadata(err) => write!(f, "metadata validation failed: {err}"),
            SongValidationError::Tag(err) => write!(f, "tag validation failed: {err}"),
            SongValidationError::ExternalSource(err) => {
                write!(f, "external source validation failed: {err}")
            }
            SongValidationError::UserSongAttributes(err) => {
                write!(f, "user song attributes validation failed: {err}")
            }
        }
    }
}

impl Error for SongValidationError {}

impl From<MetadataValidationError> for SongValidationError {
    fn from(value: MetadataValidationError) -> Self {
        SongValidationError::Metadata(value)
    }
}

impl From<TagValidationError> for SongValidationError {
    fn from(value: TagValidationError) -> Self {
        SongValidationError::Tag(value)
    }
}

impl From<ExternalSourceValidationError> for SongValidationError {
    fn from(value: ExternalSourceValidationError) -> Self {
        SongValidationError::ExternalSource(value)
    }
}

impl From<UserSongAttributesValidationError> for SongValidationError {
    fn from(value: UserSongAttributesValidationError) -> Self {
        SongValidationError::UserSongAttributes(value)
    }
}

impl Song {
    pub fn new(metadata: Metadata) -> Self {
        Self {
            metadata: metadata.normalized(),
            ..Self::default()
        }
    }

    pub fn with_tags(mut self, tags: Vec<Tag>) -> Self {
        self.tags = tags;
        self.normalize_mut();
        self
    }

    pub fn with_user_song_attributes(mut self, user_song_attributes: UserSongAttributes) -> Self {
        self.user_song_attributes = user_song_attributes;
        self
    }

    pub fn with_sources(mut self, sources: Vec<ExternalSource>) -> Self {
        self.sources = sources;
        self.normalize_mut();
        self
    }

    pub fn add_tag(&mut self, tag: Tag) {
        self.tags.push(tag);
        self.normalize_mut();
    }

    pub fn add_source(&mut self, source: ExternalSource) {
        self.sources.push(source);
        self.normalize_mut();
    }

    pub fn has_tags(&self) -> bool {
        !self.tags.is_empty()
    }

    pub fn has_sources(&self) -> bool {
        !self.sources.is_empty()
    }

    pub fn normalized(mut self) -> Self {
        self.normalize_mut();
        self
    }

    pub fn normalize_mut(&mut self) {
        self.metadata = self.metadata.clone().normalized();

        for tag in &mut self.tags {
            tag.normalize_mut();
        }

        self.tags.retain(|tag| !tag.is_empty());
        self.tags.sort_by(|a, b| a.name.cmp(&b.name));
        self.tags.dedup_by(|a, b| a.name == b.name);

        for source in &mut self.sources {
            source.normalize_mut();
        }

        self.sources.sort_by(|a, b| {
            a.source_name
                .cmp(&b.source_name)
                .then_with(|| a.source_track_id.cmp(&b.source_track_id))
        });

        self.sources.dedup_by(|a, b| {
            a.source_name == b.source_name && a.source_track_id == b.source_track_id
        });
    }

    pub fn validate(&self) -> Result<(), SongValidationError> {
        self.metadata.validate()?;
        self.user_song_attributes.validate()?;

        for tag in &self.tags {
            tag.validate()?;
        }

        for source in &self.sources {
            source.validate()?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::metadata::Metadata;
    use crate::models::sources::ExternalSource;
    use crate::models::tag::Tag;

    #[test]
    fn new_sets_metadata_and_defaults_other_fields() {
        let metadata = Metadata::new("Numb", "Linkin Park");
        let song = Song::new(metadata.clone());

        assert_eq!(song.metadata, metadata);
        assert!(song.tags.is_empty());
        assert!(song.sources.is_empty());
        assert_eq!(song.user_song_attributes, UserSongAttributes::default());
    }

    #[test]
    fn add_tag_adds_and_normalizes_tag() {
        let mut song = Song::new(Metadata::new("Numb", "Linkin Park"));

        song.add_tag(Tag::new("  alt   rock  "));

        assert_eq!(song.tags.len(), 1);
        assert_eq!(song.tags[0].name, "alt rock");
    }

    #[test]
    fn add_source_adds_and_normalizes_source() {
        let mut song = Song::new(Metadata::new("Numb", "Linkin Park"));

        song.add_source(ExternalSource::new("  spotify  ").with_source_track_id(" 123 "));

        assert_eq!(song.sources.len(), 1);
        assert_eq!(song.sources[0].source_name, "spotify");
        assert_eq!(song.sources[0].source_track_id.as_deref(), Some("123"));
    }

    #[test]
    fn normalize_mut_deduplicates_tags() {
        let mut song = Song::new(Metadata::new("Numb", "Linkin Park")).with_tags(vec![
            Tag::new("rock"),
            Tag::new("  rock  "),
            Tag::new("alt rock"),
        ]);

        song.normalize_mut();

        assert_eq!(song.tags.len(), 2);
        assert_eq!(song.tags[0].name, "alt rock");
        assert_eq!(song.tags[1].name, "rock");
    }

    #[test]
    fn normalize_mut_removes_empty_tags() {
        let mut song = Song::new(Metadata::new("Numb", "Linkin Park")).with_tags(vec![
            Tag::new(""),
            Tag::new("   "),
            Tag::new("electronic"),
        ]);

        song.normalize_mut();

        assert_eq!(song.tags.len(), 1);
        assert_eq!(song.tags[0].name, "electronic");
    }

    #[test]
    fn normalize_mut_deduplicates_sources() {
        let mut song = Song::new(Metadata::new("Numb", "Linkin Park")).with_sources(vec![
            ExternalSource::new("spotify").with_source_track_id("123"),
            ExternalSource::new(" spotify ").with_source_track_id(" 123 "),
            ExternalSource::new("apple_music").with_source_track_id("abc"),
        ]);

        song.normalize_mut();

        assert_eq!(song.sources.len(), 2);
    }

    #[test]
    fn has_tags_and_has_sources_work() {
        let mut song = Song::new(Metadata::new("Numb", "Linkin Park"));

        assert!(!song.has_tags());
        assert!(!song.has_sources());

        song.add_tag(Tag::new("rock"));
        song.add_source(ExternalSource::new("spotify"));

        assert!(song.has_tags());
        assert!(song.has_sources());
    }

    #[test]
    fn validate_accepts_valid_song() {
        let song = Song::new(Metadata::new("Numb", "Linkin Park"))
            .with_tags(vec![Tag::new("rock"), Tag::new("alternative")])
            .with_sources(vec![
                ExternalSource::new("spotify").with_source_track_id("123"),
                ExternalSource::new("apple_music").with_source_track_id("abc"),
            ]);

        assert_eq!(song.validate(), Ok(()));
    }

    #[test]
    fn validate_rejects_invalid_source() {
        let song = Song::new(Metadata::new("Numb", "Linkin Park"))
            .with_sources(vec![ExternalSource::new("")]);

        assert!(matches!(
            song.validate(),
            Err(SongValidationError::ExternalSource(_))
        ));
    }
}
