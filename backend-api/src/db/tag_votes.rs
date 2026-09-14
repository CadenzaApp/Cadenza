use std::{
    num::NonZeroUsize,
    sync::{Arc, Mutex, PoisonError},
};

use lru::LruCache;
use sea_orm::{
    ActiveValue::Set,
    ConnectionTrait, EntityTrait, Insert,
    prelude::Uuid,
    sea_query::{Expr, ExprTrait, OnConflict},
};

use crate::db::entity::default_tag_votes;
use crate::err::CadenzaError;

/// The most votes [`TagVoteCache`] remembers.
const MAX_CACHED_VOTES: NonZeroUsize = NonZeroUsize::new(4000).unwrap();

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

    /// Remembers the user's vote on the tag name on the song. Call it once the
    /// vote's transaction commits, so a rolled back vote is never cached. Evicts
    /// the least recently used vote when the cache is full.
    pub fn remember(&self, user_id: Uuid, song_id: String, tag_name: String, vote: TagVote) {
        let mut cache = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        cache.put((user_id, song_id, tag_name), vote);
    }
}

/// Counts the user's vote on the tag name on the song in `default_tag_votes`,
/// creating the row if there isn't one. Checks `votes` first: with no cached
/// vote this adds one to the vote's count, with the other vote cached it moves
/// one count over from that side, and with the same vote cached it changes
/// nothing. Does not update `votes`, see [`TagVoteCache::remember`].
///
/// Only `tags::apply_user_tag` and `tags::unapply_user_tag` vote. Copying a
/// song's default tags to a user when it is initialized is not a vote.
pub async fn record_tag_vote(
    db: &impl ConnectionTrait,
    votes: &TagVoteCache,
    user_id: Uuid,
    song_id: &str,
    tag_name: &str,
    vote: TagVote,
) -> Result<(), CadenzaError> {
    let previous = votes.get(user_id, song_id, tag_name);

    // the user already cast this vote, so it is counted
    if previous == Some(vote) {
        return Ok(());
    }

    vote_upsert(song_id, tag_name, vote, previous)
        .exec_without_returning(db)
        .await?;

    Ok(())
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

    #[test]
    fn cache_keeps_votes_per_user_song_and_tag_name() {
        let votes = TagVoteCache::new();
        let user_id = Uuid::new_v4();

        votes.remember(user_id, "song".into(), "rock".into(), TagVote::Yes);
        votes.remember(user_id, "song".into(), "jazz".into(), TagVote::No);

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

        votes.remember(user_id, "song".into(), "rock".into(), TagVote::Yes);
        votes.remember(user_id, "song".into(), "rock".into(), TagVote::No);

        assert_eq!(votes.get(user_id, "song", "rock"), Some(TagVote::No));
    }

    #[test]
    fn cache_evicts_the_least_recently_used_vote_when_full() {
        let votes = TagVoteCache::new();
        let user_id = Uuid::new_v4();

        // fill the cache with one vote per song
        for i in 0..MAX_CACHED_VOTES.get() {
            votes.remember(user_id, i.to_string(), "rock".into(), TagVote::Yes);
        }

        // reading song 0's vote makes song 1's the least recently used
        assert_eq!(votes.get(user_id, "0", "rock"), Some(TagVote::Yes));

        // a second tag name on song 0 is a vote of its own, so it takes a slot and
        // evicts song 1's vote, and only that one
        votes.remember(user_id, "0".into(), "jazz".into(), TagVote::Yes);

        assert_eq!(votes.get(user_id, "1", "rock"), None);
        assert_eq!(votes.get(user_id, "2", "rock"), Some(TagVote::Yes));
        assert_eq!(votes.get(user_id, "0", "rock"), Some(TagVote::Yes));
        assert_eq!(votes.get(user_id, "0", "jazz"), Some(TagVote::Yes));
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
