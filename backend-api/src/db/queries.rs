use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDate, Utc};
use sea_orm::prelude::Uuid;
use sea_orm::{
    ColumnTrait, Condition, DatabaseConnection, DbBackend, EntityTrait, FromQueryResult,
    QueryFilter, Statement,
};

use crate::db::activity_tags::ActivityTag;
use crate::db::entity::sea_orm_active_enums::TagType;
use crate::db::entity::tags;
use crate::err::CadenzaError;
use crate::routes::json::query::{Filter, FilterOp, MetadataKey, Query, QueryNode};
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
/// The query runs over the user's whole library, meaning their rows in
/// `user_songs`, so a song carrying no tags at all can still satisfy a negative
/// filter. A song the user does not have can never come back, however it is
/// tagged.
///
/// With `consider_default_tags` a song's shared default tags count as tags on it
/// too, both for matching and for ranking, and the query may name a default tag
/// id. Otherwise only the user's own tags exist as far as the query is
/// concerned.
pub async fn run_query(
    db: &DatabaseConnection,
    query: &Query,
    user_id: Uuid,
    consider_default_tags: bool,
) -> Result<Vec<String>, CadenzaError> {
    check_size(&query.root)?;

    let mut tag_ids = HashSet::new();
    collect_tag_ids(&query.root, &mut tag_ids);
    let QueryableTags {
        tag_types,
        number_defaults,
    } = get_queryable_tags(db, user_id, &tag_ids, consider_default_tags).await?;

    let (sql, values) = compile_query(
        query,
        &tag_types,
        &number_defaults,
        user_id,
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

/// What the compiler needs to know about the tags a query names.
#[derive(Default)]
struct QueryableTags {
    /// The type of every tag the query mentions.
    tag_types: HashMap<i64, TagType>,
    /// Number tags whose missing row reads as a value rather than as empty,
    /// which is how "My Plays < 2" matches a song the user never played.
    number_defaults: HashMap<i64, f64>,
}

/// Looks up every tag the query mentions. A tag that does not exist or belongs
/// to someone else is a `QueryFormatError`.
///
/// Activity tags are shared by every user, so they are always queryable. With
/// `consider_default_tags` a shared default tag (`user_id IS NULL`) is
/// queryable as well, so the query may name one.
async fn get_queryable_tags(
    db: &DatabaseConnection,
    user_id: Uuid,
    tag_ids: &HashSet<i64>,
    consider_default_tags: bool,
) -> Result<QueryableTags, CadenzaError> {
    if tag_ids.is_empty() {
        return Ok(QueryableTags::default());
    }

    let mut owned_by_caller = Condition::any()
        .add(tags::Column::UserId.eq(user_id))
        .add(tags::Column::IsActivity.eq(true));
    if consider_default_tags {
        owned_by_caller = owned_by_caller.add(tags::Column::UserId.is_null());
    }

    let mut queryable = QueryableTags::default();
    for tag in tags::Entity::find()
        .filter(tags::Column::TagId.is_in(tag_ids.iter().copied()))
        .filter(owned_by_caller)
        .all(db)
        .await?
    {
        if tag.is_activity
            && tag.r#type == TagType::Number
            && let Some(default) = ActivityTag::from_name(&tag.name)
                .and_then(ActivityTag::default_value)
                .and_then(|value| value.parse::<f64>().ok())
        {
            queryable.number_defaults.insert(tag.tag_id, default);
        }
        queryable.tag_types.insert(tag.tag_id, tag.r#type);
    }

    if let Some(missing) = tag_ids
        .iter()
        .find(|id| !queryable.tag_types.contains_key(id))
    {
        return Err(CadenzaError::QueryFormatError(format!(
            "tag {} does not exist",
            missing
        )));
    }

    Ok(queryable)
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

/// The songs a query runs over: the user's whole library. Untagged songs are in
/// here too, which is what lets a negative filter match a song with no tag rows
/// at all.
const LIBRARY_SONGS_SOURCE: &str = "(SELECT song_id FROM user_songs WHERE user_id=$1)";

/// Converts the query to a full SQL statement and its values. `tag_types` must
/// hold the type of every tag id the query mentions. `number_defaults` holds
/// the number tags a song without the tag counts as having a value for (see
/// [`QueryableTags::number_defaults`]).
///
/// Every filter becomes one correlated `EXISTS` (or `NOT EXISTS`) over the
/// song's applied tags. A song without the tag at all counts as empty, so
/// negative operators (`is_not`, `not_on`, `ne`, `is_empty`, `is_null`) match
/// it.
///
/// The statement selects `(song id, tag id)` pairs rather than bare song ids, so
/// `rank_songs` can score each song by the tags it carries. Filters correlate
/// against `query_songs`, which is a song in the user's library. Its tags come
/// from a left join, so a song with none of them still reaches the where clause.
fn compile_query(
    query: &Query,
    tag_types: &HashMap<i64, TagType>,
    number_defaults: &HashMap<i64, f64>,
    user_id: Uuid,
    consider_default_tags: bool,
) -> Result<(String, Vec<sea_query::Value>), CadenzaError> {
    let applied_tags = applied_tags_source(consider_default_tags);
    let mut compiler = Compiler {
        tag_types,
        number_defaults,
        values: vec![sea_query::Value::Uuid(Some(user_id))],
        applied_tags,
    };
    let where_clause = compiler.node(&query.root)?;

    let sql = format!(
        r#"
            SELECT query_songs.song_id, applied_tags.tag_id
            FROM {LIBRARY_SONGS_SOURCE} AS query_songs
            LEFT JOIN {applied_tags} AS applied_tags
                ON applied_tags.song_id=query_songs.song_id
            WHERE {where_clause}
        "#
    );

    Ok((sql, compiler.values))
}

struct Compiler<'a> {
    tag_types: &'a HashMap<i64, TagType>,
    number_defaults: &'a HashMap<i64, f64>,
    /// `$1` is always the user id, so the first filter binds at `$2`.
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
            Filter::Metadata { key, op, value } => self.metadata_filter(*key, *op, value),
        }
    }

    /// A filter on the song's stored Apple Music metadata, one row per song in
    /// `metadata_song_tags_applied`. See [`MetadataKey`] for what each key takes.
    fn metadata_filter(
        &mut self,
        key: MetadataKey,
        op: FilterOp,
        value: &Option<String>,
    ) -> Result<String, CadenzaError> {
        let matched = match key {
            MetadataKey::Title => self.metadata_text_match("meta.name", op, value)?,
            MetadataKey::Artist => self.metadata_text_match("meta.artist_name", op, value)?,
            MetadataKey::Album => self.metadata_text_match("meta.album_name", op, value)?,

            // compared one genre at a time, so "is rock" means any of the song's genres is
            // rock, and "is not rock" means none is
            MetadataKey::Genre => match self.text_match("genre", op, value, "genre <> ''")? {
                Match::Any(condition) => Match::Any(genre_exists(&condition)),
                Match::None(condition) => Match::None(genre_exists(&condition)),
            },

            MetadataKey::ReleaseDate => match op {
                FilterOp::IsEmpty => {
                    no_value(op, value)?;
                    Match::None("meta.release_date IS NOT NULL".to_string())
                }
                FilterOp::IsNotEmpty => {
                    no_value(op, value)?;
                    Match::Any("meta.release_date IS NOT NULL".to_string())
                }
                FilterOp::On
                | FilterOp::NotOn
                | FilterOp::Before
                | FilterOp::After
                | FilterOp::OnOrBefore
                | FilterOp::OnOrAfter => {
                    let param = self.bind(parse_date(required_value(op, value)?)?);
                    let comparison = match op {
                        FilterOp::On | FilterOp::NotOn => "=",
                        FilterOp::Before => "<",
                        FilterOp::After => ">",
                        FilterOp::OnOrBefore => "<=",
                        _ => ">=",
                    };
                    let condition = format!("meta.release_date {comparison} {param}::date");
                    match op {
                        FilterOp::NotOn => Match::None(condition),
                        _ => Match::Any(condition),
                    }
                }
                _ => return Err(unsupported_op(op, "the release date")),
            },

            MetadataKey::Duration => match op {
                FilterOp::IsEmpty => {
                    no_value(op, value)?;
                    Match::None("meta.duration_in_millis IS NOT NULL".to_string())
                }
                FilterOp::IsNotEmpty => {
                    no_value(op, value)?;
                    Match::Any("meta.duration_in_millis IS NOT NULL".to_string())
                }
                FilterOp::Eq
                | FilterOp::Ne
                | FilterOp::Lt
                | FilterOp::Le
                | FilterOp::Gt
                | FilterOp::Ge => {
                    let param = self.bind(parse_number(required_value(op, value)?)?);
                    let comparison = match op {
                        FilterOp::Eq | FilterOp::Ne => "=",
                        FilterOp::Lt => "<",
                        FilterOp::Le => "<=",
                        FilterOp::Gt => ">",
                        _ => ">=",
                    };
                    let condition =
                        format!("meta.duration_in_millis::double precision {comparison} {param}");
                    match op {
                        FilterOp::Ne => Match::None(condition),
                        _ => Match::Any(condition),
                    }
                }
                _ => return Err(unsupported_op(op, "the duration")),
            },

            MetadataKey::TotalPlays => match op {
                FilterOp::Eq
                | FilterOp::Ne
                | FilterOp::Lt
                | FilterOp::Le
                | FilterOp::Gt
                | FilterOp::Ge => {
                    let param = self.bind(parse_number(required_value(op, value)?)?);
                    let comparison = match op {
                        FilterOp::Eq | FilterOp::Ne => "=",
                        FilterOp::Lt => "<",
                        FilterOp::Le => "<=",
                        FilterOp::Gt => ">",
                        _ => ">=",
                    };
                    let condition =
                        format!("meta.total_plays::double precision {comparison} {param}");
                    match op {
                        FilterOp::Ne => Match::None(condition),
                        _ => Match::Any(condition),
                    }
                }
                // never null, so there is no empty to ask about
                _ => return Err(unsupported_op(op, "total plays")),
            },

            MetadataKey::Explicit => {
                no_value(op, value)?;
                let explicit = "meta.content_rating = 'explicit'".to_string();
                match op {
                    FilterOp::IsTrue => Match::Any(explicit),
                    FilterOp::IsFalse => Match::None(explicit),
                    _ => return Err(unsupported_op(op, "explicit")),
                }
            }
        };

        Ok(metadata_exists(matched))
    }

    /// A text comparison on one of the stored metadata's text columns. An empty string
    /// counts as empty, the same as null.
    fn metadata_text_match(
        &mut self,
        column: &str,
        op: FilterOp,
        value: &Option<String>,
    ) -> Result<Match, CadenzaError> {
        self.text_match(column, op, value, &format!("{column} <> ''"))
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

        // For a number tag with a default, whether a song without the tag
        // passes: the operator applied to the default rather than to nothing.
        let mut missing_passes = None;

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
                    if let Some(default) = self.number_defaults.get(&tag_id) {
                        missing_passes = Some(match op {
                            FilterOp::Eq => *default == number,
                            FilterOp::Ne => *default != number,
                            FilterOp::Lt => *default < number,
                            FilterOp::Le => *default <= number,
                            FilterOp::Gt => *default > number,
                            _ => *default >= number,
                        });
                    }
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

        // Left alone, a song without the tag fails `Any` and passes `None`.
        // When the default says otherwise, add or rule out exactly those songs.
        let missing_passes_already = matches!(matched, Match::None(_));
        let snippet = tag_exists(self.applied_tags, &tag_param, true, matched);
        Ok(match missing_passes {
            Some(passes) if passes != missing_passes_already => {
                let applied = tag_exists(
                    self.applied_tags,
                    &tag_param,
                    false,
                    Match::Any("TRUE".into()),
                );
                if passes {
                    format!("({snippet} OR NOT {applied})")
                } else {
                    format!("({snippet} AND {applied})")
                }
            }
            _ => snippet,
        })
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

/// `EXISTS` over the song's stored metadata row. A song with no row, or one Apple has no
/// catalog entry for, fails `Any` and passes `None`, the same as a song without a tag.
fn metadata_exists(matched: Match) -> String {
    let (negate, condition) = match matched {
        Match::Any(condition) => ("", condition),
        Match::None(condition) => ("NOT ", condition),
    };

    format!(
        r#"
            {negate}EXISTS (
                SELECT 1 FROM metadata_song_tags_applied AS meta
                WHERE meta.song_id=query_songs.song_id AND meta.found AND {condition}
            )
        "#
    )
}

/// `EXISTS` over the song's genres one at a time, each as `genre`.
fn genre_exists(condition: &str) -> String {
    format!("EXISTS (SELECT 1 FROM unnest(meta.genre_names) AS genre WHERE {condition})")
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
        compile_query(
            &parse(json),
            &tag_types(),
            &HashMap::new(),
            Uuid::nil(),
            false,
        )
    }

    fn compile_with_defaults(json: &str) -> Result<(String, Vec<sea_query::Value>), CadenzaError> {
        compile_query(
            &parse(json),
            &tag_types(),
            &HashMap::new(),
            Uuid::nil(),
            true,
        )
    }

    /// Tag 4 is a number tag. Compiled as if it were My Plays, where a song
    /// with no row counts as 0.
    fn compile_with_zero_default(json: &str) -> String {
        compile_query(
            &parse(json),
            &tag_types(),
            &HashMap::from([(4, 0.0)]),
            Uuid::nil(),
            false,
        )
        .unwrap()
        .0
    }

    fn number_filter(op: &str, value: &str) -> String {
        filter(&format!(
            r#"{{ "field": "tag", "tag_id": 4, "op": "{op}", "value": "{value}" }}"#
        ))
    }

    fn squash(sql: &str) -> String {
        sql.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn a_missing_count_passes_when_zero_would() {
        // 0 < 2, so never played songs are added to the ones that match
        let sql = squash(&compile_with_zero_default(&number_filter("lt", "2")));
        assert!(sql.contains("OR NOT EXISTS"), "{sql}");
        // 0 = 0 as well
        let sql = squash(&compile_with_zero_default(&number_filter("eq", "0")));
        assert!(sql.contains("OR NOT EXISTS"), "{sql}");
        let sql = squash(&compile_with_zero_default(&number_filter("le", "0")));
        assert!(sql.contains("OR NOT EXISTS"), "{sql}");
    }

    #[test]
    fn a_missing_count_fails_when_zero_would() {
        // `ne` is a NOT EXISTS, which a missing row passes on its own, so
        // "!= 0" has to rule never played songs back out
        let sql = squash(&compile_with_zero_default(&number_filter("ne", "0")));
        assert!(sql.contains("AND EXISTS"), "{sql}");
        // 0 != 3 is true, and a missing row already passes, so nothing changes
        let sql = squash(&compile_with_zero_default(&number_filter("ne", "3")));
        assert!(
            !sql.contains("AND EXISTS") && !sql.contains("OR NOT"),
            "{sql}"
        );
    }

    #[test]
    fn a_missing_count_is_left_alone_when_zero_fails_anyway() {
        for (op, value) in [("gt", "0"), ("ge", "1"), ("eq", "5"), ("lt", "0")] {
            let with_default = squash(&compile_with_zero_default(&number_filter(op, value)));
            let without = squash(&compile(&number_filter(op, value)).unwrap().0);
            assert_eq!(with_default, without, "{op} {value}");
        }
    }

    #[test]
    fn number_tags_without_a_default_are_unchanged() {
        let sql = squash(&compile(&number_filter("lt", "2")).unwrap().0);
        assert!(!sql.contains("OR NOT"), "{sql}");
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

    /// The library, not the tagged songs, is the row source. An untagged song
    /// has to reach the where clause or `is_not_applied` could never match it.
    #[test]
    fn the_query_starts_from_the_users_library() {
        let (sql, values) = compile(&filter(
            r#"{ "field": "tag", "tag_id": 1, "op": "is_not_applied" }"#,
        ))
        .unwrap();

        assert!(
            sql.contains("FROM (SELECT song_id FROM user_songs WHERE user_id=$1) AS query_songs"),
            "{sql}"
        );
        assert!(sql.contains("LEFT JOIN"), "{sql}");
        assert!(sql.contains("AS applied_tags"), "{sql}");
        assert!(
            sql.contains("FROM user_tags_applied WHERE user_id=$1"),
            "{sql}"
        );
        assert!(sql.contains("NOT EXISTS"));
        // the user id is the only value bound before the filters
        assert!(sql.contains("filter_check.tag_id=$2"));
        assert_eq!(values.len(), 2);
    }

    #[test]
    fn filters_bind_in_order_after_the_user_id() {
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

    /// The flag decides what a tag on a song is, so it has to reach the ranking
    /// join and every filter subquery alike. Missing one would silently match on
    /// user tags while ranking on both, or worse.
    #[test]
    fn default_tags_join_the_row_source_everywhere_or_nowhere() {
        let query = r#"{ "where": { "and": [
            { "filter": { "field": "tag", "tag_id": 1, "op": "is_applied" } },
            { "filter": { "field": "tag_name", "op": "contains", "value": "live" } }
        ] } }"#;

        let (without, _) = compile(query).unwrap();
        assert!(!without.contains("default_tags_applied"), "{without}");

        let (with, _) = compile_with_defaults(query).unwrap();
        // The ranking join, plus one per filter subquery.
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
    fn the_statement_selects_song_and_tag_pairs() {
        let (sql, _) = compile(r#"{ "where": { "and": [] } }"#).unwrap();
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

    // ----- metadata filters -----

    fn metadata_filter(key: &str, op: &str, value: Option<&str>) -> String {
        let value = value
            .map(|value| format!(r#", "value": "{value}""#))
            .unwrap_or_default();
        filter(&format!(
            r#"{{ "field": "metadata", "key": "{key}", "op": "{op}"{value} }}"#
        ))
    }

    #[test]
    fn a_metadata_filter_reads_the_song_s_stored_row() {
        let (sql, values) = compile(&metadata_filter("artist", "starts_with", Some("P"))).unwrap();
        let sql = squash(&sql);

        assert!(
            sql.contains("EXISTS ( SELECT 1 FROM metadata_song_tags_applied AS meta WHERE meta.song_id=query_songs.song_id AND meta.found AND starts_with(lower(meta.artist_name), lower($2)) )"),
            "{sql}"
        );
        assert_eq!(values[1], sea_query::Value::from("P".to_string()));
    }

    #[test]
    fn negative_metadata_filters_match_songs_without_a_row() {
        let sql = squash(
            &compile(&metadata_filter("title", "is_not", Some("One")))
                .unwrap()
                .0,
        );
        assert!(
            sql.contains("NOT EXISTS ( SELECT 1 FROM metadata_song_tags_applied"),
            "{sql}"
        );

        let sql = squash(
            &compile(&metadata_filter("album", "is_empty", None))
                .unwrap()
                .0,
        );
        assert!(sql.contains("NOT EXISTS"), "{sql}");
        assert!(sql.contains("meta.album_name <> ''"), "{sql}");
    }

    #[test]
    fn genre_matches_any_one_of_the_song_s_genres() {
        let sql = squash(
            &compile(&metadata_filter("genre", "is", Some("rock")))
                .unwrap()
                .0,
        );
        assert!(
            sql.contains("EXISTS (SELECT 1 FROM unnest(meta.genre_names) AS genre WHERE lower(genre) = lower($2))"),
            "{sql}"
        );

        // "is not rock" is no genre being rock, not some genre being something else
        let sql = squash(
            &compile(&metadata_filter("genre", "is_not", Some("rock")))
                .unwrap()
                .0,
        );
        assert!(sql.trim_start().contains("WHERE NOT EXISTS"), "{sql}");
    }

    #[test]
    fn release_date_compares_days() {
        let (sql, values) = compile(&metadata_filter(
            "release_date",
            "before",
            Some("2000-01-01"),
        ))
        .unwrap();
        assert!(
            squash(&sql).contains("meta.release_date < $2::date"),
            "{sql}"
        );
        assert_eq!(values[1], sea_query::Value::from("2000-01-01".to_string()));

        assert!(is_format_err(compile(&metadata_filter(
            "release_date",
            "before",
            Some("last year")
        ))));
    }

    #[test]
    fn duration_compares_milliseconds() {
        let (sql, values) = compile(&metadata_filter("duration", "lt", Some("210000"))).unwrap();
        assert!(
            squash(&sql).contains("meta.duration_in_millis::double precision < $2"),
            "{sql}"
        );
        assert_eq!(values[1], sea_query::Value::from(210000.0));

        let sql = squash(
            &compile(&metadata_filter("duration", "ne", Some("3")))
                .unwrap()
                .0,
        );
        assert!(sql.contains("NOT EXISTS"), "{sql}");
    }

    #[test]
    fn total_plays_compares_a_count() {
        let (sql, values) = compile(&metadata_filter("total_plays", "ge", Some("10"))).unwrap();
        assert!(
            squash(&sql).contains("meta.total_plays::double precision >= $2"),
            "{sql}"
        );
        assert_eq!(values[1], sea_query::Value::from(10.0));

        // a count is never null, so there is no empty to ask about
        assert!(is_format_err(compile(&metadata_filter(
            "total_plays",
            "is_empty",
            None
        ))));
    }

    #[test]
    fn explicit_is_a_yes_or_no() {
        let sql = squash(
            &compile(&metadata_filter("explicit", "is_true", None))
                .unwrap()
                .0,
        );
        assert!(
            sql.contains("AND meta.content_rating = 'explicit' )"),
            "{sql}"
        );
        assert!(!sql.contains("NOT EXISTS"), "{sql}");

        // false takes in clean songs, unrated songs, and songs with no row
        let sql = squash(
            &compile(&metadata_filter("explicit", "is_false", None))
                .unwrap()
                .0,
        );
        assert!(sql.contains("NOT EXISTS"), "{sql}");
    }

    #[test]
    fn metadata_keys_only_take_their_own_operators() {
        assert!(is_format_err(compile(&metadata_filter(
            "artist",
            "gt",
            Some("1")
        ))));
        assert!(is_format_err(compile(&metadata_filter(
            "duration",
            "contains",
            Some("1")
        ))));
        assert!(is_format_err(compile(&metadata_filter(
            "release_date",
            "is",
            Some("x")
        ))));
        assert!(is_format_err(compile(&metadata_filter(
            "explicit", "is_null", None
        ))));
        assert!(is_format_err(compile(&metadata_filter(
            "explicit",
            "is_true",
            Some("x")
        ))));
        assert!(is_format_err(compile(&metadata_filter(
            "title",
            "is_applied",
            None
        ))));
        assert!(is_format_err(compile(&metadata_filter(
            "duration",
            "gt",
            Some("long")
        ))));
    }

    #[test]
    fn an_unknown_metadata_key_does_not_parse() {
        assert!(serde_json::from_str::<Query>(&metadata_filter("bpm", "eq", Some("120"))).is_err());
    }

    #[test]
    fn metadata_and_tag_filters_combine_and_name_only_the_tag() {
        let json = r#"{ "where": { "and": [
            { "filter": { "field": "metadata", "key": "duration", "op": "eq", "value": "3" } },
            { "filter": { "field": "tag", "tag_id": 1, "op": "is_applied" } }
        ] } }"#;
        let (sql, _) = compile(json).unwrap();
        let sql = squash(&sql);
        assert!(
            sql.contains("FROM metadata_song_tags_applied AS meta"),
            "{sql}"
        );
        assert!(sql.contains("filter_check.tag_id=$3"), "{sql}");

        let mut ids = HashSet::new();
        collect_tag_ids(&parse(json).root, &mut ids);
        assert_eq!(ids, HashSet::from([1]), "a metadata filter names no tag");
    }

    // ----- metadata filters against a real database -----
    //
    // Runs the compiled statements in a transaction that is never committed. Needs
    // DATABASE_URL, a user in auth.users, and the tables from sql/metadata_tags.sql. Run
    // with `cargo test -- --ignored`.

    use sea_orm::{ConnectionTrait, Database, DatabaseTransaction, TransactionTrait};

    /// A scratch library: four songs for a real user, three with stored metadata.
    ///
    /// - `p1` "Paint It Black", The Rolling Stones, rock and pop, 1966, 3:45, explicit, 40 plays
    /// - `p2` "Purple Rain", Prince, pop, 1984-06-25, 8:41, clean, 3 plays
    /// - `n1` Apple has no catalog entry for it
    /// - `x1` never stored
    async fn metadata_library() -> (DatabaseTransaction, Uuid) {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let db = Database::connect(url).await.expect("connect");
        let txn = db.begin().await.expect("begin");

        let user_id: Uuid = txn
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                "select id from auth.users limit 1",
            ))
            .await
            .unwrap()
            .expect("the database needs at least one user for this test")
            .try_get_by_index(0)
            .unwrap();

        // the user's real library would land in every result, so it goes for this test
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "DELETE FROM user_songs WHERE user_id = $1",
            [user_id.into()],
        ))
        .await
        .unwrap();

        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
            INSERT INTO user_songs (song_id, user_id)
            SELECT song_id, $1
            FROM unnest(ARRAY['test-q-p1', 'test-q-p2', 'test-q-n1', 'test-q-x1']) AS song_id
            "#,
            [user_id.into()],
        ))
        .await
        .unwrap();

        txn.execute_raw(Statement::from_string(
            DbBackend::Postgres,
            r#"
            INSERT INTO metadata_song_tags_applied
                (song_id, found, name, artist_name, album_name, album_id, duration_in_millis,
                 genre_names, release_date, content_rating, total_plays)
            VALUES
                ('test-q-p1', true, 'Paint It Black', 'The Rolling Stones', 'Aftermath', 'a1',
                 225000, ARRAY['Rock', 'Pop'], '1966-01-01', 'explicit', 40),
                ('test-q-p2', true, 'Purple Rain', 'Prince', 'Purple Rain', 'a2',
                 521000, ARRAY['Pop'], '1984-06-25', 'clean', 3),
                ('test-q-n1', false, NULL, NULL, NULL, NULL, NULL, '{}', NULL, NULL, 7)
            "#,
        ))
        .await
        .unwrap();

        (txn, user_id)
    }

    async fn run_metadata_query(
        txn: &DatabaseTransaction,
        user_id: Uuid,
        json: &str,
    ) -> Vec<String> {
        let (sql, values) =
            compile_query(&parse(json), &tag_types(), &HashMap::new(), user_id, false).unwrap();
        let pairs = SongTagPair::find_by_statement(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            values,
        ))
        .all(txn)
        .await
        .unwrap();

        let mut songs: Vec<String> = rank_songs(pairs, &HashSet::new())
            .into_iter()
            .map(|song_id| song_id.trim_start_matches("test-q-").to_owned())
            .collect();
        songs.sort();
        songs
    }

    #[tokio::test]
    #[ignore]
    async fn metadata_filters_run_against_stored_rows() {
        let (txn, user_id) = metadata_library().await;
        let q = |key: &str, op: &str, value: Option<&str>| metadata_filter(key, op, value);

        let cases: Vec<(String, Vec<&str>)> = vec![
            (q("artist", "starts_with", Some("p")), vec!["p2"]),
            (q("artist", "contains", Some("ROLLING")), vec!["p1"]),
            (q("title", "is", Some("purple rain")), vec!["p2"]),
            (
                q("title", "is_not", Some("purple rain")),
                vec!["n1", "p1", "x1"],
            ),
            (q("album", "ends_with", Some("math")), vec!["p1"]),
            (q("album", "is_empty", None), vec!["n1", "x1"]),
            (q("genre", "is", Some("pop")), vec!["p1", "p2"]),
            (q("genre", "is_not", Some("rock")), vec!["n1", "p2", "x1"]),
            (q("genre", "is_empty", None), vec!["n1", "x1"]),
            (q("release_date", "before", Some("1980-01-01")), vec!["p1"]),
            (q("release_date", "on", Some("1984-06-25")), vec!["p2"]),
            (
                q("release_date", "not_on", Some("1984-06-25")),
                vec!["n1", "p1", "x1"],
            ),
            (q("release_date", "is_not_empty", None), vec!["p1", "p2"]),
            (q("duration", "lt", Some("240000")), vec!["p1"]),
            (q("duration", "ge", Some("510000")), vec!["p2"]),
            (q("total_plays", "gt", Some("10")), vec!["p1"]),
            (q("total_plays", "ne", Some("40")), vec!["n1", "p2", "x1"]),
            (q("explicit", "is_true", None), vec!["p1"]),
            (q("explicit", "is_false", None), vec!["n1", "p2", "x1"]),
        ];

        for (json, expected) in cases {
            assert_eq!(
                run_metadata_query(&txn, user_id, &json).await,
                expected,
                "{json}"
            );
        }
    }

    #[tokio::test]
    #[ignore]
    async fn metadata_and_tag_filters_combine_in_one_query() {
        let (txn, user_id) = metadata_library().await;

        let tag_id: i64 = txn
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO tags (name, color, user_id) VALUES ('test-q-tag', '#000000', $1) RETURNING tag_id",
                [user_id.into()],
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get_by_index(0)
            .unwrap();
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO user_tags_applied (song_id, user_id, tag_id) VALUES ('test-q-p1', $1, $2), ('test-q-x1', $1, $2)",
            [user_id.into(), tag_id.into()],
        ))
        .await
        .unwrap();

        let (sql, values) = compile_query(
            &parse(&format!(
                r#"{{ "where": {{ "and": [
                    {{ "filter": {{ "field": "metadata", "key": "genre", "op": "is", "value": "pop" }} }},
                    {{ "filter": {{ "field": "tag", "tag_id": {tag_id}, "op": "is_applied" }} }}
                ] }} }}"#
            )),
            &HashMap::from([(tag_id, TagType::Basic)]),
            &HashMap::new(),
            user_id,
            false,
        )
        .unwrap();
        let pairs = SongTagPair::find_by_statement(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            values,
        ))
        .all(&txn)
        .await
        .unwrap();

        assert_eq!(
            rank_songs(pairs, &HashSet::from([tag_id])),
            vec!["test-q-p1"]
        );
    }
}
