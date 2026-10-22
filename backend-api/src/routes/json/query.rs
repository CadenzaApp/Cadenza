use serde::{Deserialize, Serialize};

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

/// How `POST /queries/results` orders its songs, sent as its `sort` field. Leaving it out
/// orders them most relevant first.
///
/// ```json
/// { "key": "artist", "direction": "descending" }
/// ```
///
/// Sorting reads the song's stored Apple Music metadata, so a song with none, or with an
/// empty title, artist or album, comes last whichever way the sort runs.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct QuerySort {
    pub key: QuerySortKey,
    pub direction: SortDirection,
}

/// What a query's songs can be sorted by. The same three the app's song lists offer.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QuerySortKey {
    Title,
    Artist,
    Album,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Ascending,
    Descending,
}

/// What `POST /queries/results` returns: every matching song in order, and whether the
/// songs from outside the user's own were cut off.
///
/// ```json
/// {
///   "songs": [
///     { "song_id": "1440857781", "certain": true },
///     { "song_id": "1559523359", "certain": false }
///   ],
///   "capped": false
/// }
/// ```
///
/// `certain` is true for a song in the user's library or carrying any of their own tags,
/// activity tags included. Those always all come back. Every other match is a song Cadenza
/// knows from elsewhere, and only the first
/// [`MAX_DISCOVERED_SONGS`](crate::db::queries::MAX_DISCOVERED_SONGS) of those do;
/// `capped` is true when more matched than that.
#[derive(Serialize, Debug)]
pub struct QueryResults {
    pub songs: Vec<QueryResultSong>,
    pub capped: bool,
}

#[derive(Serialize, Debug)]
pub struct QueryResultSong {
    pub song_id: String,
    pub certain: bool,
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
                })
                .collect(),
            capped: value.capped,
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
