use bon::Builder;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::metadata::Metadata;
use crate::models::sources::ExternalSource;
use crate::models::tag::Tag;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Builder)]
pub struct Song {
    #[builder(default = generate_song_id())]
    pub song_id: String,

    pub metadata: Metadata,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub global_tags: Vec<Tag>,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<ExternalSource>,
}

impl Default for Song {
    fn default() -> Self {
        Self {
            song_id: generate_song_id(),
            metadata: Metadata::default(),
            global_tags: Vec::new(),
            sources: Vec::new(),
        }
    }
}

impl Song {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.song_id.trim().is_empty() {
            return Err("song_id cannot be empty");
        }

        Ok(())
    }

    pub fn add_global_tag(&mut self, tag: Tag) {
        self.global_tags.push(tag);
        self.normalize_mut();
    }

    pub fn add_source(&mut self, source: ExternalSource) {
        self.sources.push(source);
        self.normalize_mut();
    }

    pub fn has_global_tags(&self) -> bool {
        !self.global_tags.is_empty()
    }

    pub fn has_sources(&self) -> bool {
        !self.sources.is_empty()
    }

    pub fn normalized(mut self) -> Self {
        self.normalize_mut();
        self
    }

    pub fn normalize_mut(&mut self) {
        self.song_id = self.song_id.trim().to_string();
        self.metadata.normalize_mut();

        for tag in &mut self.global_tags {
            tag.normalize_mut();
        }

        self.global_tags.retain(|tag| !tag.is_empty());
        self.global_tags.sort_by(|a, b| a.name.cmp(&b.name));
        self.global_tags.dedup_by(|a, b| a.name == b.name);

        for source in &mut self.sources {
            source.normalize_mut();
        }

        self.sources.sort_by(|a, b| {
            a.provider
                .cmp(&b.provider)
                .then_with(|| a.track_id.cmp(&b.track_id))
        });
        self.sources
            .dedup_by(|a, b| a.provider == b.provider && a.track_id == b.track_id);
    }
}

fn generate_song_id() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::sources::SourceProvider;

    #[test]
    fn default_creates_non_empty_internal_song_id() {
        let song = Song::default();

        assert!(!song.song_id.is_empty());
    }

    #[test]
    fn builder_builds_song_with_defaults() {
        let metadata = Metadata::builder()
            .title("Numb".to_string())
            .artist("Linkin Park".to_string())
            .build();

        let song = Song::builder()
            .metadata(metadata.clone())
            .build()
            .normalized();

        assert!(!song.song_id.is_empty());
        assert_eq!(song.metadata, metadata);
        assert!(song.global_tags.is_empty());
        assert!(song.sources.is_empty());
        assert!(song.validate().is_ok());
    }

    #[test]
    fn validate_rejects_empty_song_id() {
        let song = Song::builder()
            .song_id("   ".to_string())
            .metadata(Metadata::builder().title("Numb".to_string()).build())
            .build()
            .normalized();

        assert!(song.validate().is_err());
    }

    #[test]
    fn builder_deduplicates_global_tags_and_sources() {
        let rock = Tag::builder()
            .name(" rock ".to_string())
            .canonical_or_default(true)
            .build()
            .normalized();

        let rock_duplicate = Tag::builder()
            .name("rock".to_string())
            .build()
            .normalized();

        let spotify_123 = ExternalSource::builder()
            .provider(SourceProvider::Spotify)
            .track_id("123".to_string())
            .build()
            .normalized();

        let spotify_123_duplicate = ExternalSource::builder()
            .provider(SourceProvider::Spotify)
            .track_id(" 123 ".to_string())
            .build()
            .normalized();

        let song = Song::builder()
            .metadata(Metadata::builder().title("Numb".to_string()).build())
            .global_tags(vec![rock, rock_duplicate])
            .sources(vec![spotify_123, spotify_123_duplicate])
            .build()
            .normalized();

        assert_eq!(song.global_tags.len(), 1);
        assert_eq!(song.sources.len(), 1);
    }

    #[test]
    fn add_global_tag_and_source_work_with_normalization() {
        let mut song = Song::builder()
            .metadata(Metadata::builder().title("Numb".to_string()).build())
            .build()
            .normalized();

        song.add_global_tag(
            Tag::builder()
                .name(" alt   rock ".to_string())
                .canonical_or_default(true)
                .build()
                .normalized(),
        );

        song.add_source(
            ExternalSource::builder()
                .provider(SourceProvider::AppleMusic)
                .track_id(" abc ".to_string())
                .build()
                .normalized(),
        );

        assert_eq!(song.global_tags[0].name, "alt rock");
        assert_eq!(song.sources[0].track_id, "abc");
    }

    #[test]
    fn local_only_song_can_exist_without_apple_music_source() {
        let song = Song::builder()
            .metadata(Metadata::builder().title("Local Demo".to_string()).build())
            .build()
            .normalized();

        assert!(!song.song_id.is_empty());
        assert!(song.sources.is_empty());
        assert!(song.validate().is_ok());
    }

    #[test]
    fn has_global_tags_and_has_sources_work() {
        let mut song = Song::builder()
            .metadata(Metadata::builder().title("Numb".to_string()).build())
            .build()
            .normalized();

        assert!(!song.has_global_tags());
        assert!(!song.has_sources());

        song.add_global_tag(
            Tag::builder()
                .name("rock".to_string())
                .canonical_or_default(true)
                .build()
                .normalized(),
        );

        song.add_source(
            ExternalSource::builder()
                .provider(SourceProvider::AppleMusic)
                .track_id("123".to_string())
                .build()
                .normalized(),
        );

        assert!(song.has_global_tags());
        assert!(song.has_sources());
    }
}