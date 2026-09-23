use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sea_orm::{DatabaseConnection, TransactionTrait, prelude::Uuid};
use tokio::time::{MissedTickBehavior, interval};

use crate::db::tag_scores::{get_max_score, get_users_due_for_decay, halve_user_tag_scores};
use crate::db::tag_scores_metadata::{
    insert_decay_week_if_missing, lock_decay_week, set_decay_week,
};
use crate::err::CadenzaError;

/// Prefix on every line the decay job logs, so one job's output greps out of the
/// rest of the server's.
const LOG_TAG: &str = "[tag-score-decay]";

/// How often the job wakes up and asks whether this week's halving has happened.
/// Shorter than a week on purpose: all the job has to notice is that the week
/// turned over, so a server started at any point in the week catches up within a
/// day rather than waiting out a full week of uptime.
const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

const SECS_PER_WEEK: u64 = 7 * 24 * 60 * 60;

/// A user whose highest score is below this is skipped, so a user who has gone
/// quiet keeps the order of their scores instead of halving them all down to 0.
const MIN_MAX_SCORE_TO_HALVE: i64 = 5;

/// What one pass did across every user it looked at, so the caller can log it.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DecayPass {
    pub week: i32,
    /// Users whose scores were halved.
    pub halved: u64,
    /// Users left alone because their highest score was below
    /// [`MIN_MAX_SCORE_TO_HALVE`]. Their week still moved on.
    pub below_threshold: u64,
    /// Users seen for the first time. Their week was recorded and their scores
    /// left alone.
    pub started: u64,
    /// Users another server was already decaying, or had decayed by the time
    /// this one got to them.
    pub elsewhere: u64,
    /// Score rows moved, across every halved user.
    pub scores: u64,
}

impl DecayPass {
    /// How many users the pass decided something about.
    fn users(&self) -> u64 {
        self.halved + self.below_threshold + self.started + self.elsewhere
    }
}

/// What one user's transaction did.
#[derive(Debug, PartialEq, Eq)]
enum UserDecay {
    Halved { scores: u64 },
    BelowThreshold,
    Started,
    Elsewhere,
}

/// The week `now` falls in, counted from the unix epoch, so week 0 is the week
/// of 1 Jan 1970.
///
/// A clock reading before the epoch counts as week 0, which can only leave the
/// job idle rather than halving twice. An `i32` because that is what the
/// column holds. It runs out about 41 million years from now.
fn week_since_epoch(now: SystemTime) -> i32 {
    let weeks = now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() / SECS_PER_WEEK;
    i32::try_from(weeks).unwrap_or(i32::MAX)
}

/// Whether a user whose last decay week is `last_week` is due in week
/// `current_week`.
///
/// A stored week ahead of the clock counts as done rather than being rewound,
/// so a machine whose clock is behind cannot halve a second time for a week
/// another already covered.
fn is_due(last_week: i32, current_week: i32) -> bool {
    last_week < current_week
}

/// Whether a user whose highest score is `max_score` gets halved. A user with
/// no scores at all is not.
fn should_halve(max_score: Option<i64>) -> bool {
    max_score.is_some_and(|max| max >= MIN_MAX_SCORE_TO_HALVE)
}

/// Decays one user in a transaction of its own.
///
/// A user with no decay week gets this week recorded and nothing halved, since
/// the job has no idea when their scores last decayed. They halve for the
/// first time next week.
///
/// Otherwise their decay week row is locked, skipping rather than waiting if
/// another server holds it. A due user whose highest score reaches
/// [`MIN_MAX_SCORE_TO_HALVE`] is halved. Either way their week moves on to this
/// one in the same commit, so a crash leaves the user either fully done or
/// untouched, never halved without the week to show for it.
async fn decay_user(
    db: &DatabaseConnection,
    user_id: Uuid,
    week: i32,
) -> Result<UserDecay, CadenzaError> {
    let txn = db.begin().await?;

    let decay = if insert_decay_week_if_missing(&txn, user_id, week).await? {
        UserDecay::Started
    } else {
        match lock_decay_week(&txn, user_id).await? {
            Some(last_week) if is_due(last_week, week) => {
                let decay = if should_halve(get_max_score(&txn, user_id).await?) {
                    UserDecay::Halved {
                        scores: halve_user_tag_scores(&txn, user_id).await?,
                    }
                } else {
                    UserDecay::BelowThreshold
                };
                set_decay_week(&txn, user_id, week).await?;
                decay
            }
            // done since this pass listed them, or locked by another server
            _ => UserDecay::Elsewhere,
        }
    };

    txn.commit().await?;
    Ok(decay)
}

/// Decays every user whose last decay week is before this one, each in its own
/// transaction.
///
/// A user whose transaction fails is logged and left for the next pass, and
/// the rest carry on. Every user's week records what happened to them, so a
/// gap of several weeks still halves once, and a pass that dies partway
/// resumes at the users it had not reached rather than halving anyone twice.
///
/// `Err` only when the list of due users cannot be read.
pub async fn decay_due_users(
    db: &DatabaseConnection,
    now: SystemTime,
) -> Result<DecayPass, CadenzaError> {
    let week = week_since_epoch(now);
    let mut pass = DecayPass {
        week,
        ..Default::default()
    };

    for user_id in get_users_due_for_decay(db, week).await? {
        match decay_user(db, user_id, week).await {
            Ok(UserDecay::Halved { scores }) => {
                pass.halved += 1;
                pass.scores += scores;
            }
            Ok(UserDecay::BelowThreshold) => pass.below_threshold += 1,
            Ok(UserDecay::Started) => pass.started += 1,
            Ok(UserDecay::Elsewhere) => pass.elsewhere += 1,
            Err(err) => eprintln!("{LOG_TAG} user {user_id} failed: {err}"),
        }
    }

    Ok(pass)
}

/// Runs [`decay_due_users`] once at startup and then every [`CHECK_INTERVAL`],
/// for as long as the server lives.
///
/// The interval only decides how often the job looks. What makes the halving
/// weekly is each user's week in `tag_scores_metadata`, so extra passes inside
/// one week find nobody due and a restart does not halve again.
///
/// A pass that cannot list its users is logged and the job carries on. Users
/// whose transactions failed kept their old week, so the next pass tries them
/// again.
///
/// Ticks are delayed rather than burst, so a pass that outruns the interval is
/// followed by a full interval of quiet instead of another pass immediately.
pub fn spawn_tag_score_decay(db: DatabaseConnection) {
    tokio::spawn(async move {
        let mut ticker = interval(CHECK_INTERVAL);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

        loop {
            ticker.tick().await;

            match decay_due_users(&db, SystemTime::now()).await {
                // nobody was due, which is most passes
                Ok(pass) if pass.users() == 0 => {}

                Ok(DecayPass {
                    week,
                    halved,
                    below_threshold,
                    started,
                    elsewhere,
                    scores,
                }) => println!(
                    "{LOG_TAG} week {week}: halved {scores} tag scores across {halved} users. \
                     {below_threshold} below {MIN_MAX_SCORE_TO_HALVE}, {started} new, \
                     {elsewhere} handled elsewhere"
                ),

                Err(err) => eprintln!("{LOG_TAG} pass failed: {err}"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A clock reading `secs` after the unix epoch.
    fn at(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    #[test]
    fn week_zero_is_the_week_of_the_epoch() {
        assert_eq!(week_since_epoch(at(0)), 0);
        assert_eq!(week_since_epoch(at(SECS_PER_WEEK - 1)), 0);
        assert_eq!(week_since_epoch(at(SECS_PER_WEEK)), 1);
    }

    #[test]
    fn a_clock_before_the_epoch_reads_as_week_zero() {
        assert_eq!(week_since_epoch(UNIX_EPOCH - Duration::from_secs(1)), 0);
    }

    #[test]
    fn a_user_whose_week_has_turned_over_is_due() {
        assert!(is_due(9, 10));
        // a long gap is still one halving, since the week jumps straight to now
        assert!(is_due(0, 10));
    }

    #[test]
    fn a_user_decayed_this_week_or_later_is_not_due() {
        assert!(!is_due(10, 10));
        // a week ahead of the clock is left alone rather than rewound
        assert!(!is_due(11, 10));
    }

    #[test]
    fn a_user_is_halved_only_once_their_highest_score_reaches_the_threshold() {
        assert!(!should_halve(Some(MIN_MAX_SCORE_TO_HALVE - 1)));
        assert!(should_halve(Some(MIN_MAX_SCORE_TO_HALVE)));
        assert!(should_halve(Some(1000)));
        // all negative, so the highest is still below the threshold
        assert!(!should_halve(Some(-20)));
        // their scores went away since the pass listed them
        assert!(!should_halve(None));
    }
}
