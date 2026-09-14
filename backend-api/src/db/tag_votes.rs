use std::{
    num::NonZeroUsize,
    sync::{Arc, Mutex, PoisonError},
};

use lru::LruCache;
use sea_orm::{
    ActiveValue::Set,
    ConnectionTrait, EntityTrait, Insert, ModelTrait,
    prelude::Uuid,
    sea_query::{Expr, ExprTrait, OnConflict},
};

use crate::db::entity::{default_tag_votes, tags};
use crate::db::tags::add_default_tag_to_song;
use crate::err::CadenzaError;

/// The most votes [`TagVoteCache`] remembers.
const MAX_CACHED_VOTES: NonZeroUsize = NonZeroUsize::new(4000).unwrap();

/// The fewest votes, yes and no together, a tag name needs on a song before it
/// can become one of the song's default tags.
const MIN_VOTES_TO_PROMOTE: i32 = 10;

/// Which count in `default_tag_votes` a vote goes to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TagVote {
    /// A user put the tag on the song.
    Yes,
    /// A user took the tag off the song.
    No,
}

impl TagVote {
    /// Returns the `default_tag_votes` column this vote counts toward.
    fn column(self) -> default_tag_votes::Column {
        match self {
            TagVote::Yes => default_tag_votes::Column::VotesYes,
            TagVote::No => default_tag_votes::Column::VotesNo,
        }
    }
}

/// Remembers the last vote each user cast on each tag name of a song, for the
/// [`MAX_CACHED_VOTES`] votes used most recently. Each user, song, and tag name
/// is its own entry. Lets [`record_tag_vote`] switch a user's vote instead of
/// counting it twice. It lives in memory, so a restart or an eviction forgets
/// votes, and the next vote on a forgotten one counts as new.
#[derive(Clone)]
pub struct TagVoteCache(Arc<Mutex<LruCache<(Uuid, String, String), TagVote>>>);

impl TagVoteCache {
    pub fn new() -> Self {
        TagVoteCache(Arc::new(Mutex::new(LruCache::new(MAX_CACHED_VOTES))))
    }

    /// Returns the user's cached vote on the tag name on the song, if there is
    /// one, and marks it as recently used.
    fn get(&self, user_id: Uuid, song_id: &str, tag_name: &str) -> Option<TagVote> {
        // a panic while holding the lock can't leave a half written vote, so a
        // poisoned cache is still fine to use
        let mut cache = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        cache
            .get(&(user_id, song_id.to_owned(), tag_name.to_owned()))
            .copied()
    }

    /// Updates the cache with a vote once its transaction commits. Remembers the
    /// vote, evicting the least recently used one when the cache is full. If the
    /// vote made its tag name a default tag on the song, the votes row it counted
    /// toward is gone, so this forgets every cached vote on that tag name and
    /// song instead.
    pub fn remember(&self, recorded: RecordedVote) {
        let mut cache = self.0.lock().unwrap_or_else(PoisonError::into_inner);

        if recorded.promoted {
            cache.retain(|(_, song_id, tag_name), _| {
                *song_id != recorded.song_id || *tag_name != recorded.tag_name
            });
        } else {
            cache.put(
                (recorded.user_id, recorded.song_id, recorded.tag_name),
                recorded.vote,
            );
        }
    }
}

/// A vote [`record_tag_vote`] wrote in a transaction that has not committed yet.
/// Hand it to [`TagVoteCache::remember`] once the transaction commits, so a
/// rolled back vote never reaches the cache.
#[must_use]
pub struct RecordedVote {
    user_id: Uuid,
    song_id: String,
    tag_name: String,
    vote: TagVote,
    /// Whether the vote made the tag name a default tag on the song, which
    /// deleted its votes row.
    promoted: bool,
}

/// Counts the user's vote on the tag's name on the song in `default_tag_votes`,
/// creating the row if there isn't one. Checks `votes` first: with no cached
/// vote this adds one to the vote's count, with the other vote cached it moves
/// one count over from that side, and with the same vote cached it changes
/// nothing.
///
/// If the new counts pass [`votes_promote_tag`], deletes the row and puts the
/// name on the song as a default tag with `tags::add_default_tag_to_song`. Users'
/// tags are left alone.
///
/// Returns the vote to hand to [`TagVoteCache::remember`] after the commit.
///
/// Only `tags::apply_user_tag` and `tags::unapply_user_tag` vote. Copying a
/// song's default tags to a user when it is initialized is not a vote.
pub async fn record_tag_vote(
    db: &impl ConnectionTrait,
    votes: &TagVoteCache,
    user_id: Uuid,
    song_id: &str,
    tag: &tags::Model,
    vote: TagVote,
) -> Result<RecordedVote, CadenzaError> {
    let mut recorded = RecordedVote {
        user_id,
        song_id: song_id.to_owned(),
        tag_name: tag.name.clone(),
        vote,
        promoted: false,
    };

    let previous = votes.get(user_id, song_id, &tag.name);

    // the user already cast this vote, so it is counted
    if previous == Some(vote) {
        return Ok(recorded);
    }

    let counts = vote_upsert(song_id, &tag.name, vote, previous)
        .exec_with_returning(db)
        .await?;

    // enough users agree on the name, so it becomes one of the song's default
    // tags, and its votes start over
    if votes_promote_tag(counts.votes_yes, counts.votes_no) {
        counts.delete(db).await?;
        add_default_tag_to_song(db, song_id, &tag.name, &tag.color).await?;
        recorded.promoted = true;
    }

    Ok(recorded)
}

/// Returns whether a tag name's votes on a song make it one of the song's
/// default tags: at least [`MIN_VOTES_TO_PROMOTE`] votes, and more than 1.5
/// times as many yes votes as no votes.
fn votes_promote_tag(votes_yes: i32, votes_no: i32) -> bool {
    let (votes_yes, votes_no) = (i64::from(votes_yes), i64::from(votes_no));

    // yes > 1.5 * no, kept in integers
    votes_yes + votes_no >= i64::from(MIN_VOTES_TO_PROMOTE) && 2 * votes_yes > 3 * votes_no
}

/// Returns the upsert that counts `vote`. `switched_from` is the user's earlier,
/// different vote on the same tag name and song, which gives up one count.
fn vote_upsert(
    song_id: &str,
    tag_name: &str,
    vote: TagVote,
    switched_from: Option<TagVote>,
) -> Insert<default_tag_votes::ActiveModel> {
    let (votes_yes, votes_no) = match vote {
        TagVote::Yes => (1, 0),
        TagVote::No => (0, 1),
    };

    let row = default_tag_votes::ActiveModel {
        song_id: Set(song_id.to_owned()),
        tag_name: Set(tag_name.to_owned()),
        votes_yes: Set(votes_yes),
        votes_no: Set(votes_no),
    };

    // qualified, since postgres finds a bare column name ambiguous in DO UPDATE
    let count = |vote: TagVote| Expr::col((default_tag_votes::Entity, vote.column()));

    // on an existing row, add one to this vote's count, and take one off the vote
    // the user is switching from
    let mut on_conflict = OnConflict::columns([
        default_tag_votes::Column::SongId,
        default_tag_votes::Column::TagName,
    ]);
    on_conflict.value(vote.column(), count(vote).add(1));
    if let Some(switched_from) = switched_from {
        on_conflict.value(switched_from.column(), count(switched_from).sub(1));
    }

    default_tag_votes::Entity::insert(row).on_conflict(on_conflict)
}

#[cfg(test)]
mod tests {
    use sea_orm::{DbBackend, QueryTrait};

    use super::*;

    /// A committed vote that did not promote its tag name.
    fn recorded(user_id: Uuid, song_id: &str, tag_name: &str, vote: TagVote) -> RecordedVote {
        RecordedVote {
            user_id,
            song_id: song_id.to_owned(),
            tag_name: tag_name.to_owned(),
            vote,
            promoted: false,
        }
    }

    #[test]
    fn cache_keeps_votes_per_user_song_and_tag_name() {
        let votes = TagVoteCache::new();
        let user_id = Uuid::new_v4();

        votes.remember(recorded(user_id, "song", "rock", TagVote::Yes));
        votes.remember(recorded(user_id, "song", "jazz", TagVote::No));

        // each tag name on the song keeps its own vote
        assert_eq!(votes.get(user_id, "song", "rock"), Some(TagVote::Yes));
        assert_eq!(votes.get(user_id, "song", "jazz"), Some(TagVote::No));

        // nothing is cached for another tag name, song, or user
        assert_eq!(votes.get(user_id, "song", "pop"), None);
        assert_eq!(votes.get(user_id, "other song", "rock"), None);
        assert_eq!(votes.get(Uuid::new_v4(), "song", "rock"), None);
    }

    #[test]
    fn cache_replaces_a_changed_vote() {
        let votes = TagVoteCache::new();
        let user_id = Uuid::new_v4();

        votes.remember(recorded(user_id, "song", "rock", TagVote::Yes));
        votes.remember(recorded(user_id, "song", "rock", TagVote::No));

        assert_eq!(votes.get(user_id, "song", "rock"), Some(TagVote::No));
    }

    #[test]
    fn cache_evicts_the_least_recently_used_vote_when_full() {
        let votes = TagVoteCache::new();
        let user_id = Uuid::new_v4();

        // fill the cache with one vote per song
        for i in 0..MAX_CACHED_VOTES.get() {
            votes.remember(recorded(user_id, &i.to_string(), "rock", TagVote::Yes));
        }

        // reading song 0's vote makes song 1's the least recently used
        assert_eq!(votes.get(user_id, "0", "rock"), Some(TagVote::Yes));

        // a second tag name on song 0 is a vote of its own, so it takes a slot and
        // evicts song 1's vote, and only that one
        votes.remember(recorded(user_id, "0", "jazz", TagVote::Yes));

        assert_eq!(votes.get(user_id, "1", "rock"), None);
        assert_eq!(votes.get(user_id, "2", "rock"), Some(TagVote::Yes));
        assert_eq!(votes.get(user_id, "0", "rock"), Some(TagVote::Yes));
        assert_eq!(votes.get(user_id, "0", "jazz"), Some(TagVote::Yes));
    }

    #[test]
    fn cache_forgets_every_vote_on_a_promoted_tag_name_and_song() {
        let votes = TagVoteCache::new();
        let (user_1, user_2) = (Uuid::new_v4(), Uuid::new_v4());

        votes.remember(recorded(user_1, "song", "rock", TagVote::Yes));
        votes.remember(recorded(user_1, "song", "jazz", TagVote::Yes));
        votes.remember(recorded(user_1, "other song", "rock", TagVote::Yes));

        // user 2's vote makes rock a default tag on the song
        votes.remember(RecordedVote {
            promoted: true,
            ..recorded(user_2, "song", "rock", TagVote::Yes)
        });

        // no vote on rock for that song is cached, including the promoting one
        assert_eq!(votes.get(user_1, "song", "rock"), None);
        assert_eq!(votes.get(user_2, "song", "rock"), None);

        // votes on another tag name or song stay
        assert_eq!(votes.get(user_1, "song", "jazz"), Some(TagVote::Yes));
        assert_eq!(votes.get(user_1, "other song", "rock"), Some(TagVote::Yes));
    }

    #[test]
    fn votes_promote_tag_needs_ten_votes_and_over_one_and_a_half_times_as_many_yes() {
        // too few votes, however many are yes
        assert!(!votes_promote_tag(9, 0));

        // enough votes, with yes over 1.5 times no
        assert!(votes_promote_tag(10, 0));
        assert!(votes_promote_tag(9, 1));
        assert!(votes_promote_tag(7, 4));

        // exactly 1.5 times is not more than it
        assert!(!votes_promote_tag(6, 4));
        assert!(!votes_promote_tag(3, 7));
    }

    #[test]
    fn vote_upsert_adds_a_new_vote() {
        let sql = vote_upsert("song", "rock", TagVote::Yes, None)
            .build(DbBackend::Postgres)
            .to_string();

        assert_eq!(
            sql,
            r#"INSERT INTO "default_tag_votes" ("song_id", "tag_name", "votes_yes", "votes_no") VALUES ('song', 'rock', 1, 0) ON CONFLICT ("song_id", "tag_name") DO UPDATE SET "votes_yes" = "default_tag_votes"."votes_yes" + 1"#
        );
    }

    #[test]
    fn vote_upsert_switches_a_cached_vote() {
        let sql = vote_upsert("song", "rock", TagVote::No, Some(TagVote::Yes))
            .build(DbBackend::Postgres)
            .to_string();

        assert_eq!(
            sql,
            r#"INSERT INTO "default_tag_votes" ("song_id", "tag_name", "votes_yes", "votes_no") VALUES ('song', 'rock', 0, 1) ON CONFLICT ("song_id", "tag_name") DO UPDATE SET "votes_no" = "default_tag_votes"."votes_no" + 1, "votes_yes" = "default_tag_votes"."votes_yes" - 1"#
        );
    }
}
