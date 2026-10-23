//! Everything Cadenza stores about one user, as counts. The Your data screen
//! lists exactly [`user_data_counts`], so a new per-user table shows up there by
//! adding one entry.

use sea_orm::{ConnectionTrait, DbBackend, Statement, prelude::Uuid};

use crate::err::CadenzaError;
use crate::services::analytics::{Metric, metrics::MetricUnit};

/// Which block of the Your data screen a count sits in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DataSection {
    Library,
    Tags,
    Listening,
    Social,
}

/// One number about a user, and the SQL that reads it.
#[derive(Clone, Debug)]
pub struct DataCount {
    /// Stable key the client may match on.
    pub name: &'static str,
    pub section: DataSection,
    /// What the client shows beside the number.
    pub description: &'static str,
    pub unit: MetricUnit,
    /// A scalar `bigint` select. `$1` is the user id and must appear, so the
    /// count can only ever read this user's rows.
    pub sql: String,
}

/// A count of the user's rows in `table`, where `user_column` holds their id.
fn rows(
    name: &'static str,
    section: DataSection,
    description: &'static str,
    select: &str,
    from: &str,
) -> DataCount {
    DataCount {
        name,
        section,
        description,
        unit: MetricUnit::Count,
        sql: format!("select {select} from {from}"),
    }
}

/// One aggregate over the user's whole listening log.
fn events(
    name: &'static str,
    description: &'static str,
    unit: MetricUnit,
    aggregate: &str,
) -> DataCount {
    DataCount {
        name,
        section: DataSection::Listening,
        description,
        unit,
        sql: format!("select {aggregate} from listening_events where user_id = $1"),
    }
}

/// Every count, in the order the screen shows them. Listening includes every
/// analytics [`Metric`] over all time, so the two never disagree.
pub fn user_data_counts() -> Vec<DataCount> {
    use DataSection::*;

    let mut counts = vec![
        rows(
            "songs",
            Library,
            "Songs in your library",
            "count(*)",
            "user_songs where user_id = $1",
        ),
        rows(
            "tags",
            Tags,
            "Tags you made",
            "count(*)",
            "tags where user_id = $1",
        ),
        rows(
            "tag_applications",
            Tags,
            "Tags on songs",
            "count(*)",
            "user_tags_applied where user_id = $1",
        ),
        rows(
            "tagged_songs",
            Tags,
            "Songs with a tag",
            "count(distinct song_id)",
            "user_tags_applied where user_id = $1",
        ),
        rows(
            "removed_suggestions",
            Tags,
            "Suggested tags you removed",
            "count(*)",
            "default_tags_removed where user_id = $1",
        ),
        events(
            "events",
            "Logged listening events",
            MetricUnit::Count,
            "count(*)",
        ),
    ];
    counts.extend(Metric::ALL.iter().map(|metric| {
        events(
            metric.name,
            metric.description,
            metric.unit,
            metric.aggregate,
        )
    }));
    counts.extend([
        events(
            "queries_played",
            "Queries played from",
            MetricUnit::Count,
            "count(distinct payload->>'source_id') filter (where payload->>'source_kind' = 'query')",
        ),
        events(
            "playlists_played",
            "Playlists played from",
            MetricUnit::Count,
            "count(distinct payload->>'source_id') filter (where payload->>'source_kind' = 'playlist')",
        ),
        rows("posts", Social, "Posts", "count(*)", "posts where user_id = $1"),
        rows("comments", Social, "Comments", "count(*)", "comments where user_id = $1"),
        rows("post_likes", Social, "Posts you liked", "count(*)", "post_likes where user_id = $1"),
        rows("comment_likes", Social, "Comments you liked", "count(*)", "comment_likes where user_id = $1"),
        rows("posts_seen", Social, "Posts you have seen", "count(*)", "post_view_status where user_id = $1"),
        rows("interests", Social, "Topic interest scores", "count(*)", "interest_scores where user_id = $1"),
    ]);
    counts
}

/// Runs every count in [`user_data_counts`] for `user_id` in one statement.
/// Returns each count beside its value, in registry order.
pub async fn get_user_data(
    db: &impl ConnectionTrait,
    user_id: Uuid,
) -> Result<Vec<(DataCount, i64)>, CadenzaError> {
    let counts = user_data_counts();
    let columns: Vec<String> = counts
        .iter()
        .map(|count| format!("({})::bigint", count.sql))
        .collect();
    let sql = format!("select {}", columns.join(", "));
    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            [user_id.into()],
        ))
        .await?
        .ok_or_else(|| CadenzaError::DatabaseError("user data returned no row".to_owned()))?;

    counts
        .into_iter()
        .enumerate()
        .map(|(index, count)| Ok((count, row.try_get_by_index(index)?)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_count_reads_only_this_users_rows() {
        for count in user_data_counts() {
            assert!(
                count.sql.contains("$1"),
                "{} is not scoped to the user",
                count.name
            );
        }
    }

    #[test]
    fn count_names_are_unique() {
        let mut names: Vec<&str> = user_data_counts().iter().map(|c| c.name).collect();
        let before = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), before);
    }
}
