//! Which Cadenza query builder can hold a query. The assistant writes queries in the wire
//! format, and the phone loads them into the simple builder when it can, otherwise the
//! advanced one, so the model can say which it used.
//!
//! Every query fits the advanced builder. The simple one holds the shape its own
//! `queryToJSON` writes:
//!
//! - the root is an `and` or `or` of conditions, or one condition on its own
//! - a condition is a `tag` or `metadata` filter, the same negated (`{ "not": filter }`), or
//!   a group of plain filters: `or` (any), `and` (all), or `{ "not": { "or": [...] } }`
//!   (none)
//! - tag name, tag value and tag type filters are advanced only
//!
//! The phone checks the same rules in `client-app/src/features/query-builder/QueryImport.ts`.
//! Both are tested against `builder_fixtures.json` here.

use crate::routes::json::query::{Filter, Query, QueryNode};

/// A query builder on the phone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Builder {
    Simple,
    Advanced,
}

impl Builder {
    pub fn as_str(self) -> &'static str {
        match self {
            Builder::Simple => "simple",
            Builder::Advanced => "advanced",
        }
    }
}

/// The simple builder can hold `query`.
pub fn fits_simple(query: &Query) -> bool {
    match &query.root {
        QueryNode::And(children) | QueryNode::Or(children) => children.iter().all(is_condition),
        other => is_condition(other),
    }
}

/// The builder a query loads into: `wanted` when it can hold it, otherwise the simple one
/// when it can, otherwise the advanced one. Returns the builder and whether `wanted` had
/// to give way.
pub fn builder_for(query: &Query, wanted: Option<Builder>) -> (Builder, bool) {
    let simple = fits_simple(query);
    match wanted {
        Some(Builder::Simple) if !simple => (Builder::Advanced, true),
        Some(builder) => (builder, false),
        None if simple => (Builder::Simple, false),
        None => (Builder::Advanced, false),
    }
}

fn is_plain_filter(node: &QueryNode) -> bool {
    matches!(
        node,
        QueryNode::Filter(Filter::Tag { .. } | Filter::Metadata { .. })
    )
}

fn is_condition(node: &QueryNode) -> bool {
    match node {
        QueryNode::Filter(_) => is_plain_filter(node),
        QueryNode::Not(inner) => match inner.as_ref() {
            QueryNode::Or(members) => is_group(members),
            other => is_plain_filter(other),
        },
        QueryNode::And(members) | QueryNode::Or(members) => is_group(members),
    }
}

fn is_group(members: &[QueryNode]) -> bool {
    !members.is_empty() && members.iter().all(is_plain_filter)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Fixture {
        name: String,
        query: serde_json::Value,
        simple: bool,
    }

    #[test]
    fn the_fixtures_fit_the_builder_they_say() {
        let fixtures: Vec<Fixture> =
            serde_json::from_str(include_str!("builder_fixtures.json")).unwrap();
        assert!(fixtures.len() > 10);
        for fixture in fixtures {
            let query: Query = serde_json::from_value(fixture.query).unwrap();
            assert_eq!(fits_simple(&query), fixture.simple, "{}", fixture.name);
        }
    }

    fn query(json: &str) -> Query {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn a_wanted_builder_is_used_when_it_can_hold_the_query() {
        let simple = query(r#"{"where":{"filter":{"field":"tag","tag_id":1,"op":"is_applied"}}}"#);
        let advanced =
            query(r#"{"where":{"filter":{"field":"tag_name","op":"contains","value":"x"}}}"#);
        assert_eq!(builder_for(&simple, None), (Builder::Simple, false));
        assert_eq!(
            builder_for(&simple, Some(Builder::Advanced)),
            (Builder::Advanced, false)
        );
        assert_eq!(builder_for(&advanced, None), (Builder::Advanced, false));
        assert_eq!(
            builder_for(&advanced, Some(Builder::Simple)),
            (Builder::Advanced, true)
        );
    }
}
