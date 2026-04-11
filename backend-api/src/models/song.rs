use crate::models::metadata::Metadata;
use crate::models::sources::ExternalSource;
use crate::models::tag::Tag;
use crate::models::user_song_attributes::UserSongAttributes;
use serde::{Deserialize, Serialize};

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

impl Song {
    pub fn builder(metadata: Metadata) -> SongBuilder {
        SongBuilder::new(metadata)
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

#[derive(Debug, Clone)]
pub struct SongBuilder {
    metadata: Metadata,
    tags: Vec<Tag>,
    user_song_attributes: UserSongAttributes,
    sources: Vec<ExternalSource>,
}

impl SongBuilder {
    fn new(metadata: Metadata) -> Self {
        Self {
            metadata: metadata.normalized(),
            tags: Vec::new(),
            user_song_attributes: UserSongAttributes::default(),
            sources: Vec::new(),
        }
    }

    pub fn tag(mut self, tag: Tag) -> Self {
        self.tags.push(tag);
        self
    }

    pub fn tags(mut self, tags: impl IntoIterator<Item = Tag>) -> Self {
        self.tags.extend(tags);
        self
    }

    pub fn source(mut self, source: ExternalSource) -> Self {
        self.sources.push(source);
        self
    }

    pub fn sources(mut self, sources: impl IntoIterator<Item = ExternalSource>) -> Self {
        self.sources.extend(sources);
        self
    }

    pub fn user_song_attributes(mut self, user_song_attributes: UserSongAttributes) -> Self {
        self.user_song_attributes = user_song_attributes;
        self
    }

    pub fn build(self) -> Song {
        Song {
            metadata: self.metadata,
            tags: self.tags,
            user_song_attributes: self.user_song_attributes,
            sources: self.sources,
        }
        .normalized()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::sources::SourceProvider;

    #[test]
    fn builder_builds_song_with_defaults() {
        let metadata = Metadata::builder()
            .title("Numb")
            .artist("Linkin Park")
            .build();
        let song = Song::builder(metadata.clone()).build();

        assert_eq!(song.metadata, metadata);
        assert!(song.tags.is_empty());
        assert!(song.sources.is_empty());
        assert_eq!(song.user_song_attributes, UserSongAttributes::default());
    }

    #[test]
    fn builder_deduplicates_tags_and_sources() {
        let rock = Tag::builder().name(" rock ").build().unwrap();
        let rock_duplicate = Tag::builder().name("rock").build().unwrap();
        let spotify_123 = ExternalSource::builder(SourceProvider::Spotify)
            .track_id("123")
            .build();
        let spotify_123_duplicate = ExternalSource::builder(SourceProvider::Spotify)
            .track_id(" 123 ")
            .build();

        let song = Song::builder(Metadata::builder().title("Numb").build())
            .tags(vec![rock, rock_duplicate])
            .sources(vec![spotify_123, spotify_123_duplicate])
            .build();

        assert_eq!(song.tags.len(), 1);
        assert_eq!(song.sources.len(), 1);
    }

    #[test]
    fn add_tag_and_source_work_with_normalization() {
        let mut song = Song::builder(Metadata::builder().title("Numb").build()).build();

        song.add_tag(Tag::builder().name(" alt   rock ").build().unwrap());
        song.add_source(
            ExternalSource::builder(SourceProvider::AppleMusic)
                .track_id(" abc ")
                .build(),
        );

        assert_eq!(song.tags[0].name, "alt rock");
        assert_eq!(song.sources[0].track_id.as_deref(), Some("abc"));
    }
}
