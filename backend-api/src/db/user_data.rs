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
    /// Now playing, shared playlists, live sessions, and invite codes.
    SocialListening,
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
            "saved_queries",
            Library,
            "Saved queries",
            "count(*)",
            "saved_queries where user_id = $1",
        ),
        rows(
            "shared_queries",
            Library,
            "Saved queries on your profile",
            "count(*)",
            "saved_queries where user_id = $1 and shared",
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
        events(
            "shared_playlists_played",
            "Shared playlists played from",
            MetricUnit::Count,
            "count(distinct payload->>'source_id') filter (where payload->>'source_kind' = 'shared_playlist')",
        ),
        events(
            "live_sessions_played",
            "Live sessions played in",
            MetricUnit::Count,
            "count(distinct payload->>'source_id') filter (where payload->>'source_kind' = 'live_session')",
        ),
        rows(
            "notifications",
            Social,
            "Notifications",
            "count(*)",
            "notifications where user_id = $1",
        ),
        rows("posts", Social, "Posts", "count(*)", "posts where user_id = $1"),
        rows("comments", Social, "Comments", "count(*)", "comments where user_id = $1"),
        rows("post_likes", Social, "Posts you liked", "count(*)", "post_likes where user_id = $1"),
        rows("comment_likes", Social, "Comments you liked", "count(*)", "comment_likes where user_id = $1"),
        rows("posts_seen", Social, "Posts you have seen", "count(*)", "post_view_status where user_id = $1"),
        rows("interests", Social, "Topic interest scores", "count(*)", "interest_scores where user_id = $1"),
        rows(
            "friends",
            Social,
            "Friends",
            "count(*)",
            "friendships where $1 in (user1, user2) and status = 'complete'",
        ),
        rows(
            "friend_requests",
            Social,
            "Open friend requests",
            "count(*)",
            "friendships where $1 in (user1, user2) and status <> 'complete'",
        ),
        rows(
            "favorite_friends",
            Social,
            "Favorite friends",
            "count(*)",
            "friend_favorites where user_id = $1",
        ),
        rows(
            "blocked_users",
            Social,
            "People you blocked",
            "count(*)",
            "user_blocks where blocker_id = $1",
        ),
        rows(
            "now_playing",
            SocialListening,
            "Now playing rows",
            "count(*)",
            "now_playing where user_id = $1",
        ),
        rows(
            "shared_playlists_owned",
            SocialListening,
            "Shared playlists you own",
            "count(*)",
            "shared_playlists where owner_id = $1",
        ),
        rows(
            "shared_playlists_joined",
            SocialListening,
            "Shared playlists you are in",
            "count(*)",
            "shared_playlist_members where user_id = $1",
        ),
        rows(
            "shared_playlist_songs",
            SocialListening,
            "Songs you added to shared playlists",
            "count(*)",
            "shared_playlist_songs where added_by = $1",
        ),
        rows(
            "live_sessions_hosted",
            SocialListening,
            "Live sessions you host or hosted",
            "count(*)",
            "live_sessions where host_id = $1",
        ),
        rows(
            "live_sessions_joined",
            SocialListening,
            "Live sessions you joined",
            "count(*)",
            "live_session_members m join live_sessions s using (session_id) \
             where m.user_id = $1 and s.host_id <> $1",
        ),
        rows(
            "live_session_songs",
            SocialListening,
            "Songs you added to live sessions",
            "count(*)",
            "live_session_queue where added_by = $1",
        ),
        rows(
            "live_session_suggestions",
            SocialListening,
            "Live session suggestions waiting or turned down",
            "count(*)",
            "live_session_queue where added_by = $1 and status in ('suggested', 'rejected')",
        ),
        rows(
            "live_session_join_requests",
            SocialListening,
            "Times you asked to join a live session",
            "count(*)",
            "live_session_join_requests where user_id = $1",
        ),
        rows(
            "invite_codes",
            SocialListening,
            "Invite codes you made",
            "count(*)",
            "invite_codes where created_by = $1",
        ),
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

    /// Runs every count against the real schema, so a renamed column fails
    /// here and not on the Your data screen.
    #[tokio::test]
    #[ignore]
    async fn every_count_runs_against_the_database() {
        use sea_orm::{Database, TransactionTrait};
        dotenvy::dotenv().ok();
        let db = Database::connect(std::env::var("DATABASE_URL").expect("DATABASE_URL"))
            .await
            .expect("connect");
        let txn = db.begin().await.unwrap();
        let counts = get_user_data(&txn, Uuid::nil()).await.unwrap();
        assert_eq!(counts.len(), user_data_counts().len());
        assert!(counts.iter().all(|(_, value)| *value == 0));
        txn.rollback().await.unwrap();
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
