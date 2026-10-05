use serde::Serialize;

use crate::db::entity::metadata_song_tags_applied;
use crate::routes::json::{query::MetadataKey, tag::TagType};

/// One piece of a song's stored Apple Music metadata, shown as a read-only tag.
///
/// `key` is the same key a `metadata` query filter takes, so what a song shows is what a
/// query matches on. `type` says how to read `value`, the same as for an attribute tag.
///
/// ```json
/// {"key": "duration", "type": "number", "value": "225000"}
/// ```
#[derive(Serialize, Debug, PartialEq)]
pub struct MetadataTag {
    pub key: MetadataKey,
    #[serde(rename = "type")]
    pub tag_type: TagType,
    pub value: String,
}

/// The metadata tags a stored row shows, in [`MetadataKey`] order. A field with no value
/// is left out. A row Apple had no catalog entry for has none at all.
///
/// - `title`, `artist`, `album`: text
/// - `genre`: text, every genre joined with `", "`
/// - `release_date`: date, `YYYY-MM-DD`
/// - `duration`: number, in milliseconds
/// - `explicit`: checkbox. True when Apple rates the song explicit, false otherwise, which
///   is what a query's `is_false` matches too
pub fn metadata_tags_of(row: &metadata_song_tags_applied::Model) -> Vec<MetadataTag> {
    if !row.found {
        return Vec::new();
    }

    let text = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    let genres = (!row.genre_names.is_empty()).then(|| row.genre_names.join(", "));
    let explicit = row.content_rating.as_deref() == Some("explicit");

    [
        (MetadataKey::Title, TagType::Text, text(&row.name)),
        (MetadataKey::Artist, TagType::Text, text(&row.artist_name)),
        (MetadataKey::Album, TagType::Text, text(&row.album_name)),
        (MetadataKey::Genre, TagType::Text, genres),
        (
            MetadataKey::ReleaseDate,
            TagType::Date,
            row.release_date
                .map(|day| day.format("%Y-%m-%d").to_string()),
        ),
        (
            MetadataKey::Duration,
            TagType::Number,
            row.duration_in_millis.map(|millis| millis.to_string()),
        ),
        (
            MetadataKey::Explicit,
            TagType::Checkbox,
            Some(explicit.to_string()),
        ),
    ]
    .into_iter()
    .filter_map(|(key, tag_type, value)| {
        value.map(|value| MetadataTag {
            key,
            tag_type,
            value,
        })
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use chrono::{NaiveDate, Utc};

    use super::*;

    fn row() -> metadata_song_tags_applied::Model {
        metadata_song_tags_applied::Model {
            song_id: "1".into(),
            found: true,
            name: Some("Purple Rain".into()),
            artist_name: Some("Prince".into()),
            album_name: Some("Purple Rain".into()),
            album_id: Some("10".into()),
            duration_in_millis: Some(521_000),
            genre_names: vec!["Pop".into(), "R&B/Soul".into()],
            release_date: NaiveDate::from_ymd_opt(1984, 6, 25),
            content_rating: Some("clean".into()),
            fetched_at: Utc::now().fixed_offset(),
        }
    }

    fn shown(row: &metadata_song_tags_applied::Model) -> Vec<(MetadataKey, TagType, String)> {
        metadata_tags_of(row)
            .into_iter()
            .map(|tag| (tag.key, tag.tag_type, tag.value))
            .collect()
    }

    #[test]
    fn a_found_row_shows_every_field_typed() {
        assert_eq!(
            shown(&row()),
            vec![
                (MetadataKey::Title, TagType::Text, "Purple Rain".into()),
                (MetadataKey::Artist, TagType::Text, "Prince".into()),
                (MetadataKey::Album, TagType::Text, "Purple Rain".into()),
                (MetadataKey::Genre, TagType::Text, "Pop, R&B/Soul".into()),
                (MetadataKey::ReleaseDate, TagType::Date, "1984-06-25".into()),
                (MetadataKey::Duration, TagType::Number, "521000".into()),
                (MetadataKey::Explicit, TagType::Checkbox, "false".into()),
            ]
        );
    }

    #[test]
    fn explicit_is_true_only_for_an_explicit_rating() {
        let mut explicit = row();
        explicit.content_rating = Some("explicit".into());
        let mut unrated = row();
        unrated.content_rating = None;

        let value_of = |row: &metadata_song_tags_applied::Model| {
            metadata_tags_of(row)
                .into_iter()
                .find(|tag| tag.key == MetadataKey::Explicit)
                .unwrap()
                .value
        };
        assert_eq!(value_of(&explicit), "true");
        assert_eq!(value_of(&unrated), "false");
    }

    #[test]
    fn empty_fields_are_left_out() {
        let mut sparse = row();
        sparse.album_name = Some("  ".into());
        sparse.genre_names = Vec::new();
        sparse.release_date = None;
        sparse.duration_in_millis = None;

        let keys: Vec<MetadataKey> = shown(&sparse).into_iter().map(|(key, ..)| key).collect();
        assert_eq!(
            keys,
            vec![
                MetadataKey::Title,
                MetadataKey::Artist,
                MetadataKey::Explicit
            ]
        );
    }

    #[test]
    fn a_row_apple_had_no_entry_for_shows_nothing() {
        let mut missing = row();
        missing.found = false;
        assert!(metadata_tags_of(&missing).is_empty());
    }

    #[test]
    fn serializes_as_key_type_and_value() {
        let tag = &metadata_tags_of(&row())[5];
        assert_eq!(
            serde_json::to_value(tag).unwrap(),
            serde_json::json!({"key": "duration", "type": "number", "value": "521000"})
        );
    }
}
