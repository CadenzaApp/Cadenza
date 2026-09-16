use serde::{Deserialize, Serialize};

use crate::routes::json::tag::TagType;

/// An advanced query, as sent in the `q` param of `GET /queries/advanced/results`.
///
/// Unlike the simple query, whose leaves are bare tag ids, the leaves here are
/// filters that can look at a tag's value, and at tag names, values, and types
/// across every tag on a song.
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
pub struct AdvancedQuery {
    #[serde(rename = "where")]
    pub root: AdvancedQueryNode,
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
/// The builder's "none of the following are true" group is sent as
/// `{ "not": { "or": [ ... ] } }`.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum AdvancedQueryNode {
    And(Vec<AdvancedQueryNode>),
    Or(Vec<AdvancedQueryNode>),
    Not(Box<AdvancedQueryNode>),
    Filter(AdvancedFilter),
}

/// A single filter line, tagged by `field`.
///
/// ```json
/// { "field": "tag", "tag_id": 12, "op": "gt", "value": "3" }
/// { "field": "tag_name", "op": "starts_with", "value": "gym" }
/// { "field": "tag_value", "op": "is", "value": "Live at Budokan" }
/// { "field": "tag_type", "op": "is_not", "value": "datetime" }
/// ```
///
/// `value` is always a string, the same as tag values everywhere else in the
/// api. Datetime tags take an RFC 3339 timestamp and compare to the minute;
/// date tags take a `YYYY-MM-DD` day. Operators that take no value (`is_empty`, `is_true`, `is_applied`, ...)
/// require it to be omitted or `null`. Which operators are allowed depends on
/// the field, and for `tag` on the tag's type. See `db::advanced_queries`.
#[derive(Deserialize, Debug)]
#[serde(tag = "field", rename_all = "snake_case")]
pub enum AdvancedFilter {
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

    // basic
    IsApplied,
    IsNotApplied,
}
