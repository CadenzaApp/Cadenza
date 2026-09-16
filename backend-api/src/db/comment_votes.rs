use std::collections::HashMap;

use sea_orm::{
    ActiveValue::Set,
    ColumnTrait, DatabaseConnection, EntityTrait, FromQueryResult, Insert, QueryFilter,
    QuerySelect, Select,
    prelude::Uuid,
    sea_query::{Expr, Func, OnConflict},
};
use serde::{Deserialize, Serialize};

use crate::db::entity::{comment, comment_votes};
use crate::err::CadenzaError;

/// Which way a user voted on a comment. `"up"` or `"down"` in JSON.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommentVote {
    Up,
    Down,
}

/// The votes on one comment, as the user reading it sees them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct VoteTally {
    /// Up votes minus down votes.
    pub votes: i64,
    /// The reading user's own vote, if they cast one.
    pub my_vote: Option<CommentVote>,
}

/// Sets the user's vote on a comment, switching the vote they already cast, or
/// takes their vote back when `vote` is `None`. Taking back a vote that was
/// never cast does nothing. An up or down vote on a comment that doesn't exist
/// is `NotFound`, through the foreign key mapping in `err.rs`.
pub async fn set_comment_vote(
    db: &DatabaseConnection,
    user_id: Uuid,
    comment_id: i64,
    vote: Option<CommentVote>,
) -> Result<(), CadenzaError> {
    match vote {
        Some(vote) => {
            vote_upsert(user_id, comment_id, vote)
                .exec_without_returning(db)
                .await?;
        }
        None => {
            comment_votes::Entity::delete_many()
                .filter(comment_votes::Column::UserId.eq(user_id))
                .filter(comment_votes::Column::CommentId.eq(comment_id))
                .exec(db)
                .await?;
        }
    }

    Ok(())
}

/// Returns the upsert that stores `vote`, replacing the user's earlier vote on
/// the comment if they cast one.
fn vote_upsert(
    user_id: Uuid,
    comment_id: i64,
    vote: CommentVote,
) -> Insert<comment_votes::ActiveModel> {
    let row = comment_votes::ActiveModel {
        user_id: Set(user_id),
        comment_id: Set(comment_id),
        is_upvote: Set(vote == CommentVote::Up),
    };

    comment_votes::Entity::insert(row).on_conflict(
        OnConflict::columns([
            comment_votes::Column::UserId,
            comment_votes::Column::CommentId,
        ])
        .update_column(comment_votes::Column::IsUpvote)
        .to_owned(),
    )
}

/// One row of [`tally_query`].
#[derive(FromQueryResult)]
struct TallyRow {
    comment_id: i64,
    votes: i64,
    /// 1 for an up vote, -1 for a down vote, null if the reader didn't vote
    my_vote: Option<i32>,
}

/// Returns the votes on each comment on the song that has any, keyed by comment
/// id, with `my_vote` taken from `reader_id`'s votes. Comments with no votes are
/// left out.
pub async fn get_song_vote_tallies(
    db: &DatabaseConnection,
    reader_id: Uuid,
    song_id: &str,
) -> Result<HashMap<i64, VoteTally>, CadenzaError> {
    let rows = tally_query(reader_id, song_id)
        .into_model::<TallyRow>()
        .all(db)
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let my_vote = row.my_vote.map(|value| match value {
                1.. => CommentVote::Up,
                _ => CommentVote::Down,
            });
            (row.comment_id, VoteTally { votes: row.votes, my_vote })
        })
        .collect())
}

/// Returns the query behind [`get_song_vote_tallies`]: one row per voted comment
/// on the song. Each up vote counts 1 and each down vote -1. `votes` sums them,
/// and `my_vote` is the reader's own, or null.
fn tally_query(reader_id: Uuid, song_id: &str) -> Select<comment_votes::Entity> {
    // 1 for an up vote, -1 for a down vote
    let value = || {
        Expr::case(
            Expr::col((comment_votes::Entity, comment_votes::Column::IsUpvote)),
            1,
        )
        .finally(-1)
    };

    // the reader's vote keeps its value, everyone else's is null, so the max is
    // the reader's vote or null
    let readers_value = Expr::case(comment_votes::Column::UserId.eq(reader_id), value());

    comment_votes::Entity::find()
        .select_only()
        .column(comment_votes::Column::CommentId)
        .column_as(Expr::from(Func::sum(value())), "votes")
        .column_as(Expr::from(Func::max(readers_value)), "my_vote")
        .inner_join(comment::Entity)
        .filter(comment::Column::SongId.eq(song_id))
        .group_by(comment_votes::Column::CommentId)
}

#[cfg(test)]
mod tests {
    use sea_orm::{DbBackend, QueryTrait};

    use super::*;

    #[test]
    fn comment_vote_is_up_or_down_in_json() {
        assert_eq!(serde_json::to_string(&CommentVote::Up).unwrap(), r#""up""#);
        assert_eq!(
            serde_json::from_str::<Option<CommentVote>>(r#""down""#).unwrap(),
            Some(CommentVote::Down)
        );

        // null takes a vote back
        assert_eq!(
            serde_json::from_str::<Option<CommentVote>>("null").unwrap(),
            None
        );
    }

    #[test]
    fn vote_upsert_replaces_an_earlier_vote() {
        let sql = vote_upsert(Uuid::nil(), 41, CommentVote::Down)
            .build(DbBackend::Postgres)
            .to_string();

        assert_eq!(
            sql,
            r#"INSERT INTO "comment_votes" ("user_id", "comment_id", "is_upvote") VALUES ('00000000-0000-0000-0000-000000000000', 41, FALSE) ON CONFLICT ("user_id", "comment_id") DO UPDATE SET "is_upvote" = "excluded"."is_upvote""#
        );
    }

    #[test]
    fn tally_query_sums_votes_and_picks_out_the_readers_vote() {
        let sql = tally_query(Uuid::nil(), "1440857781")
            .build(DbBackend::Postgres)
            .to_string();

        assert_eq!(
            sql,
            r#"SELECT "comment_votes"."comment_id", SUM((CASE WHEN ("comment_votes"."is_upvote") THEN 1 ELSE -1 END)) AS "votes", MAX((CASE WHEN ("comment_votes"."user_id" = '00000000-0000-0000-0000-000000000000') THEN (CASE WHEN ("comment_votes"."is_upvote") THEN 1 ELSE -1 END) END)) AS "my_vote" FROM "comment_votes" INNER JOIN "comment" ON "comment_votes"."comment_id" = "comment"."id" WHERE "comment"."song_id" = '1440857781' GROUP BY "comment_votes"."comment_id""#
        );
    }
}
