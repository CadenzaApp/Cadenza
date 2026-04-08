use crate::models::metadata::Metadata;
use crate::models::sources::ExternalSource;
use crate::models::tag::Tag;
use crate::models::user_song_attributes::UserSongAttributes;

pub struct Song {
    pub metadata: Metadata,
    pub tags: Vec<Tag>,
    pub user_song_attributes: UserSongAttributes,
    pub sourced_from: Option<Vec<ExternalSource>>,
}