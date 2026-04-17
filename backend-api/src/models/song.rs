use bon::Builder;
use serde::{Deserialize, Serialize};

use crate::models::metadata::Metadata;
use crate::models::sources::ExternalSource;
use crate::models::tag::Tag;
use crate::models::user_song_attributes::UserSongAttributes;

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Builder)]
pub struct Song {
    pub metadata: Metadata,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<Tag>,

    #[builder(default)]
    #[serde(default)]
    pub user_song_attributes: UserSongAttributes,

    #[builder(default)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<ExternalSource>,
}

impl Song {
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
        self.metadata.normalize_mut();

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
            a.provider
                .cmp(&b.provider)
                .then_with(|| a.track_id.cmp(&b.track_id))
        });
        self.sources
            .dedup_by(|a, b| a.provider == b.provider && a.track_id == b.track_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::sources::SourceProvider;

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

        assert_eq!(song.metadata, metadata);
        assert!(song.tags.is_empty());
        assert!(song.sources.is_empty());
        assert_eq!(song.user_song_attributes, UserSongAttributes::default());
    }

    #[test]
    fn builder_deduplicates_tags_and_sources() {
        let rock = Tag::builder()
            .name(" rock ".to_string())
            .canonical_or_default(true)
            .build()
            .normalized();
        let rock_duplicate = Tag::builder().name("rock".to_string()).build().normalized();
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
            .tags(vec![rock, rock_duplicate])
            .sources(vec![spotify_123, spotify_123_duplicate])
            .build()
            .normalized();

        assert_eq!(song.tags.len(), 1);
        assert_eq!(song.sources.len(), 1);
    }

    #[test]
    fn add_tag_and_source_work_with_normalization() {
        let mut song = Song::builder()
            .metadata(Metadata::builder().title("Numb".to_string()).build())
            .build()
            .normalized();

        song.add_tag(
            Tag::builder()
                .name(" alt   rock ".to_string())
                .user_created(false)
                .llm_suggested(false)
                .llm_approved(false)
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

        assert_eq!(song.tags[0].name, "alt rock");
        assert_eq!(song.sources[0].track_id.as_deref(), Some("abc"));
    }
}
