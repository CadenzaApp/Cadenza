use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDate, Utc};
use sea_orm::prelude::Uuid;
use sea_orm::{
    ColumnTrait, Condition, DatabaseConnection, DbBackend, EntityTrait, FromQueryResult,
    QueryFilter, Statement,
};

use crate::db::entity::sea_orm_active_enums::TagType;
use crate::db::entity::tags;
use crate::err::CadenzaError;
use crate::routes::json::query::{Filter, FilterOp, Query, QueryNode};
use crate::routes::json::tag::TagType as JsonTagType;

/// Caps on the size of a query tree, so one request cannot build a huge
/// statement.
const MAX_NODES: usize = 200;
const MAX_DEPTH: usize = 20;

#[derive(Debug, FromQueryResult)]
struct SongTagPair {
    song_id: String,
    tag_id: Option<i64>,
}

/// Returns the ids of every song matching the given query, most relevant first.
///
/// With `candidate_song_ids` the query runs over exactly those songs, so a song
/// carrying no tags at all can still satisfy a negative filter. Without them it
/// runs over the songs that already carry a tag, and a song with no tag rows can
/// never come back.
///
/// With `consider_default_tags` a song's shared default tags count as tags on it
/// too, both for matching and for ranking, and the query may name a default tag
/// id. Otherwise only the user's own tags exist as far as the query is
/// concerned.
pub async fn run_query(
    db: &DatabaseConnection,
    query: &Query,
    user_id: Uuid,
    candidate_song_ids: Option<&[String]>,
    consider_default_tags: bool,
) -> Result<Vec<String>, CadenzaError> {
    if candidate_song_ids.is_some_and(|song_ids| song_ids.is_empty()) {
        return Ok(Vec::new());
    }

    check_size(&query.root)?;

    let mut tag_ids = HashSet::new();
    collect_tag_ids(&query.root, &mut tag_ids);
    let tag_types = get_queryable_tag_types(db, user_id, &tag_ids, consider_default_tags).await?;

    let (sql, values) = compile_query(
        query,
        &tag_types,
        user_id,
        candidate_song_ids,
        consider_default_tags,
    )?;

    let song_tag_pairs = SongTagPair::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        values,
    ))
    .all(db)
    .await?;

    Ok(rank_songs(song_tag_pairs, &tag_ids))
}

/// Orders matched songs by how many of the tags the query names they carry, most
/// first. Equal scores fall back to song id, so the same query comes back in the
/// same order every time.
///
/// A query built only from `tag_name`, `tag_value` or `tag_type` filters names no
/// tag ids, so every song scores zero and the whole list is ordered by song id.
fn rank_songs(song_tag_pairs: Vec<SongTagPair>, mentioned_tags: &HashSet<i64>) -> Vec<String> {
    // song id -> how many of the mentioned tags it carries
    let mut scores: HashMap<String, usize> = HashMap::new();

    for pair in song_tag_pairs {
        let score = scores.entry(pair.song_id).or_default();
        if pair
            .tag_id
            .is_some_and(|tag_id| mentioned_tags.contains(&tag_id))
        {
            *score += 1;
        }
    }

    let mut songs: Vec<(String, usize)> = scores.into_iter().collect();
    songs.sort_by(|(left_id, left_score), (right_id, right_score)| {
        right_score
            .cmp(left_score)
            .then_with(|| left_id.cmp(right_id))
    });

    songs.into_iter().map(|(song_id, _)| song_id).collect()
}

/// Looks up the type of every tag the query mentions. A tag that does not exist
/// or belongs to someone else is a `QueryFormatError`.
///
/// With `consider_default_tags` a shared default tag (`user_id IS NULL`) is
/// queryable as well, so the query may name one.
async fn get_queryable_tag_types(
    db: &DatabaseConnection,
    user_id: Uuid,
    tag_ids: &HashSet<i64>,
    consider_default_tags: bool,
) -> Result<HashMap<i64, TagType>, CadenzaError> {
    if tag_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let mut owned_by_caller = Condition::any().add(tags::Column::UserId.eq(user_id));
    if consider_default_tags {
        owned_by_caller = owned_by_caller.add(tags::Column::UserId.is_null());
    }

    let tag_types: HashMap<i64, TagType> = tags::Entity::find()
        .filter(tags::Column::TagId.is_in(tag_ids.iter().copied()))
        .filter(owned_by_caller)
        .all(db)
        .await?
        .into_iter()
        .map(|tag| (tag.tag_id, tag.r#type))
        .collect();

    if let Some(missing) = tag_ids.iter().find(|id| !tag_types.contains_key(id)) {
        return Err(CadenzaError::QueryFormatError(format!(
            "tag {} does not exist",
            missing
        )));
    }

    Ok(tag_types)
}

fn check_size(root: &QueryNode) -> Result<(), CadenzaError> {
    fn walk(node: &QueryNode, depth: usize, count: &mut usize) -> Result<(), CadenzaError> {
        *count += 1;
        if *count > MAX_NODES {
            return Err(CadenzaError::QueryFormatError(format!(
                "queries are limited to {MAX_NODES} filters and groups"
            )));
        }
        if depth > MAX_DEPTH {
            return Err(CadenzaError::QueryFormatError(format!(
                "groups can only be nested {MAX_DEPTH} deep"
            )));
        }
        match node {
            QueryNode::And(children) | QueryNode::Or(children) => {
                for child in children {
                    walk(child, depth + 1, count)?;
                }
                Ok(())
            }
            QueryNode::Not(child) => walk(child, depth + 1, count),
            QueryNode::Filter(_) => Ok(()),
        }
    }

    walk(root, 1, &mut 0)
}

fn collect_tag_ids(node: &QueryNode, out: &mut HashSet<i64>) {
    match node {
        QueryNode::And(children) | QueryNode::Or(children) => {
            for child in children {
                collect_tag_ids(child, out);
            }
        }
        QueryNode::Not(child) => collect_tag_ids(child, out),
        QueryNode::Filter(Filter::Tag { tag_id, .. }) => {
            out.insert(*tag_id);
        }
        QueryNode::Filter(_) => {}
    }
}

/// The rows that count as tags on a song, as a `FROM` item. Every part of the
/// statement reads its tags through this, so the caller's choice about default
/// tags is made in exactly one place.
///
/// Both branches expose the same `(song_id, tag_id, value)` shape. A default tag
/// has no value column to read, so it comes through as null, which is what makes
/// it behave like an attribute tag applied without a value.
///
/// A default tag the user removed is not one of their tags, so the default
/// branch leaves out the rows they have in `default_tags_removed`. It stays a
/// default tag for everyone else.
///
/// This is a subquery rather than a CTE on purpose: postgres pushes the
/// correlated `song_id` down into each `UNION ALL` branch, so the per-filter
/// lookups still use the song id indexes. A materialized CTE would be scanned
/// once per song instead.
fn applied_tags_source(consider_default_tags: bool) -> &'static str {
    if consider_default_tags {
        "(
            SELECT song_id, tag_id, value FROM user_tags_applied WHERE user_id=$1
            UNION ALL
            SELECT applied.song_id, applied.tag_id, NULL::text AS value
            FROM default_tags_applied AS applied
            WHERE NOT EXISTS (
                SELECT 1 FROM default_tags_removed AS removed
                WHERE removed.user_id=$1
                    AND removed.tag_id=applied.tag_id
                    AND removed.song_id=applied.song_id
            )
        )"
    } else {
        "(SELECT song_id, tag_id, value FROM user_tags_applied WHERE user_id=$1)"
    }
}

/// Converts the query to a full SQL statement and its values. `tag_types` must
/// hold the type of every tag id the query mentions.
///
/// Every filter becomes one correlated `EXISTS` (or `NOT EXISTS`) over the
/// song's applied tags. A song without the tag at all counts as empty, so
/// negative operators (`is_not`, `not_on`, `ne`, `is_empty`, `is_null`) match
/// it.
///
/// The statement selects `(song id, tag id)` pairs rather than bare song ids, so
/// `rank_songs` can score each song by the tags it carries. Filters correlate
/// against `query_songs`, which is a candidate song id when the caller supplied
/// candidates and an existing tag application otherwise.
fn compile_query(
    query: &Query,
    tag_types: &HashMap<i64, TagType>,
    user_id: Uuid,
    candidate_song_ids: Option<&[String]>,
    consider_default_tags: bool,
) -> Result<(String, Vec<sea_query::Value>), CadenzaError> {
    let mut values = vec![sea_query::Value::Uuid(Some(user_id))];
    if let Some(song_ids) = candidate_song_ids {
        values.push(song_ids.to_vec().into());
    }

    let applied_tags = applied_tags_source(consider_default_tags);
    let mut compiler = Compiler {
        tag_types,
        values,
        applied_tags,
    };
    let where_clause = compiler.node(&query.root)?;

    let sql = if candidate_song_ids.is_some() {
        format!(
            r#"
                SELECT query_songs.song_id, applied_tags.tag_id
                FROM unnest($2::text[]) AS query_songs(song_id)
                LEFT JOIN {applied_tags} AS applied_tags
                    ON applied_tags.song_id=query_songs.song_id
                WHERE {where_clause}
            "#
        )
    } else {
        format!(
            r#"
                SELECT query_songs.song_id, query_songs.tag_id
                FROM {applied_tags} AS query_songs
                WHERE {where_clause}
            "#
        )
    };

    Ok((sql, compiler.values))
}

struct Compiler<'a> {
    tag_types: &'a HashMap<i64, TagType>,
    /// `$1` is always the user id, and `$2` the candidate song ids when the
    /// caller supplied any.
    values: Vec<sea_query::Value>,
    /// The `FROM` item every filter reads its tags through.
    applied_tags: &'static str,
}

/// How a filter's operator relates to the song's applied tags.
enum Match {
    /// Some applied tag satisfies the condition.
    Any(String),
    /// No applied tag satisfies the condition. This is how a song missing the
    /// tag ends up matching negative operators.
    None(String),
}

impl Compiler<'_> {
    /// Binds a value and returns its placeholder, like `$4`.
    fn bind(&mut self, value: impl Into<sea_query::Value>) -> String {
        self.values.push(value.into());
        format!("${}", self.values.len())
    }

    /// Converts a node to a SQL snippet.
    fn node(&mut self, node: &QueryNode) -> Result<String, CadenzaError> {
        match node {
            QueryNode::And(children) => self.group(children, " AND ", "TRUE"),
            QueryNode::Or(children) => self.group(children, " OR ", "FALSE"),
            QueryNode::Not(child) => Ok(format!("NOT ({})", self.node(child)?)),
            QueryNode::Filter(filter) => self.filter(filter),
        }
    }

    /// Joins child snippets. An empty `and` is true and an empty `or` is false.
    fn group(
        &mut self,
        children: &[QueryNode],
        joiner: &str,
        empty: &str,
    ) -> Result<String, CadenzaError> {
        if children.is_empty() {
            return Ok(empty.to_string());
        }
        let snippets = children
            .iter()
            .map(|child| self.node(child))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(format!("({})", snippets.join(joiner)))
    }

    fn filter(&mut self, filter: &Filter) -> Result<String, CadenzaError> {
        match filter {
            Filter::Tag { tag_id, op, value } => self.tag_filter(*tag_id, *op, value),
            Filter::TagName { op, value } => {
                let matched =
                    self.text_match("filter_tag.name", *op, value, "filter_tag.name <> ''")?;
                Ok(joined_exists(self.applied_tags, matched))
            }
            Filter::TagValue { op, value } => {
                let matched = self.text_match(
                    "filter_check.value",
                    *op,
                    value,
                    "filter_check.value IS NOT NULL",
                )?;
                Ok(joined_exists(self.applied_tags, matched))
            }
            Filter::TagType { op, value } => {
                let tag_type = self.bind(tag_type_name(*value));
                let condition = format!("filter_tag.type::text = {}", tag_type);
                match op {
                    FilterOp::Is => Ok(joined_exists(self.applied_tags, Match::Any(condition))),
                    FilterOp::IsNot => Ok(joined_exists(self.applied_tags, Match::None(condition))),
                    _ => Err(unsupported_op(*op, "the tag type")),
                }
            }
        }
    }

    /// A text comparison on `column`, shared by text tags, tag names and tag
    /// values. Case is ignored. `present` is the condition for the column
    /// holding something, which is what `is_empty` negates.
    fn text_match(
        &mut self,
        column: &str,
        op: FilterOp,
        value: &Option<String>,
        present: &str,
    ) -> Result<Match, CadenzaError> {
        if op == FilterOp::IsEmpty {
            no_value(op, value)?;
            return Ok(Match::None(present.to_string()));
        }

        let text = match op {
            FilterOp::Is
            | FilterOp::IsNot
            | FilterOp::StartsWith
            | FilterOp::EndsWith
            | FilterOp::Contains => required_value(op, value)?,
            _ => return Err(unsupported_op(op, "text")),
        };
        let param = self.bind(text.to_string());

        let condition = match op {
            FilterOp::Is | FilterOp::IsNot => format!("lower({column}) = lower({param})"),
            FilterOp::StartsWith => format!("starts_with(lower({column}), lower({param}))"),
            FilterOp::EndsWith => {
                format!("right(lower({column}), char_length(lower({param}))) = lower({param})")
            }
            _ => format!("strpos(lower({column}), lower({param})) > 0"),
        };

        Ok(match op {
            FilterOp::IsNot => Match::None(condition),
            _ => Match::Any(condition),
        })
    }

    /// Comparisons on datetime and date tags. Datetimes compare to the
    /// minute, in UTC, so a value picked on the phone matches itself whatever
    /// its seconds. Dates are plain calendar days with no time zone.
    fn moment_match(
        &mut self,
        tag_type: &TagType,
        op: FilterOp,
        value: &Option<String>,
    ) -> Result<Match, CadenzaError> {
        match op {
            FilterOp::IsEmpty => {
                no_value(op, value)?;
                Ok(Match::None("TRUE".to_string()))
            }
            FilterOp::IsNotEmpty => {
                no_value(op, value)?;
                Ok(Match::Any("TRUE".to_string()))
            }
            FilterOp::On
            | FilterOp::NotOn
            | FilterOp::Before
            | FilterOp::After
            | FilterOp::OnOrBefore
            | FilterOp::OnOrAfter => {
                let raw = required_value(op, value)?;
                let (stored, target) = if *tag_type == TagType::Datetime {
                    let param = self.bind(parse_datetime(raw)?);
                    (
                        "date_trunc('minute', filter_check.value::timestamptz AT TIME ZONE 'UTC')"
                            .to_string(),
                        format!("date_trunc('minute', {param}::timestamptz AT TIME ZONE 'UTC')"),
                    )
                } else {
                    let param = self.bind(parse_date(raw)?);
                    (
                        "filter_check.value::date".to_string(),
                        format!("{param}::date"),
                    )
                };
                let comparison = match op {
                    FilterOp::On | FilterOp::NotOn => "=",
                    FilterOp::Before => "<",
                    FilterOp::After => ">",
                    FilterOp::OnOrBefore => "<=",
                    _ => ">=",
                };
                let condition = format!("{stored} {comparison} {target}");
                Ok(match op {
                    FilterOp::NotOn => Match::None(condition),
                    _ => Match::Any(condition),
                })
            }
            _ => Err(unsupported_op(
                op,
                if *tag_type == TagType::Datetime {
                    "datetime tags"
                } else {
                    "date tags"
                },
            )),
        }
    }

    fn tag_filter(
        &mut self,
        tag_id: i64,
        op: FilterOp,
        value: &Option<String>,
    ) -> Result<String, CadenzaError> {
        let tag_type = self.tag_types.get(&tag_id).cloned().ok_or_else(|| {
            CadenzaError::QueryFormatError(format!("tag {} does not exist", tag_id))
        })?;
        let tag_param = self.bind(sea_query::Value::BigInt(Some(tag_id)));

        // Every tag type offers these. They ask only whether the tag is on the
        // song, so an attribute tag applied without a value still counts.
        if matches!(op, FilterOp::IsApplied | FilterOp::IsNotApplied) {
            no_value(op, value)?;
            let matched = if op == FilterOp::IsApplied {
                Match::Any("TRUE".to_string())
            } else {
                Match::None("TRUE".to_string())
            };
            return Ok(tag_exists(self.applied_tags, &tag_param, false, matched));
        }

        let matched = match tag_type {
            TagType::Basic => return Err(unsupported_op(op, "basic tags")),

            TagType::Text => self.text_match(
                "filter_check.value",
                op,
                value,
                "filter_check.value IS NOT NULL",
            )?,

            TagType::Number => match op {
                FilterOp::IsEmpty => {
                    no_value(op, value)?;
                    Match::None("TRUE".to_string())
                }
                FilterOp::IsNotEmpty => {
                    no_value(op, value)?;
                    Match::Any("TRUE".to_string())
                }
                FilterOp::Eq
                | FilterOp::Ne
                | FilterOp::Lt
                | FilterOp::Le
                | FilterOp::Gt
                | FilterOp::Ge => {
                    let number = parse_number(required_value(op, value)?)?;
                    let param = self.bind(number);
                    let comparison = match op {
                        FilterOp::Eq | FilterOp::Ne => "=",
                        FilterOp::Lt => "<",
                        FilterOp::Le => "<=",
                        FilterOp::Gt => ">",
                        _ => ">=",
                    };
                    let condition =
                        format!("filter_check.value::double precision {comparison} {param}");
                    match op {
                        FilterOp::Ne => Match::None(condition),
                        _ => Match::Any(condition),
                    }
                }
                _ => return Err(unsupported_op(op, "number tags")),
            },

            TagType::Datetime | TagType::Date => self.moment_match(&tag_type, op, value)?,

            TagType::Checkbox => {
                no_value(op, value)?;
                match op {
                    FilterOp::IsTrue => Match::Any("filter_check.value = 'true'".to_string()),
                    FilterOp::IsFalse => Match::Any("filter_check.value = 'false'".to_string()),
                    FilterOp::IsNull => Match::None("TRUE".to_string()),
                    _ => return Err(unsupported_op(op, "checkbox tags")),
                }
            }
        };

        Ok(tag_exists(self.applied_tags, &tag_param, true, matched))
    }
}

/// `EXISTS` over the song's applications of one tag.
///
/// With `on_value`, the condition only ever sees that tag's non-null values.
/// It sits inside a `CASE` because postgres does not promise to check the
/// other `WHERE` terms first, and a cast like `value::double precision` would
/// fail on another tag's text value. Without it, any application counts.
fn tag_exists(applied_tags: &str, tag_param: &str, on_value: bool, matched: Match) -> String {
    let (negate, condition) = match matched {
        Match::Any(condition) => ("", condition),
        Match::None(condition) => ("NOT ", condition),
    };

    let condition = if on_value {
        format!(
            "CASE WHEN filter_check.tag_id = {tag_param} AND filter_check.value IS NOT NULL THEN {condition} ELSE FALSE END"
        )
    } else {
        condition
    };

    format!(
        r#"
            {negate}EXISTS (
                SELECT 1 FROM {applied_tags} AS filter_check
                WHERE filter_check.song_id=query_songs.song_id AND filter_check.tag_id={tag_param} AND {condition}
            )
        "#
    )
}

/// `EXISTS` over every tag applied to the song, joined to the tag itself, for
/// filters on tag names, values and types.
fn joined_exists(applied_tags: &str, matched: Match) -> String {
    let (negate, condition) = match matched {
        Match::Any(condition) => ("", condition),
        Match::None(condition) => ("NOT ", condition),
    };

    format!(
        r#"
            {negate}EXISTS (
                SELECT 1 FROM {applied_tags} AS filter_check
                JOIN tags AS filter_tag ON filter_tag.tag_id=filter_check.tag_id
                WHERE filter_check.song_id=query_songs.song_id AND {condition}
            )
        "#
    )
}

fn op_name(op: FilterOp) -> String {
    serde_json::to_value(op)
        .ok()
        .and_then(|name| name.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("{:?}", op))
}

fn tag_type_name(tag_type: JsonTagType) -> String {
    serde_json::to_value(tag_type)
        .ok()
        .and_then(|name| name.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn unsupported_op(op: FilterOp, target: &str) -> CadenzaError {
    CadenzaError::QueryFormatError(format!("'{}' cannot be used on {}", op_name(op), target))
}

/// The trimmed value, which must be present and not blank.
fn required_value(op: FilterOp, value: &Option<String>) -> Result<&str, CadenzaError> {
    match value.as_deref().map(str::trim) {
        Some(value) if !value.is_empty() => Ok(value),
        _ => Err(CadenzaError::QueryFormatError(format!(
            "'{}' needs a value",
            op_name(op)
        ))),
    }
}

/// Operators like `is_empty` take no value. A blank one is tolerated.
fn no_value(op: FilterOp, value: &Option<String>) -> Result<(), CadenzaError> {
    match value.as_deref().map(str::trim) {
        Some(value) if !value.is_empty() => Err(CadenzaError::QueryFormatError(format!(
            "'{}' does not take a value",
            op_name(op)
        ))),
        _ => Ok(()),
    }
}

fn parse_number(value: &str) -> Result<f64, CadenzaError> {
    match value.parse::<f64>() {
        Ok(number) if number.is_finite() => Ok(number),
        _ => Err(CadenzaError::QueryFormatError(format!(
            "'{}' is not a number",
            value
        ))),
    }
}

/// Values for date tags are plain `YYYY-MM-DD` days. Returned in that same
/// canonical form.
fn parse_date(value: &str) -> Result<String, CadenzaError> {
    match NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        Ok(date) => Ok(date.format("%Y-%m-%d").to_string()),
        Err(_) => Err(CadenzaError::QueryFormatError(format!(
            "'{}' is not a YYYY-MM-DD date",
            value
        ))),
    }
}

/// Values for datetime tags are RFC 3339 timestamps. Returned normalized to
/// UTC, the same form the tag values are stored in.
fn parse_datetime(value: &str) -> Result<String, CadenzaError> {
    match DateTime::parse_from_rfc3339(value) {
        Ok(datetime) => Ok(datetime.with_timezone(&Utc).to_rfc3339()),
        Err(_) => Err(CadenzaError::QueryFormatError(format!(
            "'{}' is not an RFC 3339 datetime",
            value
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Query {
        serde_json::from_str(json).unwrap()
    }

    fn tag_types() -> HashMap<i64, TagType> {
        HashMap::from([
            (1, TagType::Basic),
            (2, TagType::Text),
            (3, TagType::Datetime),
            (4, TagType::Number),
            (5, TagType::Checkbox),
            (6, TagType::Date),
        ])
    }

    fn compile(json: &str) -> Result<(String, Vec<sea_query::Value>), CadenzaError> {
        compile_query(&parse(json), &tag_types(), Uuid::nil(), None, false)
    }

    fn compile_over(
        json: &str,
        candidates: &[String],
    ) -> Result<(String, Vec<sea_query::Value>), CadenzaError> {
        compile_query(
            &parse(json),
            &tag_types(),
            Uuid::nil(),
            Some(candidates),
            false,
        )
    }

    fn compile_with_defaults(json: &str) -> Result<(String, Vec<sea_query::Value>), CadenzaError> {
        compile_query(&parse(json), &tag_types(), Uuid::nil(), None, true)
    }

    fn pair(song_id: &str, tag_id: Option<i64>) -> SongTagPair {
        SongTagPair {
            song_id: song_id.to_string(),
            tag_id,
        }
    }

    fn filter(filter: &str) -> String {
        format!(r#"{{ "where": {{ "filter": {} }} }}"#, filter)
    }

    fn is_format_err(result: Result<(String, Vec<sea_query::Value>), CadenzaError>) -> bool {
        matches!(result, Err(CadenzaError::QueryFormatError(_)))
    }

    #[test]
    fn parses_the_documented_example() {
        let query = parse(
            r#"{
                "where": { "and": [
                    { "filter": { "field": "tag", "tag_id": 6, "op": "on_or_after", "value": "1950-01-01" } },
                    { "filter": { "field": "tag", "tag_id": 3, "op": "before", "value": "2024-06-01T18:30:00Z" } },
                    { "not": { "or": [
                        { "filter": { "field": "tag_name", "op": "contains", "value": "live" } },
                        { "filter": { "field": "tag_type", "op": "is", "value": "checkbox" } }
                    ] } }
                ] }
            }"#,
        );
        let mut ids = HashSet::new();
        collect_tag_ids(&query.root, &mut ids);
        assert_eq!(ids, HashSet::from([3, 6]));
        assert!(check_size(&query.root).is_ok());
    }

    #[test]
    fn rejects_unknown_node_keys_and_ops() {
        assert!(serde_json::from_str::<Query>(r#"{ "where": { "xor": [] } }"#).is_err());
        assert!(
            serde_json::from_str::<Query>(&filter(
                r#"{ "field": "tag", "tag_id": 2, "op": "like", "value": "a" }"#
            ))
            .is_err()
        );
        assert!(serde_json::from_str::<Query>(r#"{ "root": { "and": [] } }"#).is_err());
        assert!(
            serde_json::from_str::<Query>(r#"{ "timezone": "UTC", "where": { "and": [] } }"#)
                .is_err()
        );
    }

    #[test]
    fn user_id_is_always_the_first_param() {
        let (sql, values) = compile(r#"{ "where": { "and": [] } }"#).unwrap();
        assert!(sql.contains("WHERE user_id=$1"), "{sql}");
        assert_eq!(values, vec![sea_query::Value::Uuid(Some(Uuid::nil()))]);
    }

    #[test]
    fn empty_groups_are_true_for_and_and_false_for_or() {
        let (sql, _) = compile(r#"{ "where": { "or": [] } }"#).unwrap();
        assert!(sql.contains("WHERE FALSE"), "{sql}");
        let (sql, _) = compile(r#"{ "where": { "not": { "or": [] } } }"#).unwrap();
        assert!(sql.contains("WHERE NOT (FALSE)"), "{sql}");
    }

    #[test]
    fn params_are_numbered_in_order() {
        let (sql, values) = compile(
            r#"{ "where": { "or": [
                { "filter": { "field": "tag", "tag_id": 4, "op": "gt", "value": "2.50" } },
                { "filter": { "field": "tag_value", "op": "is", "value": " Rock " } }
            ] } }"#,
        )
        .unwrap();

        assert!(sql.contains("filter_check.value::double precision > $3"));
        assert!(sql.contains("lower(filter_check.value) = lower($4)"));
        assert_eq!(
            values[1..],
            [
                sea_query::Value::BigInt(Some(4)),
                sea_query::Value::Double(Some(2.5)),
                sea_query::Value::String(Some("Rock".to_string())),
            ]
        );
    }

    #[test]
    fn negative_operators_become_not_exists() {
        for filter_json in [
            r#"{ "field": "tag", "tag_id": 1, "op": "is_not_applied" }"#,
            r#"{ "field": "tag", "tag_id": 2, "op": "is_not", "value": "a" }"#,
            r#"{ "field": "tag", "tag_id": 2, "op": "is_empty" }"#,
            r#"{ "field": "tag", "tag_id": 3, "op": "not_on", "value": "2000-01-01T00:00:00Z" }"#,
            r#"{ "field": "tag", "tag_id": 6, "op": "not_on", "value": "2000-01-01" }"#,
            r#"{ "field": "tag", "tag_id": 6, "op": "is_empty" }"#,
            r#"{ "field": "tag", "tag_id": 4, "op": "ne", "value": "1" }"#,
            r#"{ "field": "tag", "tag_id": 5, "op": "is_null" }"#,
            r#"{ "field": "tag_name", "op": "is_not", "value": "a" }"#,
            r#"{ "field": "tag_value", "op": "is_empty" }"#,
            r#"{ "field": "tag_type", "op": "is_not", "value": "text" }"#,
        ] {
            let (sql, _) = compile(&filter(filter_json)).unwrap();
            assert!(sql.contains("NOT EXISTS"), "{filter_json}");
        }
    }

    #[test]
    fn positive_operators_become_exists() {
        for filter_json in [
            r#"{ "field": "tag", "tag_id": 1, "op": "is_applied" }"#,
            r#"{ "field": "tag", "tag_id": 2, "op": "contains", "value": "a" }"#,
            r#"{ "field": "tag", "tag_id": 3, "op": "is_not_empty" }"#,
            r#"{ "field": "tag", "tag_id": 6, "op": "after", "value": "2000-01-01" }"#,
            r#"{ "field": "tag", "tag_id": 4, "op": "le", "value": "1" }"#,
            r#"{ "field": "tag", "tag_id": 5, "op": "is_false" }"#,
            r#"{ "field": "tag_type", "op": "is", "value": "basic" }"#,
        ] {
            let (sql, _) = compile(&filter(filter_json)).unwrap();
            assert!(
                sql.contains("EXISTS") && !sql.contains("NOT EXISTS"),
                "{filter_json}"
            );
        }
    }

    #[test]
    fn value_casts_are_guarded_by_the_tag_id() {
        let (sql, _) = compile(&filter(
            r#"{ "field": "tag", "tag_id": 6, "op": "before", "value": "2000-01-01" }"#,
        ))
        .unwrap();
        assert!(sql.contains(
            "CASE WHEN filter_check.tag_id = $2 AND filter_check.value IS NOT NULL THEN filter_check.value::date < $3::date ELSE FALSE END"
        ));
    }

    #[test]
    fn datetimes_compare_to_the_minute_in_utc() {
        let (sql, values) = compile(&filter(
            r#"{ "field": "tag", "tag_id": 3, "op": "on", "value": "2000-01-01T05:30:59-06:00" }"#,
        ))
        .unwrap();
        assert!(sql.contains(
            "date_trunc('minute', filter_check.value::timestamptz AT TIME ZONE 'UTC') = date_trunc('minute', $3::timestamptz AT TIME ZONE 'UTC')"
        ));
        assert_eq!(
            values[2],
            sea_query::Value::String(Some("2000-01-01T11:30:59+00:00".to_string()))
        );
    }

    #[test]
    fn every_tag_type_offers_applied_and_not_applied() {
        for tag_id in 1..=6 {
            let (sql, _) = compile(&filter(&format!(
                r#"{{ "field": "tag", "tag_id": {tag_id}, "op": "is_applied" }}"#
            )))
            .unwrap();
            assert!(!sql.contains("NOT EXISTS"), "{tag_id}");
            assert!(!sql.contains("CASE"), "{tag_id}");

            let (sql, _) = compile(&filter(&format!(
                r#"{{ "field": "tag", "tag_id": {tag_id}, "op": "is_not_applied" }}"#
            )))
            .unwrap();
            assert!(sql.contains("NOT EXISTS"), "{tag_id}");
            assert!(!sql.contains("CASE"), "{tag_id}");
        }
        assert!(is_format_err(compile(&filter(
            r#"{ "field": "tag", "tag_id": 2, "op": "is_applied", "value": "a" }"#
        ))));
    }

    #[test]
    fn operators_must_fit_the_tag_type() {
        for filter_json in [
            r#"{ "field": "tag", "tag_id": 1, "op": "is", "value": "a" }"#,
            r#"{ "field": "tag", "tag_id": 2, "op": "gt", "value": "1" }"#,
            r#"{ "field": "tag", "tag_id": 3, "op": "contains", "value": "a" }"#,
            r#"{ "field": "tag", "tag_id": 4, "op": "on", "value": "2000-01-01" }"#,
            r#"{ "field": "tag", "tag_id": 6, "op": "gt", "value": "1" }"#,
            r#"{ "field": "tag", "tag_id": 5, "op": "is", "value": "true" }"#,
            r#"{ "field": "tag", "tag_id": 1, "op": "is_empty" }"#,
            r#"{ "field": "tag_name", "op": "is_not_empty" }"#,
            r#"{ "field": "tag_name", "op": "is_applied" }"#,
            r#"{ "field": "tag_type", "op": "is_applied", "value": "text" }"#,
            r#"{ "field": "tag_type", "op": "contains", "value": "text" }"#,
        ] {
            assert!(
                is_format_err(compile(&filter(filter_json))),
                "{filter_json}"
            );
        }
    }

    #[test]
    fn values_must_fit_the_operator() {
        for filter_json in [
            r#"{ "field": "tag", "tag_id": 2, "op": "is" }"#,
            r#"{ "field": "tag", "tag_id": 2, "op": "contains", "value": "   " }"#,
            r#"{ "field": "tag", "tag_id": 2, "op": "is_empty", "value": "a" }"#,
            r#"{ "field": "tag", "tag_id": 3, "op": "on", "value": "2000-01-01" }"#,
            r#"{ "field": "tag", "tag_id": 3, "op": "on", "value": "yesterday" }"#,
            r#"{ "field": "tag", "tag_id": 6, "op": "on", "value": "2000-01-01T00:00:00Z" }"#,
            r#"{ "field": "tag", "tag_id": 6, "op": "on", "value": "2000-02-30" }"#,
            r#"{ "field": "tag", "tag_id": 4, "op": "eq", "value": "NaN" }"#,
            r#"{ "field": "tag", "tag_id": 4, "op": "eq", "value": "three" }"#,
            r#"{ "field": "tag", "tag_id": 5, "op": "is_true", "value": "true" }"#,
        ] {
            assert!(
                is_format_err(compile(&filter(filter_json))),
                "{filter_json}"
            );
        }
    }

    #[test]
    fn blank_values_are_fine_on_valueless_operators() {
        assert!(
            compile(&filter(
                r#"{ "field": "tag", "tag_id": 1, "op": "is_applied", "value": "" }"#
            ))
            .is_ok()
        );
        assert!(
            compile(&filter(
                r#"{ "field": "tag", "tag_id": 5, "op": "is_null", "value": null }"#
            ))
            .is_ok()
        );
    }

    #[test]
    fn unknown_tags_are_rejected() {
        assert!(is_format_err(compile(&filter(
            r#"{ "field": "tag", "tag_id": 99, "op": "is_applied" }"#
        ))));
    }

    #[test]
    fn oversized_queries_are_rejected() {
        let many = vec![r#"{ "and": [] }"#; MAX_NODES + 1].join(",");
        let query = parse(&format!(r#"{{ "where": {{ "or": [{}] }} }}"#, many));
        assert!(check_size(&query.root).is_err());

        let deep = format!(
            r#"{{ "where": {}{{ "and": [] }}{} }}"#,
            r#"{ "not": "#.repeat(MAX_DEPTH),
            " }".repeat(MAX_DEPTH)
        );
        assert!(check_size(&parse(&deep).root).is_err());
    }

    #[test]
    fn candidate_query_starts_from_every_supplied_song() {
        let candidates = vec!["untagged-song".to_string(), "tagged-song".to_string()];
        let (sql, values) = compile_over(
            &filter(r#"{ "field": "tag", "tag_id": 1, "op": "is_not_applied" }"#),
            &candidates,
        )
        .unwrap();

        assert!(sql.contains("FROM unnest($2::text[]) AS query_songs(song_id)"));
        assert!(sql.contains("AS applied_tags"), "{sql}");
        assert!(
            sql.contains("FROM user_tags_applied WHERE user_id=$1"),
            "{sql}"
        );
        assert!(sql.contains("NOT EXISTS"));
        // $1 is the user id and $2 the candidates, so the first tag lands on $3.
        assert!(sql.contains("filter_check.tag_id=$3"));
        assert_eq!(values.len(), 3);
    }

    #[test]
    fn tagged_song_query_keeps_the_original_parameter_order() {
        let (sql, values) = compile(
            r#"{ "where": { "and": [
                { "filter": { "field": "tag", "tag_id": 1, "op": "is_applied" } },
                { "filter": { "field": "tag", "tag_id": 2, "op": "is_applied" } }
            ] } }"#,
        )
        .unwrap();

        assert!(sql.contains("AS query_songs"), "{sql}");
        assert!(sql.contains("filter_check.tag_id=$2"));
        assert!(sql.contains("filter_check.tag_id=$3"));
        assert_eq!(values.len(), 3);
    }

    /// The flag decides what a tag on a song is, so it has to reach the outer
    /// row source, the candidate join, and every filter subquery alike. Missing
    /// one would silently match on user tags while ranking on both, or worse.
    #[test]
    fn default_tags_join_the_row_source_everywhere_or_nowhere() {
        let query = r#"{ "where": { "and": [
            { "filter": { "field": "tag", "tag_id": 1, "op": "is_applied" } },
            { "filter": { "field": "tag_name", "op": "contains", "value": "live" } }
        ] } }"#;

        let (without, _) = compile(query).unwrap();
        assert!(!without.contains("default_tags_applied"), "{without}");

        let (with, _) = compile_with_defaults(query).unwrap();
        // The outer row source, plus one per filter subquery.
        assert_eq!(
            with.matches("FROM default_tags_applied").count(),
            3,
            "{with}"
        );
        assert_eq!(with.matches("NULL::text AS value").count(), 3, "{with}");
        // The user's own tags are still in there, never replaced.
        assert_eq!(
            with.matches("FROM user_tags_applied WHERE user_id=$1")
                .count(),
            3,
            "{with}"
        );
    }

    /// A default tag the user removed is not one of their tags any more, so the
    /// exclusion has to ride along with the default branch everywhere it
    /// appears. One branch without it would let a removed tag satisfy a filter
    /// or score a song.
    #[test]
    fn removed_default_tags_are_left_out_of_every_default_branch() {
        let query = r#"{ "where": { "and": [
            { "filter": { "field": "tag", "tag_id": 1, "op": "is_applied" } },
            { "filter": { "field": "tag_name", "op": "contains", "value": "live" } }
        ] } }"#;

        let (with, _) = compile_with_defaults(query).unwrap();
        assert_eq!(
            with.matches("FROM default_tags_applied AS applied").count(),
            with.matches("FROM default_tags_removed AS removed").count(),
            "{with}"
        );
        // the removals are the reading user's own, so they bind the same $1
        assert_eq!(with.matches("removed.user_id=$1").count(), 3, "{with}");

        // nothing reads removals when defaults are out of the query
        let (without, _) = compile(query).unwrap();
        assert!(!without.contains("default_tags_removed"), "{without}");
    }

    #[test]
    fn a_default_tag_carries_no_value() {
        let (sql, _) = compile_with_defaults(&filter(
            r#"{ "field": "tag", "tag_id": 2, "op": "is_empty" }"#,
        ))
        .unwrap();

        // is_empty is NOT EXISTS of a present value, and a default tag's value
        // is always null, so a song holding only the default matches it.
        assert!(sql.contains("NOT EXISTS"), "{sql}");
        assert!(sql.contains("NULL::text AS value"), "{sql}");
    }

    #[test]
    fn both_forms_select_song_and_tag_pairs() {
        let (sql, _) = compile(r#"{ "where": { "and": [] } }"#).unwrap();
        assert!(sql.contains("SELECT query_songs.song_id, query_songs.tag_id"));

        let (sql, _) = compile_over(r#"{ "where": { "and": [] } }"#, &["a".to_string()]).unwrap();
        assert!(sql.contains("SELECT query_songs.song_id, applied_tags.tag_id"));
    }

    #[test]
    fn songs_are_ranked_by_how_many_mentioned_tags_they_carry() {
        let mentioned = HashSet::from([1, 2]);
        let pairs = vec![
            pair("one-match", Some(1)),
            pair("one-match", Some(9)),
            pair("two-matches", Some(1)),
            pair("two-matches", Some(2)),
            pair("no-tags", None),
        ];

        assert_eq!(
            rank_songs(pairs, &mentioned),
            vec!["two-matches", "one-match", "no-tags"]
        );
    }

    #[test]
    fn equal_scores_fall_back_to_song_id() {
        let pairs = vec![pair("b", None), pair("a", None), pair("c", None)];
        assert_eq!(rank_songs(pairs, &HashSet::new()), vec!["a", "b", "c"]);
    }
}
