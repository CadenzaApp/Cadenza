use std::collections::{HashMap, HashSet};

use chrono::NaiveDate;
use sea_orm::prelude::Uuid;
use sea_orm::{
    ColumnTrait, DatabaseConnection, DbBackend, EntityTrait, FromQueryResult, QueryFilter,
    Statement,
};

use crate::db::entity::sea_orm_active_enums::TagType;
use crate::db::entity::tags;
use crate::err::CadenzaError;
use crate::routes::json::advanced_query::{
    AdvancedFilter, AdvancedQuery, AdvancedQueryNode, FilterOp,
};
use crate::routes::json::tag::TagType as JsonTagType;

/// Caps on the size of a query tree, so one request cannot build a huge
/// statement.
const MAX_NODES: usize = 200;
const MAX_DEPTH: usize = 20;

#[derive(Debug, FromQueryResult)]
struct MatchedSong {
    song_id: String,
}

#[derive(Debug, FromQueryResult)]
struct TimezoneCheck {
    valid: bool,
}

/// Returns the ids of every song matching the given advanced query, sorted by
/// song id so the order is stable between requests.
///
/// Like the simple query, only songs with at least one of the user's tags on
/// them can match.
pub async fn run_advanced_query(
    db: &DatabaseConnection,
    query: &AdvancedQuery,
    user_id: Uuid,
) -> Result<Vec<String>, CadenzaError> {
    check_size(&query.root)?;

    let mut tag_ids = HashSet::new();
    collect_tag_ids(&query.root, &mut tag_ids);
    let tag_types = get_owned_tag_types(db, user_id, &tag_ids).await?;

    if uses_timezone(&query.root) {
        check_timezone(db, &query.timezone).await?;
    }

    let (sql, values) = compile_advanced_query(query, &tag_types, user_id)?;

    let songs = MatchedSong::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        values,
    ))
    .all(db)
    .await?;

    Ok(songs.into_iter().map(|song| song.song_id).collect())
}

/// Looks up the type of every tag the query mentions. A tag that does not exist
/// or belongs to someone else is a `QueryFormatError`.
async fn get_owned_tag_types(
    db: &DatabaseConnection,
    user_id: Uuid,
    tag_ids: &HashSet<i64>,
) -> Result<HashMap<i64, TagType>, CadenzaError> {
    if tag_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let tag_types: HashMap<i64, TagType> = tags::Entity::find()
        .filter(tags::Column::TagId.is_in(tag_ids.iter().copied()))
        .filter(tags::Column::UserId.eq(user_id))
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

/// Postgres errors on an unknown time zone name, which would surface as a 500,
/// so check it up front and answer a 422 instead.
async fn check_timezone(db: &DatabaseConnection, timezone: &str) -> Result<(), CadenzaError> {
    let check = TimezoneCheck::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1) AS valid",
        [timezone.into()],
    ))
    .one(db)
    .await?;

    match check {
        Some(TimezoneCheck { valid: true }) => Ok(()),
        _ => Err(CadenzaError::QueryFormatError(format!(
            "'{}' is not a known time zone",
            timezone
        ))),
    }
}

fn check_size(root: &AdvancedQueryNode) -> Result<(), CadenzaError> {
    fn walk(node: &AdvancedQueryNode, depth: usize, count: &mut usize) -> Result<(), CadenzaError> {
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
            AdvancedQueryNode::And(children) | AdvancedQueryNode::Or(children) => {
                for child in children {
                    walk(child, depth + 1, count)?;
                }
                Ok(())
            }
            AdvancedQueryNode::Not(child) => walk(child, depth + 1, count),
            AdvancedQueryNode::Filter(_) => Ok(()),
        }
    }

    walk(root, 1, &mut 0)
}

fn collect_tag_ids(node: &AdvancedQueryNode, out: &mut HashSet<i64>) {
    match node {
        AdvancedQueryNode::And(children) | AdvancedQueryNode::Or(children) => {
            for child in children {
                collect_tag_ids(child, out);
            }
        }
        AdvancedQueryNode::Not(child) => collect_tag_ids(child, out),
        AdvancedQueryNode::Filter(AdvancedFilter::Tag { tag_id, .. }) => {
            out.insert(*tag_id);
        }
        AdvancedQueryNode::Filter(_) => {}
    }
}

/// True if any filter compares a datetime by calendar day, which is the only
/// thing the time zone is used for.
fn uses_timezone(node: &AdvancedQueryNode) -> bool {
    match node {
        AdvancedQueryNode::And(children) | AdvancedQueryNode::Or(children) => {
            children.iter().any(uses_timezone)
        }
        AdvancedQueryNode::Not(child) => uses_timezone(child),
        AdvancedQueryNode::Filter(AdvancedFilter::Tag { op, .. }) => matches!(
            op,
            FilterOp::On
                | FilterOp::NotOn
                | FilterOp::Before
                | FilterOp::After
                | FilterOp::OnOrBefore
                | FilterOp::OnOrAfter
        ),
        AdvancedQueryNode::Filter(_) => false,
    }
}

/// Converts the query to a full SQL statement and its values. `tag_types` must
/// hold the type of every tag id the query mentions.
///
/// Every filter becomes one correlated `EXISTS` (or `NOT EXISTS`) over the
/// song's applied tags. A song without the tag at all counts as empty, so
/// negative operators (`is_not`, `not_on`, `ne`, `is_empty`, `is_null`) match
/// it.
fn compile_advanced_query(
    query: &AdvancedQuery,
    tag_types: &HashMap<i64, TagType>,
    user_id: Uuid,
) -> Result<(String, Vec<sea_query::Value>), CadenzaError> {
    let mut compiler = Compiler {
        tag_types,
        timezone: &query.timezone,
        timezone_param: None,
        values: vec![sea_query::Value::Uuid(Some(user_id))],
    };
    let where_clause = compiler.node(&query.root)?;

    let sql = format!(
        r#"
            SELECT DISTINCT user_tags_applied.song_id
            FROM user_tags_applied
            WHERE user_tags_applied.user_id=$1 AND {}
            ORDER BY user_tags_applied.song_id
        "#,
        where_clause
    );

    Ok((sql, compiler.values))
}

struct Compiler<'a> {
    tag_types: &'a HashMap<i64, TagType>,
    timezone: &'a str,
    /// Placeholder of the time zone, bound the first time a filter needs it.
    timezone_param: Option<String>,
    /// `$1` is always the user id.
    values: Vec<sea_query::Value>,
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

    fn timezone(&mut self) -> String {
        if let Some(param) = &self.timezone_param {
            return param.clone();
        }
        let param = self.bind(self.timezone.to_string());
        self.timezone_param = Some(param.clone());
        param
    }

    /// Converts a node to a SQL snippet.
    fn node(&mut self, node: &AdvancedQueryNode) -> Result<String, CadenzaError> {
        match node {
            AdvancedQueryNode::And(children) => self.group(children, " AND ", "TRUE"),
            AdvancedQueryNode::Or(children) => self.group(children, " OR ", "FALSE"),
            AdvancedQueryNode::Not(child) => Ok(format!("NOT ({})", self.node(child)?)),
            AdvancedQueryNode::Filter(filter) => self.filter(filter),
        }
    }

    /// Joins child snippets. An empty `and` is true and an empty `or` is false.
    fn group(
        &mut self,
        children: &[AdvancedQueryNode],
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

    fn filter(&mut self, filter: &AdvancedFilter) -> Result<String, CadenzaError> {
        match filter {
            AdvancedFilter::Tag { tag_id, op, value } => self.tag_filter(*tag_id, *op, value),
            AdvancedFilter::TagName { op, value } => {
                let matched =
                    self.text_match("filter_tag.name", *op, value, "filter_tag.name <> ''")?;
                Ok(joined_exists(matched))
            }
            AdvancedFilter::TagValue { op, value } => {
                let matched = self.text_match(
                    "filter_check.value",
                    *op,
                    value,
                    "filter_check.value IS NOT NULL",
                )?;
                Ok(joined_exists(matched))
            }
            AdvancedFilter::TagType { op, value } => {
                let tag_type = self.bind(tag_type_name(*value));
                let condition = format!("filter_tag.type::text = {}", tag_type);
                match op {
                    FilterOp::Is => Ok(joined_exists(Match::Any(condition))),
                    FilterOp::IsNot => Ok(joined_exists(Match::None(condition))),
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

        let matched = match tag_type {
            TagType::Basic => {
                no_value(op, value)?;
                match op {
                    FilterOp::IsApplied => Match::Any("TRUE".to_string()),
                    FilterOp::IsNotApplied => Match::None("TRUE".to_string()),
                    _ => return Err(unsupported_op(op, "basic tags")),
                }
            }

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

            TagType::Datetime => match op {
                FilterOp::IsEmpty => {
                    no_value(op, value)?;
                    Match::None("TRUE".to_string())
                }
                FilterOp::IsNotEmpty => {
                    no_value(op, value)?;
                    Match::Any("TRUE".to_string())
                }
                FilterOp::On
                | FilterOp::NotOn
                | FilterOp::Before
                | FilterOp::After
                | FilterOp::OnOrBefore
                | FilterOp::OnOrAfter => {
                    let date = parse_date(required_value(op, value)?)?;
                    let timezone = self.timezone();
                    let param = self.bind(date);
                    let comparison = match op {
                        FilterOp::On | FilterOp::NotOn => "=",
                        FilterOp::Before => "<",
                        FilterOp::After => ">",
                        FilterOp::OnOrBefore => "<=",
                        _ => ">=",
                    };
                    let condition = format!(
                        "(filter_check.value::timestamptz AT TIME ZONE {timezone})::date {comparison} {param}::date"
                    );
                    match op {
                        FilterOp::NotOn => Match::None(condition),
                        _ => Match::Any(condition),
                    }
                }
                _ => return Err(unsupported_op(op, "datetime tags")),
            },

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

        Ok(tag_exists(&tag_param, tag_type, matched))
    }
}

/// `EXISTS` over the song's applications of one tag.
///
/// For attribute tags the condition only ever sees that tag's non-null values.
/// It sits inside a `CASE` because postgres does not promise to check the
/// other `WHERE` terms first, and a cast like `value::double precision` would
/// fail on another tag's text value.
fn tag_exists(tag_param: &str, tag_type: TagType, matched: Match) -> String {
    let (negate, condition) = match matched {
        Match::Any(condition) => ("", condition),
        Match::None(condition) => ("NOT ", condition),
    };

    let condition = match tag_type {
        TagType::Basic => condition,
        _ => format!(
            "CASE WHEN filter_check.tag_id = {tag_param} AND filter_check.value IS NOT NULL THEN {condition} ELSE FALSE END"
        ),
    };

    format!(
        r#"
            {negate}EXISTS (
                SELECT 1 FROM user_tags_applied AS filter_check
                WHERE filter_check.song_id=user_tags_applied.song_id AND filter_check.user_id=$1 AND filter_check.tag_id={tag_param} AND {condition}
            )
        "#
    )
}

/// `EXISTS` over every tag applied to the song, joined to the tag itself, for
/// filters on tag names, values and types.
fn joined_exists(matched: Match) -> String {
    let (negate, condition) = match matched {
        Match::Any(condition) => ("", condition),
        Match::None(condition) => ("NOT ", condition),
    };

    format!(
        r#"
            {negate}EXISTS (
                SELECT 1 FROM user_tags_applied AS filter_check
                JOIN tags AS filter_tag ON filter_tag.tag_id=filter_check.tag_id
                WHERE filter_check.song_id=user_tags_applied.song_id AND filter_check.user_id=$1 AND {condition}
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

/// Datetime filters compare calendar days, so the value is a plain
/// `YYYY-MM-DD` date. Returned in that same canonical form.
fn parse_date(value: &str) -> Result<String, CadenzaError> {
    match NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        Ok(date) => Ok(date.format("%Y-%m-%d").to_string()),
        Err(_) => Err(CadenzaError::QueryFormatError(format!(
            "'{}' is not a YYYY-MM-DD date",
            value
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> AdvancedQuery {
        serde_json::from_str(json).unwrap()
    }

    fn tag_types() -> HashMap<i64, TagType> {
        HashMap::from([
            (1, TagType::Basic),
            (2, TagType::Text),
            (3, TagType::Datetime),
            (4, TagType::Number),
            (5, TagType::Checkbox),
        ])
    }

    fn compile(json: &str) -> Result<(String, Vec<sea_query::Value>), CadenzaError> {
        compile_advanced_query(&parse(json), &tag_types(), Uuid::nil())
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
                "timezone": "America/Denver",
                "where": { "and": [
                    { "filter": { "field": "tag", "tag_id": 3, "op": "on_or_after", "value": "1950-01-01" } },
                    { "filter": { "field": "tag", "tag_id": 3, "op": "before", "value": "1961-01-01" } },
                    { "not": { "or": [
                        { "filter": { "field": "tag_name", "op": "contains", "value": "live" } },
                        { "filter": { "field": "tag_type", "op": "is", "value": "checkbox" } }
                    ] } }
                ] }
            }"#,
        );
        assert_eq!(query.timezone, "America/Denver");

        let mut ids = HashSet::new();
        collect_tag_ids(&query.root, &mut ids);
        assert_eq!(ids, HashSet::from([3]));
        assert!(uses_timezone(&query.root));
        assert!(check_size(&query.root).is_ok());
    }

    #[test]
    fn timezone_defaults_to_utc() {
        assert_eq!(parse(r#"{ "where": { "and": [] } }"#).timezone, "UTC");
    }

    #[test]
    fn rejects_unknown_node_keys_and_ops() {
        assert!(serde_json::from_str::<AdvancedQuery>(r#"{ "where": { "xor": [] } }"#).is_err());
        assert!(
            serde_json::from_str::<AdvancedQuery>(&filter(
                r#"{ "field": "tag", "tag_id": 2, "op": "like", "value": "a" }"#
            ))
            .is_err()
        );
        assert!(serde_json::from_str::<AdvancedQuery>(r#"{ "root": { "and": [] } }"#).is_err());
    }

    #[test]
    fn user_id_is_always_the_first_param() {
        let (sql, values) = compile(r#"{ "where": { "and": [] } }"#).unwrap();
        assert!(sql.contains("user_tags_applied.user_id=$1 AND TRUE"));
        assert_eq!(values, vec![sea_query::Value::Uuid(Some(Uuid::nil()))]);
    }

    #[test]
    fn empty_groups_are_true_for_and_and_false_for_or() {
        let (sql, _) = compile(r#"{ "where": { "or": [] } }"#).unwrap();
        assert!(sql.contains("AND FALSE"));
        let (sql, _) = compile(r#"{ "where": { "not": { "or": [] } } }"#).unwrap();
        assert!(sql.contains("AND NOT (FALSE)"));
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
            r#"{ "field": "tag", "tag_id": 3, "op": "not_on", "value": "2000-01-01" }"#,
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
            r#"{ "field": "tag", "tag_id": 3, "op": "before", "value": "2000-01-01" }"#,
        ))
        .unwrap();
        assert!(sql.contains(
            "CASE WHEN filter_check.tag_id = $2 AND filter_check.value IS NOT NULL THEN (filter_check.value::timestamptz AT TIME ZONE $3)::date < $4::date ELSE FALSE END"
        ));
    }

    #[test]
    fn timezone_is_bound_once() {
        let (_, values) = compile(
            r#"{ "timezone": "Asia/Tokyo", "where": { "and": [
                { "filter": { "field": "tag", "tag_id": 3, "op": "on", "value": "2000-01-01" } },
                { "filter": { "field": "tag", "tag_id": 3, "op": "after", "value": "1999-01-01" } }
            ] } }"#,
        )
        .unwrap();
        let timezones = values
            .iter()
            .filter(|value| **value == sea_query::Value::String(Some("Asia/Tokyo".to_string())))
            .count();
        assert_eq!(timezones, 1);
    }

    #[test]
    fn operators_must_fit_the_tag_type() {
        for filter_json in [
            r#"{ "field": "tag", "tag_id": 1, "op": "is", "value": "a" }"#,
            r#"{ "field": "tag", "tag_id": 2, "op": "gt", "value": "1" }"#,
            r#"{ "field": "tag", "tag_id": 3, "op": "contains", "value": "a" }"#,
            r#"{ "field": "tag", "tag_id": 4, "op": "on", "value": "2000-01-01" }"#,
            r#"{ "field": "tag", "tag_id": 5, "op": "is_applied" }"#,
            r#"{ "field": "tag_name", "op": "is_not_empty" }"#,
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
            r#"{ "field": "tag", "tag_id": 3, "op": "on", "value": "2000-01-01T00:00:00Z" }"#,
            r#"{ "field": "tag", "tag_id": 3, "op": "on", "value": "2000-02-30" }"#,
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
}
