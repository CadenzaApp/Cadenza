use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sea_orm::prelude::Uuid;
use serde::Serialize;

use crate::db::comment_votes::{CommentVote, VoteTally};
use crate::db::entity::*;

#[derive(Serialize)]
pub struct Comment {
    id: i64,
    content: String,
    created_at: DateTime<Utc>,
    /// whether the user reading the comment is the one who left it
    mine: bool,
    /// up votes minus down votes
    votes: i64,
    /// the reading user's vote on the comment, or null
    my_vote: Option<CommentVote>,
}

impl Comment {
    /// Converts a comment and its votes for the user reading it. `user_id` is
    /// dropped for `mine`, so a response never says who left anyone else's
    /// comment.
    pub fn new(model: comment::Model, tally: VoteTally, reader_id: Uuid) -> Self {
        Self {
            id: model.id,
            // the column has no time zone, but sqlx sessions run in UTC, so the
            // now() default wrote it in UTC
            created_at: model.created_at.and_utc(),
            mine: model.user_id == reader_id,
            content: model.content,
            votes: tally.votes,
            my_vote: tally.my_vote,
        }
    }
}

/// A top level comment with its replies. Serializes as the comment's own fields
/// plus `replies`.
#[derive(Serialize)]
pub struct CommentThread {
    #[serde(flatten)]
    comment: Comment,
    replies: Vec<Comment>,
}

impl CommentThread {
    /// Converts a top level comment and its replies for the user reading them.
    /// `tallies` holds the votes on each comment that has any, keyed by comment
    /// id, and a comment missing from it has no votes.
    pub fn new(
        top_level: comment::Model,
        replies: Vec<comment::Model>,
        tallies: &HashMap<i64, VoteTally>,
        reader_id: Uuid,
    ) -> Self {
        let convert = |model: comment::Model| {
            let tally = tallies.get(&model.id).copied().unwrap_or_default();
            Comment::new(model, tally, reader_id)
        };

        Self {
            comment: convert(top_level),
            replies: replies.into_iter().map(convert).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;
    use serde_json::json;

    use super::*;

    #[test]
    fn thread_serializes_replies_and_votes_beside_the_comment_fields() {
        let reader_id = Uuid::new_v4();
        let created_at = NaiveDate::from_ymd_opt(2026, 9, 15)
            .unwrap()
            .and_hms_micro_opt(18, 3, 11, 482_913)
            .unwrap();
        let top_level = comment::Model {
            id: 41,
            created_at,
            parent: None,
            content: "the bridge at 2:10".to_owned(),
            song_id: Some("1440857781".to_owned()),
            user_id: Uuid::new_v4(),
        };
        let reply = comment::Model {
            id: 42,
            parent: Some(41),
            content: "agreed".to_owned(),
            user_id: reader_id,
            ..top_level.clone()
        };

        // only the reply has votes, one of them the reader's
        let tallies = HashMap::from([(
            42,
            VoteTally {
                votes: -2,
                my_vote: Some(CommentVote::Down),
            },
        )]);

        let thread = CommentThread::new(top_level, vec![reply], &tallies, reader_id);

        // created_at is labeled UTC, only the reader's own reply is mine, and a
        // comment with no tally has no votes
        assert_eq!(
            serde_json::to_value(thread).unwrap(),
            json!({
                "id": 41,
                "content": "the bridge at 2:10",
                "created_at": "2026-09-15T18:03:11.482913Z",
                "mine": false,
                "votes": 0,
                "my_vote": null,
                "replies": [
                    {
                        "id": 42,
                        "content": "agreed",
                        "created_at": "2026-09-15T18:03:11.482913Z",
                        "mine": true,
                        "votes": -2,
                        "my_vote": "down"
                    }
                ]
            })
        );
    }
}
