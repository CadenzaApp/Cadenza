//! Live session rules that need no database: who may do what, and where
//! playback is by now. The writes are `db/live_sessions.rs`.
//!
//! Playback is an anchor: the current entry, playing or not, and `position_ms`
//! at server time `position_at`. The host's device reports what it is really
//! on and the server re-anchors from that. Between reports, and while the
//! host's app is suspended in the background, readers project forward through
//! the queued entries' durations with [`project`].

use chrono::{DateTime, Duration, Utc};

/// A member's role. Each one can do everything the one before can: listener
/// sees the queue and now playing, suggester adds songs the host
/// approves, queue editor edits the queue directly, controller also plays,
/// pauses, skips, seeks, and jumps.
///
/// Repeat mode: off stops after the last song, all puts the played songs back
/// once the last one is current, one loops the current song.
pub use crate::db::entity::sea_orm_active_enums::{RepeatMode, SessionEntryStatus, SessionRole};

/// Who is asking: the host, or a member with a role.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Actor {
    Host,
    Member(SessionRole),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionAction {
    View,
    Suggest,
    EditQueue,
    Control,
    /// Approve or reject suggestions.
    Review,
    /// Kick, change roles and settings, make codes, end.
    Manage,
    /// The host's device reports what it is playing.
    Report,
}

/// The one table of who may do what.
pub fn allowed(actor: Actor, action: SessionAction) -> bool {
    match actor {
        Actor::Host => true,
        Actor::Member(role) => match action {
            SessionAction::View => true,
            SessionAction::Suggest => role != SessionRole::Listener,
            SessionAction::EditQueue => {
                matches!(role, SessionRole::QueueEditor | SessionRole::Controller)
            }
            SessionAction::Control => role == SessionRole::Controller,
            SessionAction::Review | SessionAction::Manage | SessionAction::Report => false,
        },
    }
}

/// What adding a song does for this actor: queue it, or suggest it.
pub fn add_lands_as(actor: Actor) -> Option<SessionEntryStatus> {
    if allowed(actor, SessionAction::EditQueue) {
        Some(SessionEntryStatus::Queued)
    } else if allowed(actor, SessionAction::Suggest) {
        Some(SessionEntryStatus::Suggested)
    } else {
        None
    }
}

/// A host alone in a session, with no report for this long, ends it.
pub const HOST_TIMEOUT: Duration = Duration::minutes(30);
/// Paused this long, a session ends.
pub const PAUSED_TIMEOUT: Duration = Duration::minutes(10);
/// Playing with the host's app gone this long, a session ends: the app was
/// closed. Long enough to ride out a reconnect.
pub const AWAY_TIMEOUT: Duration = Duration::minutes(1);

/// What decides whether a session has run its course.
#[derive(Clone, Copy, Debug)]
pub struct Liveness {
    pub is_playing: bool,
    /// The anchor's time: while paused, when it was paused.
    pub position_at: DateTime<Utc>,
    pub host_seen_at: DateTime<Utc>,
    /// When the host's app lost its realtime connection, if it has.
    pub host_away_since: Option<DateTime<Utc>>,
    /// The phone closed that connection, as when the app is swiped away,
    /// rather than it going quiet, as when a paused app is frozen.
    pub host_closed_app: bool,
    pub has_guests: bool,
}

/// Whether a session ends by itself at `now`: paused for 10 minutes, a minute
/// after the host closed the app, or a host alone in it gone quiet for 30.
/// A connection that only went quiet counts as closed while playing, since a
/// playing app is never frozen. `db::live_sessions::OPEN_SESSION_SQL` is the
/// same rule in SQL.
pub fn timed_out(session: Liveness, now: DateTime<Utc>) -> bool {
    let paused_too_long = !session.is_playing && now - session.position_at > PAUSED_TIMEOUT;
    let closed = (session.is_playing || session.host_closed_app)
        && session
            .host_away_since
            .is_some_and(|away| now - away > AWAY_TIMEOUT);
    let alone_and_quiet = !session.has_guests && now - session.host_seen_at > HOST_TIMEOUT;
    paused_too_long || closed || alone_and_quiet
}

/// Back past this far into a song restarts it instead of going to the one
/// before. Matches the app's own player.
pub const RESTART_THRESHOLD_MS: i64 = 4_000;

/// A host report this far off the projection is a seek or restart on the
/// phone, which everyone else follows. Matches the app's report threshold.
pub const REPORT_JUMP_MS: i64 = 3_000;

/// The anchor as stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Anchor {
    pub is_playing: bool,
    pub position_ms: i64,
    pub position_at: DateTime<Utc>,
}

/// Where playback is by `now`: how many entries past the current one, and the
/// position in that entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Projected {
    /// 0 is still the anchor's entry, 1 the next queued one, and so on.
    pub entries_ahead: usize,
    pub position_ms: i64,
    /// True when the projection ran off the end of the queue.
    pub finished: bool,
}

/// Walks the anchor forward to `now`. `durations` is the current entry's
/// duration, then each upcoming entry's, in order. An unknown duration stops
/// the walk in that entry, since there is no way to know when it ended.
///
/// `wrap` loops back to the first entry past the last one, for repeat. It
/// needs every duration; with one unknown the walk stops in it as usual.
pub fn project(
    anchor: Anchor,
    durations: &[Option<i64>],
    wrap: bool,
    now: DateTime<Utc>,
) -> Projected {
    let mut position = anchor.position_ms.max(0);
    if anchor.is_playing {
        position += (now - anchor.position_at).num_milliseconds().max(0);
    }
    let total: Option<i64> = durations.iter().copied().sum();
    if let Some(total) = total.filter(|total| wrap && *total > 0) {
        position %= total;
    }
    let mut index = 0;
    while let Some(Some(duration)) = durations.get(index) {
        if position < *duration {
            break;
        }
        position -= duration;
        index += 1;
    }
    if index >= durations.len() && !durations.is_empty() {
        return Projected {
            entries_ahead: durations.len() - 1,
            position_ms: durations.last().copied().flatten().unwrap_or(0),
            finished: true,
        };
    }
    Projected {
        entries_ahead: index,
        position_ms: position,
        finished: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anchor(is_playing: bool, position_ms: i64) -> (Anchor, DateTime<Utc>) {
        let at = Utc::now();
        (
            Anchor {
                is_playing,
                position_ms,
                position_at: at,
            },
            at,
        )
    }

    #[test]
    fn roles_build_on_each_other() {
        use SessionAction::*;
        use SessionRole::*;
        let member = Actor::Member;
        assert!(allowed(member(Listener), View));
        assert!(!allowed(member(Listener), Suggest));
        assert!(allowed(member(Suggester), Suggest));
        assert!(!allowed(member(Suggester), EditQueue));
        assert!(allowed(member(QueueEditor), EditQueue));
        assert!(!allowed(member(QueueEditor), Control));
        assert!(allowed(member(Controller), Control));
        for action in [Review, Manage, Report] {
            assert!(!allowed(member(Controller), action));
            assert!(allowed(Actor::Host, action));
        }
    }

    #[test]
    fn adds_queue_or_suggest_by_role() {
        assert_eq!(add_lands_as(Actor::Member(SessionRole::Listener)), None);
        assert_eq!(
            add_lands_as(Actor::Member(SessionRole::Suggester)),
            Some(SessionEntryStatus::Suggested)
        );
        assert_eq!(
            add_lands_as(Actor::Member(SessionRole::QueueEditor)),
            Some(SessionEntryStatus::Queued)
        );
        assert_eq!(add_lands_as(Actor::Host), Some(SessionEntryStatus::Queued));
    }

    #[test]
    fn projection_stays_in_the_current_song() {
        let (a, at) = anchor(true, 10_000);
        let p = project(a, &[Some(200_000)], false, at + Duration::seconds(5));
        assert_eq!(p.entries_ahead, 0);
        assert_eq!(p.position_ms, 15_000);
        assert!(!p.finished);
    }

    #[test]
    fn projection_walks_into_the_next_songs() {
        let (a, at) = anchor(true, 190_000);
        let p = project(
            a,
            &[Some(200_000), Some(100_000), Some(100_000)],
            false,
            at + Duration::seconds(130),
        );
        // 190 + 130 = 320: past the first (200), 120 into the second (100),
        // so 20 into the third
        assert_eq!(p.entries_ahead, 2);
        assert_eq!(p.position_ms, 20_000);
    }

    #[test]
    fn projection_wraps_on_repeat() {
        let (a, at) = anchor(true, 0);
        let p = project(
            a,
            &[Some(1_000), Some(2_000)],
            true,
            at + Duration::seconds(4),
        );
        // 4 s over a 3 s loop: 1 s in, the start of the second song
        assert_eq!(p.entries_ahead, 1);
        assert_eq!(p.position_ms, 0);
        assert!(!p.finished);

        let one = project(a, &[Some(1_000)], true, at + Duration::milliseconds(2_500));
        assert_eq!(one.entries_ahead, 0);
        assert_eq!(one.position_ms, 500);
    }

    #[test]
    fn projection_stops_at_an_unknown_length_and_at_the_end() {
        let (a, at) = anchor(true, 0);
        let unknown = project(a, &[None, Some(1_000)], false, at + Duration::seconds(500));
        assert_eq!(unknown.entries_ahead, 0);
        assert_eq!(unknown.position_ms, 500_000);

        let end = project(
            a,
            &[Some(1_000), Some(1_000)],
            false,
            at + Duration::seconds(10),
        );
        assert!(end.finished);
        assert_eq!(end.entries_ahead, 1);
    }

    #[test]
    fn paused_does_not_move() {
        let (a, at) = anchor(false, 42_000);
        let p = project(a, &[Some(200_000)], false, at + Duration::seconds(60));
        assert_eq!(p.position_ms, 42_000);
    }

    #[test]
    fn sessions_end_when_paused_closed_or_left_alone() {
        let now = Utc::now();
        let live = Liveness {
            is_playing: true,
            position_at: now,
            host_seen_at: now,
            host_away_since: None,
            host_closed_app: false,
            has_guests: true,
        };
        assert!(!timed_out(live, now));
        // paused ten minutes
        let paused = Liveness {
            is_playing: false,
            position_at: now - Duration::minutes(11),
            ..live
        };
        assert!(timed_out(paused, now));
        // playing with the app closed a minute; a short drop is fine
        let away = |minutes| Liveness {
            host_away_since: Some(now - Duration::seconds(minutes)),
            ..live
        };
        assert!(!timed_out(away(30), now));
        assert!(timed_out(away(61), now));
        // closing the app pauses it first; closed still ends it in a minute,
        // while a paused app that only went quiet waits out the ten
        let paused_away = Liveness {
            is_playing: false,
            ..away(61)
        };
        assert!(!timed_out(paused_away, now));
        assert!(timed_out(
            Liveness {
                host_closed_app: true,
                ..paused_away
            },
            now
        ));
        // alone and quiet half an hour; with guests it stays
        let quiet = Liveness {
            host_seen_at: now - Duration::minutes(31),
            ..live
        };
        assert!(!timed_out(quiet, now));
        assert!(timed_out(
            Liveness {
                has_guests: false,
                ..quiet
            },
            now
        ));
    }
}
