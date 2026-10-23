use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDate, Utc};
use sea_orm::prelude::Uuid;
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait,
    FromQueryResult, QueryFilter, Statement,
};

use crate::db::activity_tags::ActivityTag;
use crate::db::entity::sea_orm_active_enums::TagType;
use crate::db::entity::tags;
use crate::err::CadenzaError;
use crate::routes::json::query::{
    ArrangeField, Filter, FilterOp, GroupState, MetadataKey, Query, QueryGroup, QueryNode,
    QuerySort, SortDirection,
};
use crate::routes::json::tag::TagType as JsonTagType;

/// Caps on the size of a query tree, so one request cannot build a huge
/// statement.
const MAX_NODES: usize = 200;
const MAX_DEPTH: usize = 20;

/// The most matches an unsorted query returns from outside the user's own songs. The
/// user's own matches are never cut off.
pub const MAX_DISCOVERED_SONGS: usize = 1000;

/// The most songs a sorted or grouped query returns, the user's own included. The user
/// asked for an order, so the list is the first songs in that order, whoever's they are.
pub const MAX_ARRANGED_SONGS: usize = 1000;

/// The most song ids `arrange_song_ids` takes, so one request cannot sort a huge list.
pub const MAX_ARRANGED_SONG_IDS: usize = 20_000;

/// The user's own songs, as a CTE body: their library, and every song carrying one of their
/// tags (activity tags included).
///
/// Default tags do not make a song the user's own. They are on songs from every user's
/// library, so counting them would make a query like "not pop" return thousands of other
/// people's songs uncapped.
const OWN_SONGS: &str = "
    SELECT song_id FROM user_songs WHERE user_id=$1
    UNION
    SELECT song_id FROM user_tags_applied WHERE user_id=$1
";

/// The user's own songs when a query is limited to their library: only their `user_songs`
/// rows, not songs that carry one of their tags without being in the library.
const LIBRARY_SONGS: &str = "
    SELECT song_id FROM user_songs WHERE user_id=$1
";

/// The stored metadata every song row carries, read off `stored`, a
/// `metadata_song_tags_applied` row joined on `found`. An empty string reads as missing.
/// Genre is the song's genres as one text value, joined with ", ". `has_metadata` is false
/// for a song with no row, or one Apple has no entry for.
const STORED_COLUMNS: &str = "
        NULLIF(stored.name, '') AS title,
        NULLIF(stored.artist_name, '') AS artist,
        NULLIF(stored.album_name, '') AS album,
        NULLIF(array_to_string(stored.genre_names, ', '), '') AS genre,
        stored.release_date,
        stored.duration_in_millis AS duration,
        stored.content_rating,
        COALESCE(stored.total_plays, 0) AS total_plays,
        stored.song_id IS NOT NULL AS has_metadata
";

/// The user's own songs as rows a query runs over, as a `FROM` item: every one is
/// `certain`, with whatever metadata is stored for it. Untagged songs are in here too, which
/// is what lets a negative filter match a song with no tag rows at all.
fn own_query_songs() -> String {
    format!(
        "(
            SELECT own_songs.song_id, TRUE AS certain, {STORED_COLUMNS}
            FROM own_songs
            LEFT JOIN metadata_song_tags_applied AS stored
                ON stored.song_id=own_songs.song_id AND stored.found
        )"
    )
}

/// Every other song a query runs over, as a `FROM` item: the stored songs Apple has a
/// catalog entry for that are not the user's own. Songs Cadenza found elsewhere, so none is
/// `certain`, and only the first of them come back.
///
/// Rows a phone sent for a song only it knows (`source` 'library', see
/// `sql/sort_group.sql`) are some user's own song, never a song to discover.
///
/// The stored rows are scanned once and the user's own songs hash joined off them, which
/// stays fast with hundreds of thousands of stored songs.
fn discovered_query_songs() -> String {
    format!(
        "(
            SELECT stored.song_id, FALSE AS certain, {STORED_COLUMNS}
            FROM metadata_song_tags_applied AS stored
            LEFT JOIN own_songs ON own_songs.song_id=stored.song_id
            WHERE stored.found AND stored.source = 'catalog' AND own_songs.song_id IS NULL
        )"
    )
}

/// A list of song ids the caller sent, as a `FROM` item, each `certain` and carrying its
/// place in the list as `position`. `ids` is the placeholder of a JSON array of the ids.
fn given_query_songs(ids: &str) -> String {
    format!(
        "(
            SELECT given.song_id, TRUE AS certain, given.position, {STORED_COLUMNS}
            FROM json_array_elements_text({ids}::json) WITH ORDINALITY AS given(song_id, position)
            LEFT JOIN metadata_song_tags_applied AS stored
                ON stored.song_id=given.song_id AND stored.found
        )"
    )
}

/// The collation sorted text is compared in. `sql/query_sort.sql` creates it: ICU with
/// numeric ordering, so "Track 9" comes before "Track 10" the way the app sorts.
const SORT_COLLATION: &str = "natural_sort";

/// What a list matched, in order.
#[derive(Debug, PartialEq, Eq)]
pub struct QueryMatches {
    pub songs: Vec<QueryMatch>,
    /// More songs matched than came back. See [`run_query`].
    pub capped: bool,
    /// The groups, in order, when the list was grouped. Their counts add up to `songs`.
    pub groups: Option<Vec<MatchGroup>>,
    /// The returned songs with no stored metadata Apple knew.
    pub missing_metadata: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct QueryMatch {
    pub song_id: String,
    /// The song is the user's own: in their library, or carrying one of their tags.
    pub certain: bool,
}

/// One run of songs sharing a group value.
#[derive(Debug, PartialEq, Eq)]
pub struct MatchGroup {
    pub state: GroupState,
    /// The value as text. `None` for a basic tag's group and for the empty groups.
    pub value: Option<String>,
    pub count: usize,
}

/// One row the statement returns.
#[derive(Debug, PartialEq, Eq, FromQueryResult)]
struct ArrangedRow {
    song_id: String,
    certain: bool,
    has_metadata: bool,
    /// 0 a value, 1 applied with no value, 2 not applied. Always 0 without a group.
    group_state: i32,
    /// What tells groups apart, like a lowercased name.
    group_key: Option<String>,
    /// What the group is called, the value as the first song in it has it.
    group_label: Option<String>,
}

/// How a song list is ordered and grouped. Both empty keeps the list's own order.
#[derive(Debug, Clone, Default)]
pub struct Arrangement {
    pub sort: Option<QuerySort>,
    pub group: Option<QueryGroup>,
    /// The IANA zone a datetime tag's days are counted in. UTC when left out.
    pub time_zone: Option<String>,
}

impl Arrangement {
    pub fn is_none(&self) -> bool {
        self.sort.is_none() && self.group.is_none()
    }

    fn tag_ids(&self) -> HashSet<i64> {
        [
            self.sort.map(|sort| sort.field),
            self.group.map(|group| group.field),
        ]
        .into_iter()
        .flatten()
        .filter_map(|field| match field {
            ArrangeField::Tag { tag_id } => Some(tag_id),
            ArrangeField::Metadata { .. } => None,
        })
        .collect()
    }
}

/// What a sort or group needs to know about a tag it names.
#[derive(Debug, Clone, PartialEq)]
struct ArrangeTag {
    tag_type: TagType,
    rows: TagRows,
}

/// Where a tag's applications come from.
#[derive(Debug, Clone, Copy, PartialEq)]
enum TagRows {
    /// The user's rows in `user_tags_applied`: their own tags, and the stored activity
    /// tags. `default` is what a song with no row reads as, for My Plays and Favorited.
    User { default: Option<MissingDefault> },
    /// No rows at all, worked out from other tables. See [`ActivityTag::is_derived`].
    Derived(ActivityTag),
    /// `default_tags_applied`, less the ones the user removed. A suggested tag.
    Default,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum MissingDefault {
    Number(f64),
    False,
}

/// Everything a statement needs about how its list is arranged.
#[derive(Default)]
struct ArrangeContext {
    arrangement: Arrangement,
    tags: HashMap<i64, ArrangeTag>,
}

/// How many songs come back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CapRule {
    /// Every one: a library-only query, or a list of ids.
    None,
    /// Every one of the user's own, and the first [`MAX_DISCOVERED_SONGS`] of the rest.
    Discovered,
    /// The first [`MAX_ARRANGED_SONGS`], whoever's they are.
    Total,
}

/// Returns every song matching the given query, in order.
///
/// The query runs over every song Cadenza knows (see [`own_query_songs`] and
/// [`discovered_query_songs`]), so a song carrying no tags at all can still satisfy a
/// negative filter.
///
/// With `consider_default_tags` a song's shared default tags count as tags on it
/// too, both for matching and for ranking, and the query may name a default tag
/// id. Otherwise only the user's own tags exist as far as the query is
/// concerned.
///
/// With `library_only` the query runs over the user's library alone, their `user_songs`
/// rows: no songs from elsewhere, so the result is never capped.
///
/// Left unarranged, songs come back the user's own first, every one of them, then the
/// first [`MAX_DISCOVERED_SONGS`] of the rest. Each half goes most relevant first: by how
/// many of the tags the query names a song carries, then by every user's plays. Sorted or
/// grouped, only the first [`MAX_ARRANGED_SONGS`] in that order come back, the user's own
/// or not. Song id breaks every tie, so the same query over the same data comes back in
/// the same order every time.
pub async fn run_query(
    db: &DatabaseConnection,
    query: &Query,
    user_id: Uuid,
    consider_default_tags: bool,
    library_only: bool,
    arrangement: &Arrangement,
) -> Result<QueryMatches, CadenzaError> {
    check_size(&query.root)?;

    let mut tag_ids = HashSet::new();
    collect_tag_ids(&query.root, &mut tag_ids);
    let QueryableTags {
        tag_types,
        defaults,
    } = get_queryable_tags(db, user_id, &tag_ids, consider_default_tags).await?;
    let arrange = arrange_context(db, user_id, arrangement).await?;

    let (sql, values) = compile_query(
        query,
        &tag_types,
        &defaults,
        user_id,
        consider_default_tags,
        library_only,
        &arrange,
    )?;
    let rows = ArrangedRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        values,
    ))
    .all(db)
    .await?;

    let rule = if library_only {
        CapRule::None
    } else if arrangement.is_none() {
        CapRule::Discovered
    } else {
        CapRule::Total
    };
    Ok(finish(rows, rule, arrangement.group.is_some()))
}

/// Returns `song_ids` arranged: sorted, grouped, or both. Every id comes back once, the
/// first time it was given, and none is capped. Unsorted, they keep the order given.
pub async fn arrange_song_ids(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_ids: &[String],
    arrangement: &Arrangement,
) -> Result<QueryMatches, CadenzaError> {
    let song_ids = unique_song_ids(song_ids)?;
    let arrange = arrange_context(db, user_id, arrangement).await?;
    let (sql, values) = compile_song_ids(&song_ids, user_id, &arrange)?;
    let rows = ArrangedRow::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        values,
    ))
    .all(db)
    .await?;

    Ok(finish(rows, CapRule::None, arrangement.group.is_some()))
}

/// Every song a query treats as the user's own: their library, and with `library_only`
/// false every song carrying one of their tags too.
pub async fn get_own_song_ids(
    db: &DatabaseConnection,
    user_id: Uuid,
    library_only: bool,
) -> Result<Vec<String>, CadenzaError> {
    let sql = if library_only {
        LIBRARY_SONGS
    } else {
        OWN_SONGS
    };
    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            [user_id.into()],
        ))
        .await?;
    rows.iter()
        .map(|row| {
            row.try_get_by_index::<String>(0)
                .map_err(CadenzaError::from)
        })
        .collect()
}

/// `song_ids` without blanks or repeats, keeping the first of each, refused when there
/// are more than [`MAX_ARRANGED_SONG_IDS`].
fn unique_song_ids(song_ids: &[String]) -> Result<Vec<String>, CadenzaError> {
    if song_ids.len() > MAX_ARRANGED_SONG_IDS {
        return Err(CadenzaError::QueryFormatError(format!(
            "lists are limited to {MAX_ARRANGED_SONG_IDS} songs"
        )));
    }
    let mut seen = HashSet::new();
    Ok(song_ids
        .iter()
        .filter(|song_id| !song_id.is_empty() && seen.insert(song_id.as_str()))
        .cloned()
        .collect())
}

/// Cuts the rows off by `rule`, then reads the groups and the songs missing metadata off
/// what is left.
fn finish(mut rows: Vec<ArrangedRow>, rule: CapRule, grouped: bool) -> QueryMatches {
    let capped = match rule {
        CapRule::None => false,
        CapRule::Discovered => cap_discovered(&mut rows),
        CapRule::Total => {
            let capped = rows.len() > MAX_ARRANGED_SONGS;
            rows.truncate(MAX_ARRANGED_SONGS);
            capped
        }
    };

    let groups = grouped.then(|| groups_of(&rows));
    let missing_metadata = rows
        .iter()
        .filter(|row| !row.has_metadata)
        .map(|row| row.song_id.clone())
        .collect();
    let songs = rows
        .into_iter()
        .map(|row| QueryMatch {
            song_id: row.song_id,
            certain: row.certain,
        })
        .collect();

    QueryMatches {
        songs,
        capped,
        groups,
        missing_metadata,
    }
}

/// The statement returns one song past [`MAX_DISCOVERED_SONGS`] from outside the user's
/// own, so a full list can be told from a cut off one. That extra song is the last of
/// them in order, and goes. Returns whether one did.
fn cap_discovered(rows: &mut Vec<ArrangedRow>) -> bool {
    let discovered = rows.iter().filter(|row| !row.certain).count();
    let capped = discovered > MAX_DISCOVERED_SONGS;
    if capped && let Some(last) = rows.iter().rposition(|row| !row.certain) {
        rows.remove(last);
    }
    capped
}

/// The runs of rows sharing a group, in order. The statement orders by the group first,
/// so each group is one run. A group is named by its first song's value.
fn groups_of(rows: &[ArrangedRow]) -> Vec<MatchGroup> {
    let mut groups: Vec<(i32, Option<&str>, MatchGroup)> = Vec::new();
    for row in rows {
        let key = row.group_key.as_deref();
        match groups.last_mut() {
            Some((state, last_key, group)) if *state == row.group_state && *last_key == key => {
                group.count += 1;
            }
            _ => groups.push((
                row.group_state,
                key,
                MatchGroup {
                    state: match row.group_state {
                        0 => GroupState::Value,
                        1 => GroupState::NoValue,
                        _ => GroupState::NotApplied,
                    },
                    value: row.group_label.clone(),
                    count: 1,
                },
            )),
        }
    }
    groups.into_iter().map(|(_, _, group)| group).collect()
}

/// What the compiler needs to know about the tags a query names.
#[derive(Default)]
struct QueryableTags {
    /// The type of every tag the query mentions.
    tag_types: HashMap<i64, TagType>,
    /// How the activity tags among them read on a song with no row.
    defaults: TagDefaults,
}

/// What an activity tag counts as on a song with no row for it, where that is not
/// simply empty. User tags have none of these.
#[derive(Default)]
struct TagDefaults {
    /// Number tags whose missing row reads as a value rather than as empty,
    /// which is how "My Plays < 2" matches a song the user never played.
    numbers: HashMap<i64, f64>,
    /// Checkbox tags whose missing row reads as `false`, so "Favorited is false"
    /// matches a song the user never favorited.
    false_checkboxes: HashSet<i64>,
    /// Checkbox tags with no rows at all, worked out from other tables instead:
    /// In My Library and Tagged. See [`ActivityTag::is_derived`].
    derived: HashMap<i64, ActivityTag>,
}

/// Looks up every tag the query mentions. A tag that does not exist or belongs
/// to someone else is a `QueryFormatError`.
///
/// Activity tags are shared by every user, so they are always queryable. With
/// `consider_default_tags` a shared default tag (`user_id IS NULL`) is
/// queryable as well, so the query may name one.
async fn get_queryable_tags(
    db: &impl ConnectionTrait,
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
            && let Some(activity) = ActivityTag::from_name(&tag.name)
        {
            let defaults = &mut queryable.defaults;
            match missing_default(activity, &tag.r#type) {
                _ if activity.is_derived() => {
                    defaults.derived.insert(tag.tag_id, activity);
                }
                Some(MissingDefault::Number(number)) => {
                    defaults.numbers.insert(tag.tag_id, number);
                }
                Some(MissingDefault::False) => {
                    defaults.false_checkboxes.insert(tag.tag_id);
                }
                None => {}
            }
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

/// What a stored activity tag reads as on a song with no row: a number for My Plays,
/// false for Favorited, and nothing for the rest.
fn missing_default(activity: ActivityTag, tag_type: &TagType) -> Option<MissingDefault> {
    let default = activity.default_value();
    match tag_type {
        TagType::Number => default
            .and_then(|value| value.parse::<f64>().ok())
            .map(MissingDefault::Number),
        TagType::Checkbox if default == Some("false") => Some(MissingDefault::False),
        _ => None,
    }
}

/// Looks up the tags a sort or group names, and checks the time zone a datetime group
/// counts its days in. A tag the user cannot see is a `QueryFormatError`: their own, an
/// activity tag, and a shared default tag are all fine, whether or not the query considers
/// default tags.
async fn arrange_context(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    arrangement: &Arrangement,
) -> Result<ArrangeContext, CadenzaError> {
    let tag_ids = arrangement.tag_ids();
    let mut found = HashMap::new();
    if !tag_ids.is_empty() {
        for tag in tags::Entity::find()
            .filter(tags::Column::TagId.is_in(tag_ids.iter().copied()))
            .filter(
                Condition::any()
                    .add(tags::Column::UserId.eq(user_id))
                    .add(tags::Column::UserId.is_null()),
            )
            .all(db)
            .await?
        {
            let activity = tag
                .is_activity
                .then(|| ActivityTag::from_name(&tag.name))
                .flatten();
            let rows = match activity {
                Some(activity) if activity.is_derived() => TagRows::Derived(activity),
                Some(activity) => TagRows::User {
                    default: missing_default(activity, &tag.r#type),
                },
                None if tag.user_id.is_some() || tag.is_activity => TagRows::User { default: None },
                None => TagRows::Default,
            };
            found.insert(
                tag.tag_id,
                ArrangeTag {
                    tag_type: tag.r#type,
                    rows,
                },
            );
        }
    }
    if let Some(missing) = tag_ids.iter().find(|id| !found.contains_key(id)) {
        return Err(CadenzaError::QueryFormatError(format!(
            "tag {missing} does not exist"
        )));
    }

    let groups_by_day = matches!(
        arrangement.group.map(|group| group.field),
        Some(ArrangeField::Tag { tag_id }) if found[&tag_id].tag_type == TagType::Datetime
    );
    if groups_by_day && let Some(time_zone) = &arrangement.time_zone {
        let known = db
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1)",
                [time_zone.clone().into()],
            ))
            .await?
            .map(|row| row.try_get_by_index::<bool>(0))
            .transpose()?
            .unwrap_or(false);
        if !known {
            return Err(CadenzaError::QueryFormatError(format!(
                "'{time_zone}' is not a time zone"
            )));
        }
    }

    Ok(ArrangeContext {
        arrangement: arrangement.clone(),
        tags: found,
    })
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

/// Which half of the statement a row source is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Half {
    /// The user's own songs, or the ids a caller sent.
    Own,
    /// Songs from outside the user's own. None carries a row of the user's, so a tag of
    /// theirs is known to be missing without looking.
    Discovered,
}

/// Converts the query to a full SQL statement and its values. `tag_types` must
/// hold the type of every tag id the query mentions. `defaults` holds how the
/// activity tags read on a song with no row for them (see [`TagDefaults`]).
///
/// Every filter becomes one correlated `EXISTS` (or `NOT EXISTS`) over the
/// song's applied tags. A song without the tag at all counts as empty, so
/// negative operators (`is_not`, `not_on`, `ne`, `is_empty`, `is_null`) match
/// it.
///
/// Filters correlate against `query_songs`, one song from [`own_query_songs`] or
/// [`discovered_query_songs`]. The statement selects rows already in the order
/// [`run_query`] describes, with one song past the cap so [`finish`] can tell a full list
/// from a cut off one.
///
/// With `library_only` the user's own songs are only their `user_songs` rows
/// ([`LIBRARY_SONGS`]) and there is no second half, so nothing is capped.
///
/// The two run as separate halves of a `UNION ALL` with the same where clause. The user's
/// own songs are few. The rest can be hundreds of thousands, and a `LIMIT` on that half
/// lets postgres keep only the first while it sorts, instead of sorting them all. Ranking
/// happens in the statement rather than after it for the same reason. Sorted or grouped,
/// the user's own half is limited the same way, since only the first songs overall count.
fn compile_query(
    query: &Query,
    tag_types: &HashMap<i64, TagType>,
    defaults: &TagDefaults,
    user_id: Uuid,
    consider_default_tags: bool,
    library_only: bool,
    arrange: &ArrangeContext,
) -> Result<(String, Vec<sea_query::Value>), CadenzaError> {
    let applied_tags = applied_tags_source(consider_default_tags);
    let mut compiler = Compiler {
        tag_types,
        defaults,
        values: vec![sea_query::Value::Uuid(Some(user_id))],
        applied_tags,
    };
    let where_clause = compiler.node(&query.root)?;
    let (score, score_join) = compiler.score(&query.root);
    let params = ArrangeParams::bind(&mut compiler, arrange);
    let order = order_by(arrange, Unsorted::Relevance);
    let arranged = !arrange.arrangement.is_none();
    let limit = if arranged {
        MAX_ARRANGED_SONGS + 1
    } else {
        MAX_DISCOVERED_SONGS + 1
    };

    // the same placeholders in both halves, which postgres allows
    let matched = |query_songs: &str, half: Half| {
        let columns = arranged_columns(arrange, &params, half);
        format!(
            r#"
                SELECT
                    query_songs.song_id,
                    query_songs.certain,
                    query_songs.has_metadata,
                    query_songs.title,
                    query_songs.total_plays,
                    {score} AS score,
                    {select}
                FROM {query_songs} AS query_songs
                {score_join}
                {joins}
                WHERE {where_clause}
            "#,
            select = columns.select,
            joins = columns.joins,
        )
    };
    let own = matched(&own_query_songs(), Half::Own);
    let own = if arranged && !library_only {
        format!("SELECT * FROM ({own}) AS own ORDER BY {order} LIMIT {limit}")
    } else {
        own
    };
    let (own_songs, discovered) = if library_only {
        (LIBRARY_SONGS, String::new())
    } else {
        let discovered = matched(&discovered_query_songs(), Half::Discovered);
        (
            OWN_SONGS,
            format!(
                r#"
                    UNION ALL
                    (
                        SELECT * FROM ({discovered}) AS discovered
                        ORDER BY {order}
                        LIMIT {limit}
                    )
                "#
            ),
        )
    };
    let outer_limit = if arranged && !library_only {
        format!("LIMIT {limit}")
    } else {
        String::new()
    };

    let sql = format!(
        r#"
            WITH own_songs AS ({own_songs})
            SELECT song_id, certain, has_metadata, group_state, group_key, group_label
            FROM (
                ({own})
                {discovered}
            ) AS ranked
            ORDER BY {order}
            {outer_limit}
        "#
    );

    Ok((sql, compiler.values))
}

/// The statement behind [`arrange_song_ids`]: the given ids, with their stored metadata
/// and the tags the arrangement names, in order. `song_ids` are already unique.
fn compile_song_ids(
    song_ids: &[String],
    user_id: Uuid,
    arrange: &ArrangeContext,
) -> Result<(String, Vec<sea_query::Value>), CadenzaError> {
    let no_tags = HashMap::new();
    let no_defaults = TagDefaults::default();
    let mut compiler = Compiler {
        tag_types: &no_tags,
        defaults: &no_defaults,
        values: vec![sea_query::Value::Uuid(Some(user_id))],
        applied_tags: applied_tags_source(false),
    };
    let ids = compiler.bind(serde_json::to_string(song_ids).unwrap_or_else(|_| "[]".into()));
    let params = ArrangeParams::bind(&mut compiler, arrange);
    let order = order_by(arrange, Unsorted::Position);
    let columns = arranged_columns(arrange, &params, Half::Own);

    // the order reads the selected columns, which only an outer select can do
    let sql = format!(
        r#"
            SELECT song_id, certain, has_metadata, group_state, group_key, group_label
            FROM (
                SELECT
                    query_songs.song_id,
                    query_songs.certain,
                    query_songs.has_metadata,
                    query_songs.title,
                    query_songs.total_plays,
                    query_songs.position,
                    {select}
                FROM {query_songs} AS query_songs
                {joins}
            ) AS ranked
            ORDER BY {order}
        "#,
        select = columns.select,
        joins = columns.joins,
        query_songs = given_query_songs(&ids),
    );

    Ok((sql, compiler.values))
}

/// The placeholders an arrangement reads: the sort's and the group's tag ids, and the time
/// zone a datetime group counts days in.
struct ArrangeParams {
    sort_tag: Option<String>,
    group_tag: Option<String>,
    /// Bound only for a datetime group, the one thing that reads it.
    time_zone: Option<String>,
}

impl ArrangeParams {
    fn bind(compiler: &mut Compiler, arrange: &ArrangeContext) -> Self {
        let mut tag_param = |field: Option<ArrangeField>| match field {
            Some(ArrangeField::Tag { tag_id }) => {
                Some(compiler.bind(sea_query::Value::BigInt(Some(tag_id))))
            }
            _ => None,
        };
        let sort_tag = tag_param(arrange.arrangement.sort.map(|sort| sort.field));
        let group_tag = tag_param(arrange.arrangement.group.map(|group| group.field));
        let groups_by_day = matches!(
            arrange.arrangement.group.map(|group| group.field),
            Some(ArrangeField::Tag { tag_id })
                if arrange.tags.get(&tag_id).map(|tag| &tag.tag_type) == Some(&TagType::Datetime)
        );
        let time_zone = groups_by_day.then(|| {
            compiler.bind(
                arrange
                    .arrangement
                    .time_zone
                    .clone()
                    .unwrap_or_else(|| "UTC".to_string()),
            )
        });
        Self {
            sort_tag,
            group_tag,
            time_zone,
        }
    }
}

/// How a field's value orders.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ValueOrder {
    /// Text, compared in [`SORT_COLLATION`].
    Text,
    /// Numbers, dates and times, compared as they are.
    Plain,
    /// A yes or no, true first.
    TrueFirst,
    /// Nothing to compare: a basic tag is only applied or not.
    Nothing,
}

/// One sort or group field, compiled for one half of the statement.
struct FieldSql {
    /// What brings the tag's row in, or nothing.
    join: String,
    /// 0 a value, 1 applied with no value, 2 not applied.
    state: String,
    /// The typed value songs order by within a state. How it orders is
    /// [`field_order`]'s to say.
    value: String,
    /// What tells groups apart, as text.
    key: String,
    /// What the group is called, as text.
    label: String,
}

/// Whether a field is being compiled to sort by or to group by. A group compares what
/// tells groups apart: text ignoring case, a datetime by its day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    Sort,
    Group,
}

/// The sort's and the group's columns for one half, and the joins they read from.
struct ArrangedColumns {
    select: String,
    joins: String,
}

fn arranged_columns(
    arrange: &ArrangeContext,
    params: &ArrangeParams,
    half: Half,
) -> ArrangedColumns {
    let mut joins = Vec::new();
    let mut select = Vec::new();

    match arrange.arrangement.sort {
        Some(sort) => {
            let field = field_sql(
                sort.field,
                Role::Sort,
                half,
                arrange,
                params.sort_tag.as_deref(),
                params.time_zone.as_deref(),
                "sort_tag",
            );
            joins.push(field.join);
            select.push(format!("{} AS sort_state", field.state));
            select.push(format!("{} AS sort_value", field.value));
        }
        None => {
            select.push("0 AS sort_state".to_string());
            select.push("NULL AS sort_value".to_string());
        }
    }

    match arrange.arrangement.group {
        Some(group) => {
            let field = field_sql(
                group.field,
                Role::Group,
                half,
                arrange,
                params.group_tag.as_deref(),
                params.time_zone.as_deref(),
                "group_tag",
            );
            joins.push(field.join);
            select.push(format!("{} AS group_state", field.state));
            select.push(format!("{} AS group_value", field.value));
            select.push(format!("{} AS group_key", field.key));
            select.push(format!("{} AS group_label", field.label));
        }
        None => {
            select.push("0 AS group_state".to_string());
            select.push("NULL AS group_value".to_string());
            select.push("NULL::text AS group_key".to_string());
            select.push("NULL::text AS group_label".to_string());
        }
    }

    ArrangedColumns {
        select: select.join(",\n"),
        joins: joins.join("\n"),
    }
}

/// How the value of a tag of `tag_type` reads from its text form `raw`, and how it orders.
fn typed_value(tag_type: &TagType, raw: &str) -> (String, ValueOrder) {
    match tag_type {
        TagType::Basic => ("NULL".to_string(), ValueOrder::Nothing),
        TagType::Text => (raw.to_string(), ValueOrder::Text),
        TagType::Number => (format!("({raw})::double precision"), ValueOrder::Plain),
        TagType::Date => (format!("({raw})::date"), ValueOrder::Plain),
        TagType::Datetime => (format!("({raw})::timestamptz"), ValueOrder::Plain),
        TagType::Checkbox => (format!("(({raw}) = 'true')"), ValueOrder::TrueFirst),
    }
}

/// Compiles one sort or group field for one half. `tag_param` is the tag id's placeholder
/// for a tag field, `time_zone` the zone's, and `alias` names the joined row.
///
/// A value's state says where the song goes whatever the direction: 0 for a value, 1 for
/// the tag applied with none, 2 for no tag at all. A basic tag is 0 applied and 2 not, and
/// a metadata tag 0 or 1, since there is nothing to apply. An activity tag with a default
/// always has a value.
fn field_sql(
    field: ArrangeField,
    role: Role,
    half: Half,
    arrange: &ArrangeContext,
    tag_param: Option<&str>,
    time_zone: Option<&str>,
    alias: &str,
) -> FieldSql {
    let mut join = String::new();
    let (state, value, order, tag_type) = match field {
        ArrangeField::Metadata { key } => {
            let (value, order, tag_type) = match key {
                MetadataKey::Title => ("query_songs.title".to_string(), ValueOrder::Text, TagType::Text),
                MetadataKey::Artist => ("query_songs.artist".to_string(), ValueOrder::Text, TagType::Text),
                MetadataKey::Album => ("query_songs.album".to_string(), ValueOrder::Text, TagType::Text),
                MetadataKey::Genre => ("query_songs.genre".to_string(), ValueOrder::Text, TagType::Text),
                MetadataKey::ReleaseDate => {
                    ("query_songs.release_date".to_string(), ValueOrder::Plain, TagType::Date)
                }
                MetadataKey::Duration => {
                    ("query_songs.duration".to_string(), ValueOrder::Plain, TagType::Number)
                }
                MetadataKey::Explicit => (
                    "(CASE query_songs.content_rating WHEN 'explicit' THEN TRUE WHEN 'clean' THEN FALSE END)"
                        .to_string(),
                    ValueOrder::TrueFirst,
                    TagType::Checkbox,
                ),
                MetadataKey::TotalPlays => (
                    "(CASE WHEN query_songs.has_metadata THEN query_songs.total_plays END)".to_string(),
                    ValueOrder::Plain,
                    TagType::Number,
                ),
            };
            let state = format!("(CASE WHEN {value} IS NULL THEN 1 ELSE 0 END)");
            (state, value, order, tag_type)
        }
        ArrangeField::Tag { tag_id } => {
            let tag = &arrange.tags[&tag_id];
            let param = tag_param.unwrap_or("NULL");
            match tag.rows {
                TagRows::Derived(activity) => {
                    let holds = match (half, activity) {
                        (Half::Discovered, _) => "FALSE".to_string(),
                        (_, ActivityTag::InMyLibrary) => "EXISTS (
                            SELECT 1 FROM user_songs AS arrange_library
                            WHERE arrange_library.user_id=$1
                                AND arrange_library.song_id=query_songs.song_id
                        )"
                        .to_string(),
                        _ => "EXISTS (
                            SELECT 1 FROM user_tags_applied AS arrange_applied
                            JOIN tags AS arrange_tag ON arrange_tag.tag_id=arrange_applied.tag_id
                            WHERE arrange_applied.user_id=$1 AND arrange_tag.user_id=$1
                                AND arrange_applied.song_id=query_songs.song_id
                        )"
                        .to_string(),
                    };
                    (
                        "0".to_string(),
                        holds,
                        ValueOrder::TrueFirst,
                        TagType::Checkbox,
                    )
                }
                TagRows::User { default } => {
                    // a song from outside the user's own has none of their rows
                    let (applied, raw) = if half == Half::Discovered {
                        ("FALSE".to_string(), "NULL".to_string())
                    } else {
                        join = format!(
                            "LEFT JOIN user_tags_applied AS {alias}
                                ON {alias}.song_id=query_songs.song_id
                                AND {alias}.user_id=$1 AND {alias}.tag_id={param}"
                        );
                        (
                            format!("{alias}.song_id IS NOT NULL"),
                            format!("{alias}.value"),
                        )
                    };
                    let (value, order) = typed_value(&tag.tag_type, &raw);
                    match default {
                        Some(MissingDefault::Number(number)) => (
                            "0".to_string(),
                            format!("COALESCE({value}, {number:?}::double precision)"),
                            order,
                            tag.tag_type.clone(),
                        ),
                        Some(MissingDefault::False) => (
                            "0".to_string(),
                            format!("COALESCE({value}, FALSE)"),
                            order,
                            tag.tag_type.clone(),
                        ),
                        None if half == Half::Discovered => {
                            ("2".to_string(), value, order, tag.tag_type.clone())
                        }
                        None => (
                            applied_state(&tag.tag_type, &applied, &raw),
                            value,
                            order,
                            tag.tag_type.clone(),
                        ),
                    }
                }
                TagRows::Default => {
                    join = format!(
                        "LEFT JOIN default_tags_applied AS {alias}
                            ON {alias}.song_id=query_songs.song_id AND {alias}.tag_id={param}
                            AND NOT EXISTS (
                                SELECT 1 FROM default_tags_removed AS {alias}_removed
                                WHERE {alias}_removed.user_id=$1
                                    AND {alias}_removed.tag_id={alias}.tag_id
                                    AND {alias}_removed.song_id={alias}.song_id
                            )"
                    );
                    let applied = format!("{alias}.song_id IS NOT NULL");
                    // a default tag carries no value
                    let (value, order) = typed_value(&tag.tag_type, "NULL");
                    (
                        applied_state(&tag.tag_type, &applied, "NULL"),
                        value,
                        order,
                        tag.tag_type.clone(),
                    )
                }
            }
        }
    };

    if role == Role::Sort {
        return FieldSql {
            join,
            state,
            value,
            key: "NULL::text".to_string(),
            label: "NULL::text".to_string(),
        };
    }

    // groups compare what tells them apart: text without case, a datetime by its day
    let (value, key, label) = match order {
        ValueOrder::Nothing => (
            "NULL".to_string(),
            "NULL::text".to_string(),
            "NULL::text".to_string(),
        ),
        ValueOrder::Text => (
            format!("lower({value})"),
            format!("lower({value})"),
            format!("({value})::text"),
        ),
        ValueOrder::TrueFirst => (
            value.clone(),
            format!("({value})::text"),
            format!("({value})::text"),
        ),
        ValueOrder::Plain => {
            let value = match tag_type {
                TagType::Datetime => format!(
                    "(({value}) AT TIME ZONE {})::date",
                    time_zone.unwrap_or("'UTC'")
                ),
                _ => value,
            };
            let text = match tag_type {
                TagType::Datetime | TagType::Date => format!("to_char({value}, 'YYYY-MM-DD')"),
                _ => format!("({value})::text"),
            };
            (value, text.clone(), text)
        }
    };
    FieldSql {
        join,
        state,
        value,
        key,
        label,
    }
}

/// The state of a tag read from rows: 2 when it is not applied, 0 for a basic tag that is,
/// and for any other 1 or 0 by whether it holds a value.
fn applied_state(tag_type: &TagType, applied: &str, raw: &str) -> String {
    match tag_type {
        TagType::Basic => format!("(CASE WHEN {applied} THEN 0 ELSE 2 END)"),
        _ => format!("(CASE WHEN NOT ({applied}) THEN 2 WHEN {raw} IS NULL THEN 1 ELSE 0 END)"),
    }
}

/// What an unsorted list keeps to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Unsorted {
    /// A query's own order: the user's own songs first, then most relevant first.
    Relevance,
    /// The order the ids were given in.
    Position,
}

/// The `ORDER BY` list for an arrangement, over the columns the statement selects: the
/// group first, then the sort, then ties. Ends in the song id, which is unique, so the
/// order is total and each half's cap and the final sort agree row for row. The id
/// compares byte by byte, so it does not depend on the database's locale.
fn order_by(arrange: &ArrangeContext, unsorted: Unsorted) -> String {
    let mut terms = Vec::new();
    if let Some(group) = arrange.arrangement.group {
        let order = field_order(group.field, arrange);
        terms.extend(value_terms(
            "group_state",
            "group_value",
            order,
            group.direction,
        ));
    }

    match arrange.arrangement.sort {
        Some(sort) => {
            let order = field_order(sort.field, arrange);
            terms.extend(value_terms(
                "sort_state",
                "sort_value",
                order,
                sort.direction,
            ));
            terms.push(format!("title COLLATE {SORT_COLLATION} ASC NULLS LAST"));
            terms.push("total_plays DESC".to_string());
        }
        None => match unsorted {
            Unsorted::Relevance => {
                terms.push("certain DESC".to_string());
                terms.push("score DESC".to_string());
                terms.push("total_plays DESC".to_string());
            }
            Unsorted::Position => terms.push("position".to_string()),
        },
    }
    terms.push("song_id COLLATE \"C\"".to_string());
    terms.join(", ")
}

/// How a field orders, without compiling it.
fn field_order(field: ArrangeField, arrange: &ArrangeContext) -> ValueOrder {
    match field {
        ArrangeField::Metadata { key } => match key {
            MetadataKey::Title | MetadataKey::Artist | MetadataKey::Album | MetadataKey::Genre => {
                ValueOrder::Text
            }
            MetadataKey::Explicit => ValueOrder::TrueFirst,
            MetadataKey::ReleaseDate | MetadataKey::Duration | MetadataKey::TotalPlays => {
                ValueOrder::Plain
            }
        },
        ArrangeField::Tag { tag_id } => {
            let tag = &arrange.tags[&tag_id];
            match tag.rows {
                TagRows::Derived(_) => ValueOrder::TrueFirst,
                _ => typed_value(&tag.tag_type, "NULL").1,
            }
        }
    }
}

/// The state, then the value in `direction`. Ascending is the value's natural order, so a
/// checkbox's true comes first. A basic tag has only its state, which ignores direction.
fn value_terms(
    state: &str,
    value: &str,
    order: ValueOrder,
    direction: SortDirection,
) -> Vec<String> {
    let (natural, reversed) = match direction {
        SortDirection::Ascending => ("ASC", "DESC"),
        SortDirection::Descending => ("DESC", "ASC"),
    };
    let mut terms = vec![format!("{state} ASC")];
    match order {
        ValueOrder::Nothing => {}
        ValueOrder::Text => terms.push(format!(
            "{value} COLLATE {SORT_COLLATION} {natural} NULLS LAST"
        )),
        ValueOrder::Plain => terms.push(format!("{value} {natural} NULLS LAST")),
        ValueOrder::TrueFirst => terms.push(format!("{value} {reversed} NULLS LAST")),
    }
    terms
}

struct Compiler<'a> {
    tag_types: &'a HashMap<i64, TagType>,
    defaults: &'a TagDefaults,
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

    /// How relevant a song is: how many of the tags the query names it carries. Returns the
    /// score's expression and the join it reads from, counted once per song in one grouped
    /// pass rather than looked up song by song. Every song scores 0 for a query that names
    /// no tag ids, like one built only from `tag_name` or metadata filters, and then there
    /// is no join.
    fn score(&mut self, root: &QueryNode) -> (String, String) {
        let mut tag_ids: Vec<i64> = {
            let mut tag_ids = HashSet::new();
            collect_tag_ids(root, &mut tag_ids);
            tag_ids.into_iter().collect()
        };
        if tag_ids.is_empty() {
            return ("0".to_string(), String::new());
        }
        // sorted, so the same query always binds in the same order
        tag_ids.sort_unstable();

        let params = tag_ids
            .into_iter()
            .map(|tag_id| self.bind(sea_query::Value::BigInt(Some(tag_id))))
            .collect::<Vec<_>>()
            .join(", ");
        let join = format!(
            r#"
                LEFT JOIN (
                    SELECT score_tags.song_id, count(*) AS score
                    FROM {} AS score_tags
                    WHERE score_tags.tag_id IN ({params})
                    GROUP BY score_tags.song_id
                ) AS scores ON scores.song_id=query_songs.song_id
            "#,
            self.applied_tags
        );
        ("COALESCE(scores.score, 0)".to_string(), join)
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
        // no rows to look through, so nothing to bind
        if let Some(derived) = self.defaults.derived.get(&tag_id) {
            return derived_filter(*derived, op, value);
        }
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

        // For a number or checkbox tag with a default, whether a song without
        // the tag passes: the operator applied to the default rather than to
        // nothing.
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
                    if let Some(default) = self.defaults.numbers.get(&tag_id) {
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
                if self.defaults.false_checkboxes.contains(&tag_id) {
                    // a missing row is false, which is never null
                    missing_passes = Some(op == FilterOp::IsFalse);
                }
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

/// A filter on a derived activity tag, In My Library or Tagged. It has no rows, so
/// it is a check on the table it comes from: true when the song is in the user's
/// library, or carries a tag the user owns. Never null, so `is_null` matches
/// nothing, and `is_applied` means true, the same as for a stored checkbox.
fn derived_filter(
    tag: ActivityTag,
    op: FilterOp,
    value: &Option<String>,
) -> Result<String, CadenzaError> {
    no_value(op, value)?;
    let holds = match tag {
        ActivityTag::InMyLibrary => {
            "EXISTS (
                SELECT 1 FROM user_songs AS library
                WHERE library.user_id=$1 AND library.song_id=query_songs.song_id
            )"
        }
        // the user's own tags carry their user id; activity and default tags none
        ActivityTag::Tagged => {
            "EXISTS (
                SELECT 1 FROM user_tags_applied AS own_applied
                JOIN tags AS own_tag ON own_tag.tag_id=own_applied.tag_id
                WHERE own_applied.user_id=$1 AND own_tag.user_id=$1
                    AND own_applied.song_id=query_songs.song_id
            )"
        }
        _ => {
            return Err(CadenzaError::QueryFormatError(format!(
                "'{}' is not a derived tag",
                tag.name()
            )));
        }
    };
    Ok(match op {
        FilterOp::IsTrue | FilterOp::IsApplied => holds.to_string(),
        FilterOp::IsFalse | FilterOp::IsNotApplied => format!("NOT {holds}"),
        FilterOp::IsNull => "FALSE".to_string(),
        _ => return Err(unsupported_op(op, "checkbox tags")),
    })
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
            &TagDefaults::default(),
            Uuid::nil(),
            false,
            false,
            &ArrangeContext::default(),
        )
    }

    fn compile_with_defaults(json: &str) -> Result<(String, Vec<sea_query::Value>), CadenzaError> {
        compile_query(
            &parse(json),
            &tag_types(),
            &TagDefaults::default(),
            Uuid::nil(),
            true,
            false,
            &ArrangeContext::default(),
        )
    }

    /// Tag 4 is a number tag. Compiled as if it were My Plays, where a song
    /// with no row counts as 0.
    fn compile_with_zero_default(json: &str) -> String {
        compile_query(
            &parse(json),
            &tag_types(),
            &TagDefaults {
                numbers: HashMap::from([(4, 0.0)]),
                ..TagDefaults::default()
            },
            Uuid::nil(),
            false,
            false,
            &ArrangeContext::default(),
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
        // the ranking binds the tags it scores on after every filter
        assert!(sql.contains("score_tags.tag_id IN ($5)"), "{sql}");
        assert_eq!(
            values[1..],
            [
                sea_query::Value::BigInt(Some(4)),
                sea_query::Value::Double(Some(2.5)),
                sea_query::Value::String(Some("Rock".to_string())),
                sea_query::Value::BigInt(Some(4)),
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

    /// Every song Cadenza knows is the row source, not just the tagged ones. An untagged
    /// song has to reach the where clause or `is_not_applied` could never match it.
    #[test]
    fn the_query_runs_over_the_users_own_songs_and_every_stored_one() {
        let (sql, values) = compile(&filter(
            r#"{ "field": "tag", "tag_id": 1, "op": "is_not_applied" }"#,
        ))
        .unwrap();
        let sql = squash(&sql);

        assert!(
            sql.contains(&format!("WITH own_songs AS ( {} )", squash(OWN_SONGS))),
            "{sql}"
        );
        assert!(
            sql.contains("SELECT song_id FROM user_songs WHERE user_id=$1 UNION SELECT song_id FROM user_tags_applied WHERE user_id=$1"),
            "{sql}"
        );
        // the user's own songs, all certain
        assert!(
            sql.contains(&format!(
                "FROM {} AS query_songs",
                squash(&own_query_songs())
            )),
            "{sql}"
        );
        assert!(sql.contains("own_songs.song_id, TRUE AS certain"), "{sql}");
        // and every stored song Apple knows that is not one of them, and no phone sent
        assert!(
            sql.contains(&format!(
                "FROM {} AS query_songs",
                squash(&discovered_query_songs())
            )),
            "{sql}"
        );
        assert!(sql.contains("stored.song_id, FALSE AS certain"), "{sql}");
        assert!(
            sql.contains(
                "WHERE stored.found AND stored.source = 'catalog' AND own_songs.song_id IS NULL"
            ),
            "{sql}"
        );
        // the filter runs over both halves
        assert_eq!(sql.matches("NOT EXISTS").count(), 2, "{sql}");
        // the user id is the only value bound before the filters
        assert!(sql.contains("filter_check.tag_id=$2"));
        assert_eq!(values.len(), 3);
    }

    #[test]
    fn filters_bind_in_order_after_the_user_id() {
        let (sql, values) = compile(
            r#"{ "where": { "and": [
                { "filter": { "field": "tag", "tag_id": 2, "op": "is_applied" } },
                { "filter": { "field": "tag", "tag_id": 1, "op": "is_applied" } }
            ] } }"#,
        )
        .unwrap();

        assert!(sql.contains("AS query_songs"), "{sql}");
        assert!(sql.contains("filter_check.tag_id=$2"));
        assert!(sql.contains("filter_check.tag_id=$3"));
        // then the ranking's tags, sorted by id
        assert!(sql.contains("score_tags.tag_id IN ($4, $5)"), "{sql}");
        assert_eq!(
            values[1..],
            [
                sea_query::Value::BigInt(Some(2)),
                sea_query::Value::BigInt(Some(1)),
                sea_query::Value::BigInt(Some(1)),
                sea_query::Value::BigInt(Some(2)),
            ]
        );
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
        // The ranking subquery, plus one per filter subquery, in each half of the
        // statement.
        assert_eq!(
            with.matches("FROM default_tags_applied").count(),
            6,
            "{with}"
        );
        assert_eq!(with.matches("NULL::text AS value").count(), 6, "{with}");
        // The user's own tags are still in there, never replaced.
        assert_eq!(
            with.matches("SELECT song_id, tag_id, value FROM user_tags_applied WHERE user_id=$1")
                .count(),
            6,
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
        assert_eq!(with.matches("removed.user_id=$1").count(), 6, "{with}");

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
    fn the_statement_selects_songs_and_whether_they_are_certain() {
        let (sql, _) = compile(r#"{ "where": { "and": [] } }"#).unwrap();
        assert!(
            squash(&sql).contains(
                "SELECT song_id, certain, has_metadata, group_state, group_key, group_label FROM ( ( SELECT query_songs.song_id, query_songs.certain, query_songs.has_metadata,"
            ),
            "{sql}"
        );
    }

    #[test]
    fn a_query_naming_no_tags_scores_every_song_zero() {
        let (sql, values) = compile(&metadata_filter("artist", "is", Some("Prince"))).unwrap();
        assert!(squash(&sql).contains("0 AS score"), "{sql}");
        assert!(!sql.contains("score_tags"), "{sql}");
        assert_eq!(values.len(), 2);
    }

    /// Only the songs from outside the user's own are cut off, and the statement keeps one
    /// past the cap so the caller can tell.
    #[test]
    fn only_discovered_songs_are_capped() {
        let (sql, _) = compile(r#"{ "where": { "and": [] } }"#).unwrap();
        let sql = squash(&sql);
        let order = order_by(&ArrangeContext::default(), Unsorted::Relevance);
        assert!(
            sql.contains(&format!(
                ") AS discovered ORDER BY {order} LIMIT {} )",
                MAX_DISCOVERED_SONGS + 1
            )),
            "{sql}"
        );
        assert_eq!(sql.matches("LIMIT").count(), 1, "{sql}");
    }

    /// Limited to the library, the query runs over the user's `user_songs` rows alone:
    /// not their tagged songs outside it, and no stored songs from elsewhere.
    #[test]
    fn a_library_only_query_runs_over_the_library_alone() {
        let (sql, _) = compile_query(
            &parse(&filter(
                r#"{ "field": "tag", "tag_id": 1, "op": "is_not_applied" }"#,
            )),
            &tag_types(),
            &TagDefaults::default(),
            Uuid::nil(),
            false,
            true,
            &ArrangeContext::default(),
        )
        .unwrap();
        let sql = squash(&sql);

        assert!(
            sql.contains(&format!("WITH own_songs AS ( {} )", squash(LIBRARY_SONGS))),
            "{sql}"
        );
        assert!(
            !sql.contains("SELECT song_id FROM user_tags_applied WHERE user_id=$1"),
            "{sql}"
        );
        assert!(!sql.contains("FALSE AS certain"), "{sql}");
        assert!(!sql.contains("UNION ALL ("), "{sql}");
        assert!(!sql.contains("LIMIT"), "{sql}");
        // the filter and the ranking still run
        assert!(sql.contains("NOT EXISTS"), "{sql}");
        assert!(sql.contains("ORDER BY certain DESC, score DESC"), "{sql}");
    }

    /// Tag 7 is In My Library, 8 is Tagged, and 9 is Favorited, as
    /// `get_queryable_tags` would describe them.
    fn compile_activity_checkbox(tag_id: i64, op: &str) -> Result<String, CadenzaError> {
        let defaults = TagDefaults {
            false_checkboxes: HashSet::from([9]),
            derived: HashMap::from([(7, ActivityTag::InMyLibrary), (8, ActivityTag::Tagged)]),
            ..TagDefaults::default()
        };
        compile_query(
            &parse(&filter(&format!(
                r#"{{ "field": "tag", "tag_id": {tag_id}, "op": "{op}" }}"#
            ))),
            &HashMap::from([
                (7, TagType::Checkbox),
                (8, TagType::Checkbox),
                (9, TagType::Checkbox),
            ]),
            &defaults,
            Uuid::nil(),
            false,
            false,
            &ArrangeContext::default(),
        )
        .map(|(sql, _)| squash(&sql))
    }

    /// In My Library has no rows: it is whether the song has a `user_songs` row.
    #[test]
    fn in_my_library_checks_the_library() {
        let in_library = "EXISTS ( SELECT 1 FROM user_songs AS library WHERE library.user_id=$1 AND library.song_id=query_songs.song_id )";

        let sql = compile_activity_checkbox(7, "is_true").unwrap();
        assert!(sql.contains(&format!("WHERE {in_library} )")), "{sql}");
        let sql = compile_activity_checkbox(7, "is_false").unwrap();
        assert!(sql.contains(&format!("WHERE NOT {in_library} )")), "{sql}");
        // never null, so nothing is
        let sql = compile_activity_checkbox(7, "is_null").unwrap();
        assert!(sql.contains("WHERE FALSE )"), "{sql}");
        // applied means true, the same as a stored checkbox
        let sql = compile_activity_checkbox(7, "is_applied").unwrap();
        assert!(sql.contains(&format!("WHERE {in_library} )")), "{sql}");
        // the tag id is never bound: there are no rows to match it against
        assert!(!sql.contains("filter_check.tag_id"), "{sql}");
    }

    /// Tagged is whether the song carries a tag the user owns. Activity tags and
    /// default tags have no user id, so they do not count.
    #[test]
    fn tagged_checks_for_a_tag_the_user_owns() {
        let sql = compile_activity_checkbox(8, "is_true").unwrap();
        assert!(
            sql.contains("FROM user_tags_applied AS own_applied JOIN tags AS own_tag ON own_tag.tag_id=own_applied.tag_id WHERE own_applied.user_id=$1 AND own_tag.user_id=$1 AND own_applied.song_id=query_songs.song_id"),
            "{sql}"
        );
        let sql = compile_activity_checkbox(8, "is_not_applied").unwrap();
        assert!(
            sql.contains("WHERE NOT EXISTS ( SELECT 1 FROM user_tags_applied AS own_applied"),
            "{sql}"
        );
    }

    #[test]
    fn derived_tags_take_only_checkbox_operators() {
        assert!(matches!(
            compile_activity_checkbox(7, "gt"),
            Err(CadenzaError::QueryFormatError(_))
        ));
        assert!(matches!(
            compile_query(
                &parse(&filter(
                    r#"{ "field": "tag", "tag_id": 7, "op": "is_true", "value": "true" }"#
                )),
                &HashMap::from([(7, TagType::Checkbox)]),
                &TagDefaults {
                    derived: HashMap::from([(7, ActivityTag::InMyLibrary)]),
                    ..TagDefaults::default()
                },
                Uuid::nil(),
                false,
                false,
                &ArrangeContext::default(),
            ),
            Err(CadenzaError::QueryFormatError(_))
        ));
    }

    /// A song the user never favorited has no Favorited row, which reads false.
    #[test]
    fn a_missing_favorite_is_false() {
        // false takes in the songs with no row
        let sql = compile_activity_checkbox(9, "is_false").unwrap();
        assert!(sql.contains("OR NOT EXISTS"), "{sql}");
        // true does not
        let sql = compile_activity_checkbox(9, "is_true").unwrap();
        assert!(
            !sql.contains("OR NOT") && !sql.contains("AND EXISTS"),
            "{sql}"
        );
        // and nothing is null: a missing row is false, so is_null rules it back out
        let sql = compile_activity_checkbox(9, "is_null").unwrap();
        assert!(sql.contains("AND EXISTS"), "{sql}");
    }

    /// The caps' sorts and the final sort have to agree, or a cap would keep songs the
    /// list does not show first.
    #[test]
    fn the_caps_and_the_final_sort_use_one_order() {
        for (arrange, caps) in [
            (ArrangeContext::default(), 1),
            (
                arranged(
                    Some(sort(
                        ArrangeField::Metadata {
                            key: MetadataKey::Artist,
                        },
                        false,
                    )),
                    None,
                ),
                2,
            ),
        ] {
            let (sql, _) = compile_query(
                &parse(r#"{ "where": { "and": [] } }"#),
                &tag_types(),
                &TagDefaults::default(),
                Uuid::nil(),
                false,
                false,
                &arrange,
            )
            .unwrap();
            let order = order_by(&arrange, Unsorted::Relevance);
            assert_eq!(sql.matches(&order).count(), caps + 1, "{sql}");
            assert!(squash(&sql).contains(&format!("ORDER BY {order}")), "{sql}");
        }
    }

    /// The score counts the query's tags in one grouped pass, through the same tag source
    /// the filters read.
    #[test]
    fn the_score_counts_the_query_s_tags_on_each_song() {
        let (sql, _) = compile(&filter(
            r#"{ "field": "tag", "tag_id": 2, "op": "is_applied" }"#,
        ))
        .unwrap();
        let sql = squash(&sql);
        assert!(sql.contains("COALESCE(scores.score, 0) AS score"), "{sql}");
        assert!(
            sql.contains("LEFT JOIN ( SELECT score_tags.song_id, count(*) AS score FROM (SELECT song_id, tag_id, value FROM user_tags_applied WHERE user_id=$1) AS score_tags WHERE score_tags.tag_id IN ($3) GROUP BY score_tags.song_id ) AS scores ON scores.song_id=query_songs.song_id"),
            "{sql}"
        );
    }

    fn sort(field: ArrangeField, ascending: bool) -> QuerySort {
        QuerySort {
            field,
            direction: if ascending {
                SortDirection::Ascending
            } else {
                SortDirection::Descending
            },
        }
    }

    fn group(field: ArrangeField) -> QueryGroup {
        QueryGroup {
            field,
            direction: SortDirection::Ascending,
        }
    }

    /// Tag 1 basic, 2 text, 3 datetime, 4 number and 5 checkbox are the user's, 7 is In My
    /// Library, 8 is My Plays (missing reads 0), 9 is Favorited (missing reads false), and
    /// 10 is a suggested tag.
    fn arranged(sort: Option<QuerySort>, group: Option<QueryGroup>) -> ArrangeContext {
        let own = |tag_type| ArrangeTag {
            tag_type,
            rows: TagRows::User { default: None },
        };
        ArrangeContext {
            arrangement: Arrangement {
                sort,
                group,
                time_zone: Some("America/Denver".to_string()),
            },
            tags: HashMap::from([
                (1, own(TagType::Basic)),
                (2, own(TagType::Text)),
                (3, own(TagType::Datetime)),
                (4, own(TagType::Number)),
                (5, own(TagType::Checkbox)),
                (
                    7,
                    ArrangeTag {
                        tag_type: TagType::Checkbox,
                        rows: TagRows::Derived(ActivityTag::InMyLibrary),
                    },
                ),
                (
                    8,
                    ArrangeTag {
                        tag_type: TagType::Number,
                        rows: TagRows::User {
                            default: Some(MissingDefault::Number(0.0)),
                        },
                    },
                ),
                (
                    9,
                    ArrangeTag {
                        tag_type: TagType::Checkbox,
                        rows: TagRows::User {
                            default: Some(MissingDefault::False),
                        },
                    },
                ),
                (
                    10,
                    ArrangeTag {
                        tag_type: TagType::Basic,
                        rows: TagRows::Default,
                    },
                ),
            ]),
        }
    }

    fn compile_arranged(arrange: &ArrangeContext) -> (String, Vec<sea_query::Value>) {
        let (sql, values) = compile_query(
            &parse(r#"{ "where": { "and": [] } }"#),
            &tag_types(),
            &TagDefaults::default(),
            Uuid::nil(),
            false,
            false,
            arrange,
        )
        .unwrap();
        (squash(&sql), values)
    }

    const TIES: &str =
        r#"title COLLATE natural_sort ASC NULLS LAST, total_plays DESC, song_id COLLATE "C""#;

    /// Left unarranged, the user's own songs come first, then the most relevant.
    #[test]
    fn unsorted_puts_the_users_own_first_then_relevance_then_plays() {
        assert_eq!(
            order_by(&ArrangeContext::default(), Unsorted::Relevance),
            r#"certain DESC, score DESC, total_plays DESC, song_id COLLATE "C""#
        );
        assert_eq!(
            order_by(&ArrangeContext::default(), Unsorted::Position),
            r#"position, song_id COLLATE "C""#
        );
    }

    #[test]
    fn each_kind_of_value_sorts_its_own_way() {
        let order = |field, ascending| {
            order_by(
                &arranged(Some(sort(field, ascending)), None),
                Unsorted::Relevance,
            )
        };
        let tag = |tag_id| ArrangeField::Tag { tag_id };

        // text in the natural collation, then ties
        assert_eq!(
            order(
                ArrangeField::Metadata {
                    key: MetadataKey::Artist
                },
                true
            ),
            format!("sort_state ASC, sort_value COLLATE natural_sort ASC NULLS LAST, {TIES}")
        );
        // numbers and dates as they are
        assert_eq!(
            order(tag(4), false),
            format!("sort_state ASC, sort_value DESC NULLS LAST, {TIES}")
        );
        // a checkbox ascending is true first
        assert_eq!(
            order(tag(5), true),
            format!("sort_state ASC, sort_value DESC NULLS LAST, {TIES}")
        );
        assert_eq!(
            order(tag(5), false),
            format!("sort_state ASC, sort_value ASC NULLS LAST, {TIES}")
        );
        // a basic tag is only applied or not, whichever way it runs
        assert_eq!(order(tag(1), true), format!("sort_state ASC, {TIES}"));
        assert_eq!(order(tag(1), false), format!("sort_state ASC, {TIES}"));
        assert_eq!(order(tag(10), false), format!("sort_state ASC, {TIES}"));
    }

    #[test]
    fn a_group_orders_before_the_sort() {
        let arrange = arranged(
            Some(sort(
                ArrangeField::Metadata {
                    key: MetadataKey::Title,
                },
                true,
            )),
            Some(group(ArrangeField::Metadata {
                key: MetadataKey::Artist,
            })),
        );
        assert_eq!(
            order_by(&arrange, Unsorted::Relevance),
            format!(
                "group_state ASC, group_value COLLATE natural_sort ASC NULLS LAST, sort_state ASC, sort_value COLLATE natural_sort ASC NULLS LAST, {TIES}"
            )
        );
        // grouped but unsorted keeps the list's own order inside each group
        let arrange = arranged(None, Some(group(ArrangeField::Tag { tag_id: 1 })));
        assert_eq!(
            order_by(&arrange, Unsorted::Position),
            r#"group_state ASC, position, song_id COLLATE "C""#
        );
    }

    /// The user's own tag is a row of theirs, and the state tells a value from an empty one
    /// from none at all.
    #[test]
    fn a_tag_sort_reads_the_users_row() {
        let (sql, values) = compile_arranged(&arranged(
            Some(sort(ArrangeField::Tag { tag_id: 4 }, true)),
            None,
        ));
        assert!(
            sql.contains("LEFT JOIN user_tags_applied AS sort_tag ON sort_tag.song_id=query_songs.song_id AND sort_tag.user_id=$1 AND sort_tag.tag_id=$2"),
            "{sql}"
        );
        assert!(
            sql.contains("(CASE WHEN NOT (sort_tag.song_id IS NOT NULL) THEN 2 WHEN sort_tag.value IS NULL THEN 1 ELSE 0 END) AS sort_state"),
            "{sql}"
        );
        assert!(
            sql.contains("(sort_tag.value)::double precision AS sort_value"),
            "{sql}"
        );
        // a song from outside the user's own has none of their rows, so nothing is joined
        assert_eq!(
            sql.matches("LEFT JOIN user_tags_applied").count(),
            1,
            "{sql}"
        );
        assert!(sql.contains("2 AS sort_state"), "{sql}");
        assert_eq!(values.len(), 2);
    }

    /// My Plays reads 0 and Favorited false with no row, so neither is ever empty.
    #[test]
    fn activity_tags_with_a_default_always_have_a_value() {
        let (sql, _) = compile_arranged(&arranged(
            Some(sort(ArrangeField::Tag { tag_id: 8 }, false)),
            None,
        ));
        assert!(
            sql.contains("0 AS sort_state, COALESCE((sort_tag.value)::double precision, 0.0::double precision) AS sort_value"),
            "{sql}"
        );
        let (sql, _) = compile_arranged(&arranged(
            Some(sort(ArrangeField::Tag { tag_id: 9 }, true)),
            None,
        ));
        assert!(
            sql.contains(
                "0 AS sort_state, COALESCE(((sort_tag.value) = 'true'), FALSE) AS sort_value"
            ),
            "{sql}"
        );
    }

    #[test]
    fn derived_and_suggested_tags_read_their_own_tables() {
        let (sql, _) = compile_arranged(&arranged(
            Some(sort(ArrangeField::Tag { tag_id: 7 }, true)),
            None,
        ));
        assert!(sql.contains("FROM user_songs AS arrange_library"), "{sql}");
        // nobody else's song is in the user's library
        assert!(
            sql.contains("0 AS sort_state, FALSE AS sort_value"),
            "{sql}"
        );

        let (sql, _) = compile_arranged(&arranged(
            Some(sort(ArrangeField::Tag { tag_id: 10 }, true)),
            None,
        ));
        assert!(
            sql.contains("LEFT JOIN default_tags_applied AS sort_tag ON sort_tag.song_id=query_songs.song_id AND sort_tag.tag_id=$2 AND NOT EXISTS ( SELECT 1 FROM default_tags_removed AS sort_tag_removed WHERE sort_tag_removed.user_id=$1"),
            "{sql}"
        );
        // suggested tags are on other people's songs too, so both halves look
        assert_eq!(
            sql.matches("LEFT JOIN default_tags_applied").count(),
            2,
            "{sql}"
        );
        assert!(
            sql.contains(
                "(CASE WHEN sort_tag.song_id IS NOT NULL THEN 0 ELSE 2 END) AS sort_state"
            ),
            "{sql}"
        );
    }

    #[test]
    fn metadata_tags_read_the_stored_row() {
        let (sql, _) = compile_arranged(&arranged(
            Some(sort(
                ArrangeField::Metadata {
                    key: MetadataKey::Explicit,
                },
                true,
            )),
            Some(group(ArrangeField::Metadata {
                key: MetadataKey::Genre,
            })),
        ));
        assert!(
            sql.contains("NULLIF(array_to_string(stored.genre_names, ', '), '') AS genre"),
            "{sql}"
        );
        assert!(
            sql.contains("(CASE query_songs.content_rating WHEN 'explicit' THEN TRUE WHEN 'clean' THEN FALSE END) AS sort_value"),
            "{sql}"
        );
        // genre groups by its whole text, ignoring case, and is named as stored
        assert!(
            sql.contains("lower(query_songs.genre) AS group_value"),
            "{sql}"
        );
        assert!(
            sql.contains("lower(query_songs.genre) AS group_key"),
            "{sql}"
        );
        assert!(
            sql.contains("(query_songs.genre)::text AS group_label"),
            "{sql}"
        );
    }

    /// A datetime groups by its day in the user's time zone, which is bound only then.
    #[test]
    fn a_datetime_groups_by_its_day_in_the_users_zone() {
        let (sql, values) = compile_arranged(&arranged(
            None,
            Some(group(ArrangeField::Tag { tag_id: 3 })),
        ));
        assert!(
            sql.contains("(((group_tag.value)::timestamptz) AT TIME ZONE $3)::date AS group_value"),
            "{sql}"
        );
        assert!(
            sql.contains("to_char((((group_tag.value)::timestamptz) AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS group_key"),
            "{sql}"
        );
        assert_eq!(values.len(), 3);
        assert_eq!(
            values[2],
            sea_query::Value::String(Some("America/Denver".to_string()))
        );

        let (_, values) = compile_arranged(&arranged(
            None,
            Some(group(ArrangeField::Tag { tag_id: 4 })),
        ));
        assert_eq!(values.len(), 2, "no time zone for a number");
    }

    /// Sorted or grouped, both halves stop at the cap, and so does the whole list.
    #[test]
    fn an_arranged_query_caps_the_whole_list() {
        let (sql, _) = compile_arranged(&arranged(
            Some(sort(
                ArrangeField::Metadata {
                    key: MetadataKey::Title,
                },
                true,
            )),
            None,
        ));
        assert_eq!(
            sql.matches(&format!("LIMIT {}", MAX_ARRANGED_SONGS + 1))
                .count(),
            3,
            "{sql}"
        );
        assert!(
            sql.ends_with(&format!("LIMIT {}", MAX_ARRANGED_SONGS + 1)),
            "{sql}"
        );
    }

    #[test]
    fn a_list_of_ids_keeps_its_order_and_is_never_capped() {
        let ids = vec!["b".to_string(), "a".to_string()];
        let (sql, values) =
            compile_song_ids(&ids, Uuid::nil(), &ArrangeContext::default()).unwrap();
        let sql = squash(&sql);
        assert!(
            sql.contains("FROM json_array_elements_text($2::json) WITH ORDINALITY AS given(song_id, position)"),
            "{sql}"
        );
        assert!(
            sql.ends_with(r#"ORDER BY position, song_id COLLATE "C""#),
            "{sql}"
        );
        assert!(!sql.contains("LIMIT"), "{sql}");
        assert_eq!(
            values[1],
            sea_query::Value::String(Some(r#"["b","a"]"#.to_string()))
        );
    }

    #[test]
    fn repeated_and_blank_ids_are_dropped() {
        let ids: Vec<String> = ["a", "", "b", "a"].map(String::from).to_vec();
        assert_eq!(unique_song_ids(&ids).unwrap(), ["a", "b"]);
        let too_many = vec!["a".to_string(); MAX_ARRANGED_SONG_IDS + 1];
        assert!(unique_song_ids(&too_many).is_err());
    }

    #[test]
    fn sorts_and_groups_parse_from_json() {
        let parsed: QuerySort = serde_json::from_str(
            r#"{ "field": "metadata", "key": "album", "direction": "descending" }"#,
        )
        .unwrap();
        assert_eq!(
            parsed,
            sort(
                ArrangeField::Metadata {
                    key: MetadataKey::Album
                },
                false
            )
        );
        let parsed: QueryGroup =
            serde_json::from_str(r#"{ "field": "tag", "tag_id": 4, "direction": "ascending" }"#)
                .unwrap();
        assert_eq!(parsed, group(ArrangeField::Tag { tag_id: 4 }));
        assert!(
            serde_json::from_str::<QuerySort>(
                r#"{ "field": "metadata", "key": "date_added", "direction": "ascending" }"#
            )
            .is_err()
        );
        assert!(serde_json::from_str::<QuerySort>(r#"{ "key": "title" }"#).is_err());
    }

    fn row(song_id: &str, certain: bool) -> ArrangedRow {
        ArrangedRow {
            song_id: song_id.to_string(),
            certain,
            has_metadata: true,
            group_state: 0,
            group_key: None,
            group_label: None,
        }
    }

    fn song(song_id: &str, certain: bool) -> QueryMatch {
        QueryMatch {
            song_id: song_id.to_string(),
            certain,
        }
    }

    #[test]
    fn a_full_list_is_not_capped() {
        let rows: Vec<ArrangedRow> = (0..MAX_DISCOVERED_SONGS)
            .map(|index| row(&index.to_string(), false))
            .chain([row("mine", true)])
            .collect();
        let matches = finish(rows, CapRule::Discovered, false);
        assert!(!matches.capped);
        assert_eq!(matches.songs.len(), MAX_DISCOVERED_SONGS + 1);
        assert_eq!(matches.groups, None);
    }

    #[test]
    fn the_song_past_the_cap_is_dropped_and_the_users_own_are_kept() {
        // the extra discovered song sorts in between two of the user's own
        let mut rows: Vec<ArrangedRow> = (0..MAX_DISCOVERED_SONGS)
            .map(|index| row(&format!("d{index}"), false))
            .collect();
        rows.push(row("mine-1", true));
        rows.push(row("extra", false));
        rows.push(row("mine-2", true));

        let matches = finish(rows, CapRule::Discovered, false);
        assert!(matches.capped);
        assert_eq!(matches.songs.len(), MAX_DISCOVERED_SONGS + 2);
        assert!(!matches.songs.iter().any(|song| song.song_id == "extra"));
        assert_eq!(matches.songs[MAX_DISCOVERED_SONGS].song_id, "mine-1");
        assert_eq!(matches.songs[MAX_DISCOVERED_SONGS + 1].song_id, "mine-2");
    }

    #[test]
    fn an_arranged_list_keeps_only_the_first_songs_whoevers_they_are() {
        let rows: Vec<ArrangedRow> = (0..=MAX_ARRANGED_SONGS)
            .map(|index| row(&format!("s{index}"), index % 2 == 0))
            .collect();
        let matches = finish(rows, CapRule::Total, false);
        assert!(matches.capped);
        assert_eq!(matches.songs.len(), MAX_ARRANGED_SONGS);
        assert_eq!(
            matches.songs.last().unwrap().song_id,
            format!("s{}", MAX_ARRANGED_SONGS - 1)
        );
    }

    #[test]
    fn groups_are_runs_named_by_their_first_song() {
        let grouped = |song_id: &str, state, key: Option<&str>, label: Option<&str>| ArrangedRow {
            group_state: state,
            group_key: key.map(String::from),
            group_label: label.map(String::from),
            has_metadata: song_id != "c",
            ..row(song_id, true)
        };
        let matches = finish(
            vec![
                grouped("a", 0, Some("prince"), Some("Prince")),
                grouped("b", 0, Some("prince"), Some("PRINCE")),
                grouped("c", 0, Some("queen"), Some("Queen")),
                grouped("d", 1, None, None),
                grouped("e", 2, None, None),
                grouped("f", 2, None, None),
            ],
            CapRule::None,
            true,
        );
        assert_eq!(
            matches.groups.unwrap(),
            vec![
                MatchGroup {
                    state: GroupState::Value,
                    value: Some("Prince".into()),
                    count: 2
                },
                MatchGroup {
                    state: GroupState::Value,
                    value: Some("Queen".into()),
                    count: 1
                },
                MatchGroup {
                    state: GroupState::NoValue,
                    value: None,
                    count: 1
                },
                MatchGroup {
                    state: GroupState::NotApplied,
                    value: None,
                    count: 2
                },
            ]
        );
        assert_eq!(matches.missing_metadata, ["c"]);
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

    /// Runs a compiled query and returns what it matched, in order. Every stored song
    /// Apple knows is a candidate now, so the database's real rows come back too; only the
    /// `test-q-` songs this module inserted are kept.
    async fn run_test_query(
        txn: &DatabaseTransaction,
        user_id: Uuid,
        json: &str,
        tag_types: &HashMap<i64, TagType>,
        sort: Option<QuerySort>,
    ) -> Vec<QueryMatch> {
        run_arranged_query(
            txn,
            user_id,
            json,
            tag_types,
            Arrangement {
                sort,
                ..Arrangement::default()
            },
        )
        .await
        .songs
    }

    /// Runs a compiled query the way `run_query` does, cap included, and keeps only the
    /// `test-q-` songs. Groups are only read when there are no other songs in the way.
    async fn run_arranged_query(
        txn: &DatabaseTransaction,
        user_id: Uuid,
        json: &str,
        tag_types: &HashMap<i64, TagType>,
        arrangement: Arrangement,
    ) -> QueryMatches {
        let arrange = arrange_context(txn, user_id, &arrangement).await.unwrap();
        let (sql, values) = compile_query(
            &parse(json),
            tag_types,
            &TagDefaults::default(),
            user_id,
            false,
            false,
            &arrange,
        )
        .unwrap();
        let rows: Vec<ArrangedRow> = ArrangedRow::find_by_statement(
            Statement::from_sql_and_values(DbBackend::Postgres, sql, values),
        )
        .all(txn)
        .await
        .unwrap();
        let rule = if arrangement.is_none() {
            CapRule::Discovered
        } else {
            CapRule::Total
        };
        let mut matches = finish(rows, rule, arrangement.group.is_some());
        matches
            .songs
            .retain(|song| song.song_id.starts_with("test-q-"));
        matches
    }

    async fn run_metadata_query(
        txn: &DatabaseTransaction,
        user_id: Uuid,
        json: &str,
    ) -> Vec<String> {
        let mut songs: Vec<String> = run_test_query(txn, user_id, json, &tag_types(), None)
            .await
            .into_iter()
            .map(|song| song.song_id.trim_start_matches("test-q-").to_owned())
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

        let songs = run_test_query(
            &txn,
            user_id,
            &format!(
                r#"{{ "where": {{ "and": [
                    {{ "filter": {{ "field": "metadata", "key": "genre", "op": "is", "value": "pop" }} }},
                    {{ "filter": {{ "field": "tag", "tag_id": {tag_id}, "op": "is_applied" }} }}
                ] }} }}"#
            ),
            &HashMap::from([(tag_id, TagType::Basic)]),
            None,
        )
        .await;

        assert_eq!(songs, vec![song("test-q-p1", true)]);
    }

    /// Stores songs the user does not have, named `test-q-<suffix>` and titled
    /// `zz test-q <title>`, so a title filter on `zz test-q` finds only these and the
    /// library from [`metadata_library`].
    async fn store_discovered(txn: &DatabaseTransaction, songs: &[(&str, &str, &str, i64)]) {
        for (suffix, title, artist, plays) in songs {
            txn.execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                r#"
                INSERT INTO metadata_song_tags_applied
                    (song_id, found, name, artist_name, album_name, total_plays)
                VALUES ($1, true, $2, $3, 'Album', $4)
                "#,
                [
                    format!("test-q-{suffix}").into(),
                    format!("zz test-q {title}").into(),
                    (*artist).into(),
                    (*plays).into(),
                ],
            ))
            .await
            .unwrap();
        }
    }

    const ZZ_TITLES: &str = r#"{ "where": { "filter": { "field": "metadata", "key": "title", "op": "starts_with", "value": "zz test-q" } } }"#;

    fn ids(songs: &[QueryMatch]) -> Vec<&str> {
        songs
            .iter()
            .map(|song| song.song_id.trim_start_matches("test-q-"))
            .collect()
    }

    /// A song the user does not have matches a negative filter too, and comes back marked
    /// as not certain. A song carrying one of their tags is certain without being in their
    /// library.
    #[tokio::test]
    #[ignore]
    async fn songs_outside_the_library_match_and_are_not_certain() {
        let (txn, user_id) = metadata_library().await;
        // played more than anything real, so it is first of the discovered songs and the
        // cap never cuts it off whatever else the database holds
        store_discovered(&txn, &[("d1", "Elsewhere", "Someone", 1_000_000_000_000)]).await;

        let tag_id: i64 = txn
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO tags (name, color, user_id) VALUES ('test-q-pop', '#000000', $1) RETURNING tag_id",
                [user_id.into()],
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get_by_index(0)
            .unwrap();
        // tagged by the user, stored, but not in their library
        store_discovered(&txn, &[("t1", "Tagged", "Someone", 0)]).await;
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO user_tags_applied (song_id, user_id, tag_id) VALUES ('test-q-p1', $1, $2), ('test-q-t1', $1, $2)",
            [user_id.into(), tag_id.into()],
        ))
        .await
        .unwrap();

        let not_pop = format!(
            r#"{{ "where": {{ "filter": {{ "field": "tag", "tag_id": {tag_id}, "op": "is_not_applied" }} }} }}"#
        );
        let types = HashMap::from([(tag_id, TagType::Basic)]);
        let mut songs = run_test_query(&txn, user_id, &not_pop, &types, None).await;
        songs.sort_by(|left, right| left.song_id.cmp(&right.song_id));
        assert_eq!(
            songs,
            vec![
                song("test-q-d1", false),
                song("test-q-n1", true),
                song("test-q-p2", true),
                song("test-q-x1", true),
            ]
        );

        let pop = format!(
            r#"{{ "where": {{ "filter": {{ "field": "tag", "tag_id": {tag_id}, "op": "is_applied" }} }} }}"#
        );
        let mut songs = run_test_query(&txn, user_id, &pop, &types, None).await;
        songs.sort_by(|left, right| left.song_id.cmp(&right.song_id));
        assert_eq!(
            songs,
            vec![song("test-q-p1", true), song("test-q-t1", true)]
        );
    }

    /// Limited to the library, only `user_songs` rows match: a song carrying the user's tag
    /// outside the library and a stored song from elsewhere both drop out.
    #[tokio::test]
    #[ignore]
    async fn a_library_only_query_matches_only_library_songs() {
        let (txn, user_id) = metadata_library().await;
        store_discovered(&txn, &[("d1", "Elsewhere", "Someone", 1_000_000_000_000)]).await;
        let tag_id: i64 = txn
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO tags (name, color, user_id) VALUES ('test-q-pop', '#000000', $1) RETURNING tag_id",
                [user_id.into()],
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get_by_index(0)
            .unwrap();
        store_discovered(&txn, &[("t1", "Tagged", "Someone", 0)]).await;
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO user_tags_applied (song_id, user_id, tag_id) VALUES ('test-q-p1', $1, $2), ('test-q-t1', $1, $2)",
            [user_id.into(), tag_id.into()],
        ))
        .await
        .unwrap();
        let types = HashMap::from([(tag_id, TagType::Basic)]);
        let run = |op: &'static str| {
            let json = format!(
                r#"{{ "where": {{ "filter": {{ "field": "tag", "tag_id": {tag_id}, "op": "{op}" }} }} }}"#
            );
            let (sql, values) = compile_query(
                &parse(&json),
                &types,
                &TagDefaults::default(),
                user_id,
                false,
                true,
                &ArrangeContext::default(),
            )
            .unwrap();
            let txn = &txn;
            async move {
                let rows = ArrangedRow::find_by_statement(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    sql,
                    values,
                ))
                .all(txn)
                .await
                .unwrap();
                let mut ids: Vec<String> = rows
                    .into_iter()
                    .filter(|song| song.song_id.starts_with("test-q-"))
                    .map(|song| {
                        assert!(song.certain, "{}", song.song_id);
                        song.song_id
                    })
                    .collect();
                ids.sort();
                ids
            }
        };

        assert_eq!(run("is_applied").await, vec!["test-q-p1"]);
        assert_eq!(
            run("is_not_applied").await,
            vec!["test-q-n1", "test-q-p2", "test-q-x1"]
        );
    }

    /// The three checkbox activity tags, queried for real: In My Library from
    /// `user_songs`, Tagged from the user's own tags, and Favorited from its rows,
    /// with a song that has none of them reading false for each.
    #[tokio::test]
    #[ignore]
    async fn checkbox_activity_tags_match_what_they_describe() {
        let (txn, user_id) = metadata_library().await;
        // not in the library, played more than anything real so the cap keeps it
        store_discovered(&txn, &[("d1", "Elsewhere", "Someone", 1_000_000_000_000)]).await;

        let activity: HashMap<ActivityTag, i64> = crate::db::activity_tags::get_activity_tags(&txn)
            .await
            .unwrap()
            .into_iter()
            .map(|(tag, model)| (tag, model.tag_id))
            .collect();
        let own_tag: i64 = txn
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO tags (name, color, user_id) VALUES ('test-q-own', '#000000', $1) RETURNING tag_id",
                [user_id.into()],
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get_by_index(0)
            .unwrap();
        // p1 carries the user's own tag, p2 is favorited, and x1 has only a play
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO user_tags_applied (song_id, user_id, tag_id, value) VALUES
                ('test-q-p1', $1, $2, NULL), ('test-q-p2', $1, $3, 'true'), ('test-q-x1', $1, $4, '1')",
            [
                user_id.into(),
                own_tag.into(),
                activity[&ActivityTag::Favorited].into(),
                activity[&ActivityTag::MyPlays].into(),
            ],
        ))
        .await
        .unwrap();

        // what run_query would look up for these three
        let QueryableTags {
            tag_types: types,
            defaults,
        } = get_queryable_tags(
            &txn,
            user_id,
            &HashSet::from([
                activity[&ActivityTag::InMyLibrary],
                activity[&ActivityTag::Tagged],
                activity[&ActivityTag::Favorited],
            ]),
            false,
        )
        .await
        .unwrap();
        assert_eq!(defaults.derived.len(), 2);
        assert_eq!(
            defaults.false_checkboxes,
            HashSet::from([activity[&ActivityTag::Favorited]])
        );
        let run = |tag: ActivityTag, op: &'static str| {
            let json = format!(
                r#"{{ "where": {{ "filter": {{ "field": "tag", "tag_id": {}, "op": "{op}" }} }} }}"#,
                activity[&tag]
            );
            let (sql, values) = compile_query(
                &parse(&json),
                &types,
                &defaults,
                user_id,
                false,
                false,
                &ArrangeContext::default(),
            )
            .unwrap();
            let txn = &txn;
            async move {
                let mut ids: Vec<String> = ArrangedRow::find_by_statement(
                    Statement::from_sql_and_values(DbBackend::Postgres, sql, values),
                )
                .all(txn)
                .await
                .unwrap()
                .into_iter()
                .filter(|song| song.song_id.starts_with("test-q-"))
                .map(|song| song.song_id.trim_start_matches("test-q-").to_owned())
                .collect();
                ids.sort();
                ids
            }
        };

        assert_eq!(
            run(ActivityTag::InMyLibrary, "is_true").await,
            ["n1", "p1", "p2", "x1"]
        );
        assert_eq!(run(ActivityTag::InMyLibrary, "is_false").await, ["d1"]);
        assert_eq!(run(ActivityTag::Tagged, "is_true").await, ["p1"]);
        assert_eq!(
            run(ActivityTag::Tagged, "is_false").await,
            ["d1", "n1", "p2", "x1"]
        );
        assert_eq!(run(ActivityTag::Favorited, "is_true").await, ["p2"]);
        assert_eq!(
            run(ActivityTag::Favorited, "is_false").await,
            ["d1", "n1", "p1", "x1"]
        );
        assert!(run(ActivityTag::Favorited, "is_null").await.is_empty());
        assert!(run(ActivityTag::Tagged, "is_null").await.is_empty());
    }

    /// Most relevant first: the user's own songs before the rest when the score ties, then
    /// every user's plays, then song id.
    #[tokio::test]
    #[ignore]
    async fn relevance_puts_the_users_own_first_then_plays() {
        let (txn, user_id) = metadata_library().await;
        store_discovered(
            &txn,
            &[
                ("d-quiet", "Quiet", "Someone", 1),
                ("d-loud", "Loud", "Someone", 900),
                ("d-tie-b", "Tie", "Someone", 5),
                ("d-tie-a", "Tie", "Someone", 5),
            ],
        )
        .await;
        // the library songs need the title too, or the filter leaves them out
        txn.execute_raw(Statement::from_string(
            DbBackend::Postgres,
            "UPDATE metadata_song_tags_applied SET name = 'zz test-q ' || name WHERE song_id IN ('test-q-p1', 'test-q-p2')",
        ))
        .await
        .unwrap();

        let songs = run_test_query(&txn, user_id, ZZ_TITLES, &tag_types(), None).await;
        assert_eq!(
            ids(&songs),
            vec!["p1", "p2", "d-loud", "d-tie-a", "d-tie-b", "d-quiet"]
        );
    }

    /// Sorting reads the stored metadata in natural order, puts songs with none last both
    /// ways, and keeps the user's own and the rest in one list.
    #[tokio::test]
    #[ignore]
    async fn sorts_read_the_metadata_in_natural_order() {
        let (txn, user_id) = metadata_library().await;
        store_discovered(
            &txn,
            &[
                ("d10", "Track 10", "beta", 0),
                ("d9", "track 9", "Alpha", 0),
                ("d-empty-artist", "Track 1", "", 0),
            ],
        )
        .await;
        txn.execute_raw(Statement::from_string(
            DbBackend::Postgres,
            "UPDATE metadata_song_tags_applied SET name = 'zz test-q ' || name WHERE song_id IN ('test-q-p1', 'test-q-p2')",
        ))
        .await
        .unwrap();
        let sort = |key, direction| {
            Some(QuerySort {
                field: ArrangeField::Metadata { key },
                direction,
            })
        };

        let songs = run_test_query(
            &txn,
            user_id,
            ZZ_TITLES,
            &tag_types(),
            sort(MetadataKey::Title, SortDirection::Ascending),
        )
        .await;
        assert_eq!(ids(&songs), vec!["p1", "p2", "d-empty-artist", "d9", "d10"]);
        assert_eq!(
            songs.iter().map(|song| song.certain).collect::<Vec<_>>(),
            vec![true, true, false, false, false]
        );

        // an empty artist sorts like a missing one, last either way
        let songs = run_test_query(
            &txn,
            user_id,
            ZZ_TITLES,
            &tag_types(),
            sort(MetadataKey::Artist, SortDirection::Ascending),
        )
        .await;
        assert_eq!(ids(&songs), vec!["d9", "d10", "p2", "p1", "d-empty-artist"]);
        let songs = run_test_query(
            &txn,
            user_id,
            ZZ_TITLES,
            &tag_types(),
            sort(MetadataKey::Artist, SortDirection::Descending),
        )
        .await;
        assert_eq!(ids(&songs), vec!["p1", "p2", "d10", "d9", "d-empty-artist"]);

        // with no title to filter on, songs without metadata still come back, last
        let every = r#"{ "where": { "and": [] } }"#;
        let songs = run_test_query(
            &txn,
            user_id,
            every,
            &tag_types(),
            sort(MetadataKey::Title, SortDirection::Descending),
        )
        .await;
        let titled_last = ids(&songs);
        assert_eq!(&titled_last[titled_last.len() - 2..], ["n1", "x1"]);
    }

    /// Sorted, the cap keeps the first songs in the chosen order, whoever's they are: the
    /// user's own sorting after the cap are left out too.
    #[tokio::test]
    #[ignore]
    async fn a_sorted_cap_keeps_the_first_songs_whoever_s_they_are() {
        let (txn, user_id) = metadata_library().await;
        // more discovered songs than the cap, each sorting before the library songs
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
            INSERT INTO metadata_song_tags_applied (song_id, found, name, total_plays)
            SELECT 'test-q-d' || lpad(n::text, 5, '0'), true, 'zz test-q a ' || lpad(n::text, 5, '0'), 0
            FROM generate_series(1, $1) AS n
            "#,
            [((MAX_ARRANGED_SONGS + 5) as i64).into()],
        ))
        .await
        .unwrap();
        txn.execute_raw(Statement::from_string(
            DbBackend::Postgres,
            "UPDATE metadata_song_tags_applied SET name = 'zz test-q z ' || name WHERE song_id IN ('test-q-p1', 'test-q-p2')",
        ))
        .await
        .unwrap();

        let title = |direction| QuerySort {
            field: ArrangeField::Metadata {
                key: MetadataKey::Title,
            },
            direction,
        };
        let sorted = |direction| Arrangement {
            sort: Some(title(direction)),
            ..Arrangement::default()
        };
        let matches = run_arranged_query(
            &txn,
            user_id,
            ZZ_TITLES,
            &tag_types(),
            sorted(SortDirection::Ascending),
        )
        .await;
        assert!(matches.capped);
        assert_eq!(matches.songs.len(), MAX_ARRANGED_SONGS);
        assert_eq!(matches.songs[0].song_id, "test-q-d00001");
        assert_eq!(
            matches.songs[MAX_ARRANGED_SONGS - 1].song_id,
            format!("test-q-d{:05}", MAX_ARRANGED_SONGS)
        );
        assert!(!matches.songs.iter().any(|song| song.certain));

        // the other way the user's own come first, and are the first in order
        let matches = run_arranged_query(
            &txn,
            user_id,
            ZZ_TITLES,
            &tag_types(),
            sorted(SortDirection::Descending),
        )
        .await;
        assert!(matches.capped);
        assert_eq!(ids(&matches.songs[..2]), ["p2", "p1"]);

        // unsorted, every one of the user's own comes first, and the rest are capped
        let matches = run_arranged_query(
            &txn,
            user_id,
            ZZ_TITLES,
            &tag_types(),
            Arrangement::default(),
        )
        .await;
        assert!(matches.capped);
        assert_eq!(matches.songs.len(), MAX_DISCOVERED_SONGS + 2);
        assert_eq!(ids(&matches.songs[..2]), ["p1", "p2"]);
    }

    /// Inserts a tag of the user's with `type` and returns its id.
    async fn insert_tag(
        txn: &DatabaseTransaction,
        user_id: Uuid,
        name: &str,
        tag_type: &str,
    ) -> i64 {
        txn.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO tags (name, color, user_id, type) VALUES ($1, '#000000', $2, $3::tag_type) RETURNING tag_id",
            [name.into(), user_id.into(), tag_type.into()],
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get_by_index(0)
        .unwrap()
    }

    async fn apply(
        txn: &DatabaseTransaction,
        user_id: Uuid,
        tag_id: i64,
        song: &str,
        value: Option<&str>,
    ) {
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO user_tags_applied (song_id, user_id, tag_id, value) VALUES ($1, $2, $3, $4)",
            [
                format!("test-q-{song}").into(),
                user_id.into(),
                tag_id.into(),
                value.map(String::from).into(),
            ],
        ))
        .await
        .unwrap();
    }

    const EVERY: &str = r#"{ "where": { "and": [] } }"#;

    fn by_tag(tag_id: i64, direction: SortDirection) -> Arrangement {
        Arrangement {
            sort: Some(QuerySort {
                field: ArrangeField::Tag { tag_id },
                direction,
            }),
            ..Arrangement::default()
        }
    }

    /// A tag sort: values in order, then songs with the tag but no value, then songs
    /// without it, the last two in the same place whichever way the sort runs.
    #[tokio::test]
    #[ignore]
    async fn a_tag_sort_puts_empty_then_untagged_songs_last() {
        let (txn, user_id) = metadata_library().await;
        let rating = insert_tag(&txn, user_id, "test-q-rating", "number").await;
        apply(&txn, user_id, rating, "p1", Some("10")).await;
        apply(&txn, user_id, rating, "p2", Some("2.5")).await;
        apply(&txn, user_id, rating, "n1", None).await;

        let run = |direction| {
            let txn = &txn;
            async move {
                ids(&run_arranged_query(
                    txn,
                    user_id,
                    EVERY,
                    &tag_types(),
                    by_tag(rating, direction),
                )
                .await
                .songs)
                .into_iter()
                .map(String::from)
                .collect::<Vec<_>>()
            }
        };
        assert_eq!(
            run(SortDirection::Ascending).await,
            ["p2", "p1", "n1", "x1"]
        );
        assert_eq!(
            run(SortDirection::Descending).await,
            ["p1", "p2", "n1", "x1"]
        );
    }

    /// Checkboxes: true, then false, then applied with no value, then not applied.
    #[tokio::test]
    #[ignore]
    async fn a_checkbox_sorts_true_false_then_empty() {
        let (txn, user_id) = metadata_library().await;
        let liked = insert_tag(&txn, user_id, "test-q-liked", "checkbox").await;
        apply(&txn, user_id, liked, "p1", Some("false")).await;
        apply(&txn, user_id, liked, "p2", Some("true")).await;
        apply(&txn, user_id, liked, "x1", None).await;

        let songs = run_arranged_query(
            &txn,
            user_id,
            EVERY,
            &tag_types(),
            by_tag(liked, SortDirection::Ascending),
        )
        .await
        .songs;
        assert_eq!(ids(&songs), ["p2", "p1", "x1", "n1"]);
        let songs = run_arranged_query(
            &txn,
            user_id,
            EVERY,
            &tag_types(),
            by_tag(liked, SortDirection::Descending),
        )
        .await
        .songs;
        assert_eq!(ids(&songs), ["p1", "p2", "x1", "n1"]);
    }

    /// A basic tag sorts its songs first, either way.
    #[tokio::test]
    #[ignore]
    async fn a_basic_tag_sorts_its_songs_first() {
        let (txn, user_id) = metadata_library().await;
        let gym = insert_tag(&txn, user_id, "test-q-gym", "basic").await;
        apply(&txn, user_id, gym, "x1", None).await;
        apply(&txn, user_id, gym, "p2", None).await;

        for direction in [SortDirection::Ascending, SortDirection::Descending] {
            let songs =
                run_arranged_query(&txn, user_id, EVERY, &tag_types(), by_tag(gym, direction))
                    .await
                    .songs;
            // tagged first, each half by title, songs without a title last
            assert_eq!(ids(&songs), ["p2", "x1", "p1", "n1"]);
        }
    }

    /// Grouping by artist: one group per artist ignoring case, named as the first song has
    /// it, sorted inside by title, and the songs with no artist last.
    #[tokio::test]
    #[ignore]
    async fn grouping_by_artist_makes_one_group_per_artist() {
        let (txn, user_id) = metadata_library().await;
        txn.execute_raw(Statement::from_string(
            DbBackend::Postgres,
            "INSERT INTO user_songs (song_id, user_id) SELECT 'test-q-p3', id FROM auth.users LIMIT 1",
        ))
        .await
        .unwrap();
        txn.execute_raw(Statement::from_string(
            DbBackend::Postgres,
            r#"
            INSERT INTO metadata_song_tags_applied (song_id, found, name, artist_name)
            VALUES ('test-q-p3', true, 'Kiss', 'PRINCE')
            "#,
        ))
        .await
        .unwrap();
        // only one user's songs in the test database's way
        let matches = run_arranged_query(
            &txn,
            user_id,
            EVERY,
            &tag_types(),
            Arrangement {
                sort: Some(QuerySort {
                    field: ArrangeField::Metadata {
                        key: MetadataKey::Title,
                    },
                    direction: SortDirection::Ascending,
                }),
                group: Some(QueryGroup {
                    field: ArrangeField::Metadata {
                        key: MetadataKey::Artist,
                    },
                    direction: SortDirection::Ascending,
                }),
                time_zone: None,
            },
        )
        .await;
        let mine: Vec<&str> = ids(&matches.songs);
        assert_eq!(mine, ["p3", "p2", "p1", "n1", "x1"]);
        let groups = matches.groups.unwrap();
        let tail = &groups[groups.len() - 3..];
        assert_eq!(
            tail,
            [
                MatchGroup {
                    state: GroupState::Value,
                    value: Some("PRINCE".into()),
                    count: 2
                },
                MatchGroup {
                    state: GroupState::Value,
                    value: Some("The Rolling Stones".into()),
                    count: 1
                },
                MatchGroup {
                    state: GroupState::NoValue,
                    value: None,
                    count: groups.last().unwrap().count
                },
            ]
        );
        assert!(matches.missing_metadata.contains(&"test-q-n1".to_string()));
        assert!(matches.missing_metadata.contains(&"test-q-x1".to_string()));
    }

    /// Datetime groups are days in the user's zone: 01:30 UTC is the evening before in
    /// Denver.
    #[tokio::test]
    #[ignore]
    async fn datetime_groups_are_days_in_the_users_zone() {
        let (txn, user_id) = metadata_library().await;
        let seen = insert_tag(&txn, user_id, "test-q-seen", "datetime").await;
        apply(&txn, user_id, seen, "p1", Some("2024-03-02T01:30:00+00:00")).await;
        apply(&txn, user_id, seen, "p2", Some("2024-03-01T20:00:00+00:00")).await;
        let arrangement = |time_zone: &str| Arrangement {
            sort: None,
            group: Some(QueryGroup {
                field: ArrangeField::Tag { tag_id: seen },
                direction: SortDirection::Ascending,
            }),
            time_zone: Some(time_zone.to_string()),
        };

        let groups = run_arranged_query(
            &txn,
            user_id,
            EVERY,
            &tag_types(),
            arrangement("America/Denver"),
        )
        .await
        .groups
        .unwrap();
        assert_eq!(groups[0].value.as_deref(), Some("2024-03-01"));
        assert_eq!(groups[0].count, 2);

        let groups = run_arranged_query(&txn, user_id, EVERY, &tag_types(), arrangement("UTC"))
            .await
            .groups
            .unwrap();
        assert_eq!(groups[0].value.as_deref(), Some("2024-03-01"));
        assert_eq!(groups[0].count, 1);
        assert_eq!(groups[1].value.as_deref(), Some("2024-03-02"));

        assert!(matches!(
            arrange_context(&txn, user_id, &arrangement("Mars/Olympus")).await,
            Err(CadenzaError::QueryFormatError(_))
        ));
    }

    /// A list of ids sorts like a query, keeps its order unsorted, and is never capped.
    #[tokio::test]
    #[ignore]
    async fn a_list_of_ids_sorts_and_keeps_its_order() {
        let (txn, user_id) = metadata_library().await;
        let given: Vec<String> = ["x1", "p2", "p1", "p2"]
            .map(|id| format!("test-q-{id}"))
            .to_vec();
        let run = |arrangement: Arrangement| {
            let txn = &txn;
            let given = given.clone();
            async move {
                let arrange = arrange_context(txn, user_id, &arrangement).await.unwrap();
                let (sql, values) =
                    compile_song_ids(&unique_song_ids(&given).unwrap(), user_id, &arrange).unwrap();
                let rows = ArrangedRow::find_by_statement(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    sql,
                    values,
                ))
                .all(txn)
                .await
                .unwrap();
                finish(rows, CapRule::None, false)
            }
        };

        assert_eq!(
            ids(&run(Arrangement::default()).await.songs),
            ["x1", "p2", "p1"]
        );
        let sorted = run(Arrangement {
            sort: Some(QuerySort {
                field: ArrangeField::Metadata {
                    key: MetadataKey::Title,
                },
                direction: SortDirection::Ascending,
            }),
            ..Arrangement::default()
        })
        .await;
        assert_eq!(ids(&sorted.songs), ["p1", "p2", "x1"]);
        assert_eq!(sorted.missing_metadata, ["test-q-x1"]);
    }

    /// Suggested and activity tags sort like any other: a suggested tag the user removed is
    /// not on the song for them, My Plays reads 0 with no row, and In My Library is true only
    /// for library songs.
    #[tokio::test]
    #[ignore]
    async fn suggested_and_activity_tags_sort_like_any_tag() {
        let (txn, user_id) = metadata_library().await;
        let suggested: i64 = txn
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                "INSERT INTO tags (name, color, user_id) VALUES ('test-q-chill', '#000000', NULL) RETURNING tag_id",
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get_by_index(0)
            .unwrap();
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
            INSERT INTO default_tags_applied (song_id, tag_id)
            VALUES ('test-q-x1', $1), ('test-q-p2', $1);
            "#,
            [suggested.into()],
        ))
        .await
        .unwrap();
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO default_tags_removed (user_id, tag_id, song_id) VALUES ($1, $2, 'test-q-p2')",
            [user_id.into(), suggested.into()],
        ))
        .await
        .unwrap();
        let songs = run_arranged_query(
            &txn,
            user_id,
            EVERY,
            &tag_types(),
            by_tag(suggested, SortDirection::Ascending),
        )
        .await
        .songs;
        // x1 has it; p2's was removed by this user, so p2 sorts with the rest by title
        assert_eq!(ids(&songs), ["x1", "p1", "p2", "n1"]);

        let activity: HashMap<ActivityTag, i64> = crate::db::activity_tags::get_activity_tags(&txn)
            .await
            .unwrap()
            .into_iter()
            .map(|(tag, model)| (tag, model.tag_id))
            .collect();
        apply(
            &txn,
            user_id,
            activity[&ActivityTag::MyPlays],
            "p2",
            Some("3"),
        )
        .await;
        apply(
            &txn,
            user_id,
            activity[&ActivityTag::MyPlays],
            "n1",
            Some("1"),
        )
        .await;
        let songs = run_arranged_query(
            &txn,
            user_id,
            EVERY,
            &tag_types(),
            by_tag(activity[&ActivityTag::MyPlays], SortDirection::Descending),
        )
        .await
        .songs;
        // never played reads 0, last, by title, untitled last
        assert_eq!(ids(&songs), ["p2", "n1", "p1", "x1"]);

        store_discovered(&txn, &[("d1", "Elsewhere", "Someone", 1_000_000_000_000)]).await;
        let matches = run_arranged_query(
            &txn,
            user_id,
            EVERY,
            &tag_types(),
            Arrangement {
                group: Some(QueryGroup {
                    field: ArrangeField::Tag {
                        tag_id: activity[&ActivityTag::InMyLibrary],
                    },
                    direction: SortDirection::Ascending,
                }),
                ..Arrangement::default()
            },
        )
        .await;
        let groups = matches.groups.unwrap();
        assert_eq!(groups[0].value.as_deref(), Some("true"));
        assert_eq!(groups[0].count, 4);
        assert_eq!(groups[1].value.as_deref(), Some("false"));
        assert_eq!(ids(&matches.songs).last(), Some(&"d1"));
    }

    /// What a phone says about a song only its library knows is stored as a library row:
    /// it fills in a song Apple had no entry for, never replaces what Apple said, and is
    /// never a song another user's query discovers.
    #[tokio::test]
    #[ignore]
    async fn library_metadata_fills_in_songs_apple_does_not_know() {
        use crate::db::metadata_tags::{LibrarySong, store_library_song_metadata};

        let (txn, user_id) = metadata_library().await;
        let song = |song_id: &str, title: &str| LibrarySong {
            song_id: song_id.to_string(),
            title: title.to_string(),
            artist_name: Some("Me".into()),
            album_name: None,
            genre_names: vec!["Music".into(), "Rock".into()],
            duration_ms: Some(1000),
            release_date: Some("2024".into()),
            explicit: Some(false),
        };
        let stored = store_library_song_metadata(
            &txn,
            user_id,
            &[
                // Apple had no entry for it
                song("test-q-n1", "Demo"),
                // Apple knows this one, so it stays as Apple has it
                song("test-q-p1", "Not Paint It Black"),
                // no row yet, and the user has it
                song("test-q-x1", "Voice Memo"),
                // somebody else's song, which this user cannot name
                song("test-q-stranger", "Mine Now"),
            ],
        )
        .await
        .unwrap();
        let mut stored = stored;
        stored.sort();
        assert_eq!(stored, ["test-q-n1", "test-q-x1"]);

        let row = txn
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                "SELECT name, found, source, genre_names, release_date::text FROM metadata_song_tags_applied WHERE song_id = 'test-q-n1'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get_by_index::<String>(0).unwrap(), "Demo");
        assert!(row.try_get_by_index::<bool>(1).unwrap());
        assert_eq!(row.try_get_by_index::<String>(2).unwrap(), "library");
        assert_eq!(row.try_get_by_index::<Vec<String>>(3).unwrap(), ["Rock"]);
        assert_eq!(row.try_get_by_index::<String>(4).unwrap(), "2024-01-01");

        // now sortable, and still not discoverable: out of the library it is gone
        txn.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "DELETE FROM user_songs WHERE user_id = $1 AND song_id = 'test-q-n1'",
            [user_id.into()],
        ))
        .await
        .unwrap();
        let songs = run_test_query(&txn, user_id, EVERY, &tag_types(), None).await;
        assert!(!songs.iter().any(|song| song.song_id == "test-q-n1"));
    }
}
