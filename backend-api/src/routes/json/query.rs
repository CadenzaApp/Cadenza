use serde::{Deserialize, Serialize};

use crate::db::metadata_tags::SongRow;
use crate::db::queries::QueryMatches;
use crate::routes::json::tag::TagType;

/// A tag query, as sent in the `query` field of `POST /queries/results`. Both
/// builders on the client produce this shape.
///
/// A leaf is a filter, which can ask whether a tag is applied, look at the
/// tag's value, or look at tag names, values, and types across every tag on a
/// song. The drag and drop builder only ever emits `is_applied` and
/// `is_not_applied` filters.
///
/// ```json
/// {
///   "where": {
///     "and": [
///       { "filter": { "field": "tag", "tag_id": 4, "op": "on_or_after", "value": "1950-01-01" } },
///       { "filter": { "field": "tag", "tag_id": 7, "op": "before", "value": "2024-06-01T18:30:00Z" } },
///       { "not": { "or": [
///         { "filter": { "field": "tag_name", "op": "contains", "value": "live" } },
///         { "filter": { "field": "tag_type", "op": "is", "value": "checkbox" } }
///       ] } }
///     ]
///   }
/// }
/// ```
#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Query {
    #[serde(rename = "where")]
    pub root: QueryNode,
}

/// One node of the query tree. Serialized externally tagged, so each node is an
/// object with exactly one of these keys:
///
/// ```json
/// { "and": [ ... ] }
/// { "or": [ ... ] }
/// { "not": { ... } }
/// { "filter": { ... } }
/// ```
///
/// The advanced builder's "none of the following are true" group is sent as
/// `{ "not": { "or": [ ... ] } }`.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum QueryNode {
    And(Vec<QueryNode>),
    Or(Vec<QueryNode>),
    Not(Box<QueryNode>),
    Filter(Filter),
}

/// A single filter line, tagged by `field`.
///
/// ```json
/// { "field": "tag", "tag_id": 12, "op": "gt", "value": "3" }
/// { "field": "tag_name", "op": "starts_with", "value": "gym" }
/// { "field": "tag_value", "op": "is", "value": "Live at Budokan" }
/// { "field": "tag_type", "op": "is_not", "value": "datetime" }
/// { "field": "metadata", "key": "artist", "op": "starts_with", "value": "p" }
/// ```
///
/// `value` is always a string, the same as tag values everywhere else in the
/// api. Datetime tags take an RFC 3339 timestamp and compare to the minute;
/// date tags take a `YYYY-MM-DD` day. Operators that take no value (`is_empty`, `is_true`, `is_applied`, ...)
/// require it to be omitted or `null`. Which operators are allowed depends on
/// the field, and for `tag` on the tag's type. See `db::queries`.
#[derive(Deserialize, Debug)]
#[serde(tag = "field", rename_all = "snake_case")]
pub enum Filter {
    Tag {
        tag_id: i64,
        op: FilterOp,
        #[serde(default)]
        value: Option<String>,
    },
    TagName {
        op: FilterOp,
        #[serde(default)]
        value: Option<String>,
    },
    TagValue {
        op: FilterOp,
        #[serde(default)]
        value: Option<String>,
    },
    TagType {
        op: FilterOp,
        value: TagType,
    },
    /// A song's Apple Music catalog metadata rather than a tag. See [`MetadataKey`].
    Metadata {
        key: MetadataKey,
        op: FilterOp,
        #[serde(default)]
        value: Option<String>,
    },
}

/// Which piece of a song's Apple Music metadata a `metadata` filter looks at, and so which
/// operators it takes.
///
/// - `title`, `artist`, `album`: text operators
/// - `genre`: text operators, true when any one of the song's genres matches (`is_not` and
///   `is_empty` when none does)
/// - `release_date`: date operators, against a `YYYY-MM-DD` day
/// - `duration`: number operators, in milliseconds, so `"210000"` is three and a half
///   minutes
/// - `explicit`: `is_true` and `is_false`. False covers songs rated clean and songs with no
///   rating at all
/// - `total_plays`: number operators, against every user's counted plays of the song
///
/// A song with no stored metadata counts as having every one of these empty, the same as a
/// song without a tag.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MetadataKey {
    Title,
    Artist,
    Album,
    Genre,
    ReleaseDate,
    Duration,
    Explicit,
    TotalPlays,
}

/// A field a song list can be sorted or grouped by. To the user every one of these is a tag:
/// one of their own, an activity tag, a suggested tag, or one of the song's metadata tags.
///
/// ```json
/// { "field": "tag", "tag_id": 12 }
/// { "field": "metadata", "key": "artist" }
/// ```
///
/// A `tag` field may name any tag the caller can see on a song: their own, an activity tag,
/// or a shared default (suggested) tag. Default tags do not need `consider_default_tags`.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(tag = "field", rename_all = "snake_case")]
pub enum ArrangeField {
    Tag { tag_id: i64 },
    Metadata { key: MetadataKey },
}

/// How a song list is ordered, sent as `sort`. Leaving it out keeps the list's own order:
/// for a query, the user's own songs first, then the rest, most relevant first.
///
/// ```json
/// { "field": "metadata", "key": "artist", "direction": "descending" }
/// { "field": "tag", "tag_id": 4, "direction": "ascending" }
/// ```
///
/// Ascending is the field's natural order:
///
/// - basic and suggested tags: songs with the tag first. The direction is ignored
/// - checkbox: true, then false. Descending swaps the two
/// - text: A to Z, numbers inside text in numeric order
/// - number: low to high
/// - date and datetime: oldest first
///
/// Whichever way it runs, songs with the tag applied but no value come next, then songs
/// without the tag at all. A metadata tag has no "applied", so a song missing that value
/// comes last. Activity tags with a default (My Plays reads 0, Favorited reads false) never
/// lack a value. Ties go by title, then every user's plays, then song id.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct QuerySort {
    #[serde(flatten)]
    pub field: ArrangeField,
    pub direction: SortDirection,
}

/// How a song list is grouped, sent as `group`. Songs come back one group after another, one
/// group per distinct value of the field, in the field's own order (see [`QuerySort`]), and
/// `sort` orders the songs inside each group.
///
/// ```json
/// { "field": "metadata", "key": "artist", "direction": "ascending" }
/// ```
///
/// - text: one group per value, ignoring case. Genre is one text value, the song's genres
///   joined with ", "
/// - number, date, checkbox: one group per value
/// - datetime: one group per day, in `time_zone`
/// - basic and suggested tags: one group of songs with the tag
///
/// Then a group of songs with the tag applied but no value, then one of songs without it.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueryGroup {
    #[serde(flatten)]
    pub field: ArrangeField,
    pub direction: SortDirection,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Ascending,
    Descending,
}

/// What `POST /queries/results` and `POST /queries/arrange` return: the songs in order,
/// whether the list was cut off, the groups when one was asked for, and the songs Cadenza
/// has no metadata for.
///
/// ```json
/// {
///   "songs": [
///     { "song_id": "1440857781", "certain": true },
///     { "song_id": "1559523359", "certain": false }
///   ],
///   "capped": false,
///   "groups": [
///     { "state": "value", "value": "Prince", "count": 1 },
///     { "state": "not_applied", "value": null, "count": 1 }
///   ],
///   "missing_metadata": []
/// }
/// ```
///
/// `certain` is true for a song in the user's library or carrying any of their own tags,
/// activity tags included. Every other match is a song Cadenza knows from elsewhere.
///
/// Without a sort or group, every certain match comes back and only the first
/// [`MAX_DISCOVERED_SONGS`](crate::db::queries::MAX_DISCOVERED_SONGS) of the rest. With
/// either, only the first that many songs in order come back, certain or not. `capped` is
/// true when more matched. A library-only query or a list of song ids is never capped.
///
/// `groups` is null without a `group`. Each one is a run of `count` songs in `songs`, in
/// order, so they add up to the whole list. `value` is the group's value as text (a day
/// as `YYYY-MM-DD`, a checkbox as `true` or `false`, a number like `3` or `2.5`), and null
/// for a basic tag's group and for the `no_value` and `not_applied` groups.
///
/// `missing_metadata` lists returned songs with no stored metadata Apple knew, so the phone
/// can send what MusicKit knows about them through `POST /songs/metadata/library`.
#[derive(Serialize, Debug)]
pub struct QueryResults {
    pub songs: Vec<QueryResultSong>,
    pub capped: bool,
    pub groups: Option<Vec<QueryResultGroup>>,
    pub missing_metadata: Vec<String>,
}

#[derive(Serialize, Debug)]
pub struct QueryResultSong {
    pub song_id: String,
    pub certain: bool,
    /// What the song's row shows, from its stored metadata. Only on a sorted or grouped
    /// query, and only for a song with a stored title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row: Option<SongRowJSON>,
}

/// A song list row as `metadata_song_tags_applied` has it, so the phone can draw the row
/// without asking Apple. `artwork_url` is a real url, absent when none is stored yet.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct SongRowJSON {
    pub title: String,
    pub artist_name: Option<String>,
    pub album_name: Option<String>,
    pub album_id: Option<String>,
    pub duration_ms: Option<i32>,
    pub artwork_url: Option<String>,
}

impl From<SongRow> for SongRowJSON {
    fn from(row: SongRow) -> Self {
        Self {
            title: row.name,
            artist_name: row.artist_name,
            album_name: row.album_name,
            album_id: row.album_id,
            duration_ms: row.duration_in_millis,
            artwork_url: row.artwork_url.filter(|url| !url.is_empty()),
        }
    }
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct QueryResultGroup {
    pub state: GroupState,
    pub value: Option<String>,
    pub count: usize,
}

/// What a group holds: songs with a value (or with a basic tag), songs with the tag applied
/// but no value, or songs without the tag at all. A metadata tag's missing value is
/// `no_value`.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GroupState {
    Value,
    NoValue,
    NotApplied,
}

impl From<QueryMatches> for QueryResults {
    fn from(value: QueryMatches) -> Self {
        Self {
            songs: value
                .songs
                .into_iter()
                .map(|song| QueryResultSong {
                    song_id: song.song_id,
                    certain: song.certain,
                    row: None,
                })
                .collect(),
            capped: value.capped,
            groups: value.groups.map(|groups| {
                groups
                    .into_iter()
                    .map(|group| QueryResultGroup {
                        state: group.state,
                        value: group.value,
                        count: group.count,
                    })
                    .collect()
            }),
            missing_metadata: value.missing_metadata,
        }
    }
}

/// Every filter operator, across all field and tag types.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilterOp {
    // text (also tag_name and tag_value)
    Is,
    IsNot,
    StartsWith,
    EndsWith,
    Contains,
    IsEmpty,

    // datetime and number
    IsNotEmpty,

    // datetime
    On,
    NotOn,
    Before,
    After,
    OnOrBefore,
    OnOrAfter,

    // number
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,

    // checkbox
    IsTrue,
    IsFalse,
    IsNull,

    // every tag type
    IsApplied,
    IsNotApplied,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(artwork_url: Option<&str>) -> SongRow {
        SongRow {
            song_id: "1".into(),
            name: "Purple Rain".into(),
            artist_name: Some("Prince".into()),
            album_name: None,
            album_id: None,
            duration_in_millis: Some(521_000),
            artwork_url: artwork_url.map(str::to_owned),
        }
    }

    #[test]
    fn a_row_without_stored_artwork_sends_none() {
        assert_eq!(SongRowJSON::from(row(None)).artwork_url, None);
        assert_eq!(SongRowJSON::from(row(Some(""))).artwork_url, None);
        let json = SongRowJSON::from(row(Some("https://example.com/a.jpg")));
        assert_eq!(
            json.artwork_url.as_deref(),
            Some("https://example.com/a.jpg")
        );
        assert_eq!(json.title, "Purple Rain");
        assert_eq!(json.duration_ms, Some(521_000));
    }

    #[test]
    fn a_song_without_a_row_leaves_it_out() {
        let song = QueryResultSong {
            song_id: "1".into(),
            certain: true,
            row: None,
        };
        assert_eq!(
            serde_json::to_value(&song).unwrap(),
            serde_json::json!({ "song_id": "1", "certain": true })
        );
    }
}
