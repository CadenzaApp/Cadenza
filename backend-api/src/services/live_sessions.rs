//! Live session rules that need no database: who may do what, and where
//! playback is by now. The writes are `db/live_sessions.rs`.
//!
//! Playback is an anchor: the current entry, playing or not, and `position_ms`
//! at server time `position_at`. The host's device reports what it is really
//! on and the server re-anchors from that. Between reports, and while the
//! host's app is suspended in the background, readers project forward through
//! the queued entries' durations with [`project`].

use chrono::{DateTime, Duration, Utc};

/// A member's role. Ordered: each one can do everything the one before can.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum SessionRole {
    /// Sees the queue and now playing.
    Listener,
    /// Adds songs as suggestions the host approves.
    Suggester,
    /// Adds, removes, and reorders the queue directly.
    QueueEditor,
    /// Queue editor plus play, pause, skip, seek, and jump.
    Controller,
}

impl SessionRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Listener => "listener",
            Self::Suggester => "suggester",
            Self::QueueEditor => "queue_editor",
            Self::Controller => "controller",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "listener" => Some(Self::Listener),
            "suggester" => Some(Self::Suggester),
            "queue_editor" => Some(Self::QueueEditor),
            "controller" => Some(Self::Controller),
            _ => None,
        }
    }
}

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
            SessionAction::Suggest => role >= SessionRole::Suggester,
            SessionAction::EditQueue => role >= SessionRole::QueueEditor,
            SessionAction::Control => role >= SessionRole::Controller,
            SessionAction::Review | SessionAction::Manage | SessionAction::Report => false,
        },
    }
}

/// What adding a song does for this actor: queue it, or suggest it.
pub fn add_lands_as(actor: Actor) -> Option<&'static str> {
    if allowed(actor, SessionAction::EditQueue) {
        Some("queued")
    } else if allowed(actor, SessionAction::Suggest) {
        Some("suggested")
    } else {
        None
    }
}

/// No report from the host for this long ends the session.
pub const HOST_TIMEOUT: Duration = Duration::minutes(30);

pub fn host_timed_out(host_seen_at: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    now - host_seen_at > HOST_TIMEOUT
}

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
pub fn project(anchor: Anchor, durations: &[Option<i64>], now: DateTime<Utc>) -> Projected {
    let mut position = anchor.position_ms.max(0);
    if anchor.is_playing {
        position += (now - anchor.position_at).num_milliseconds().max(0);
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
            Some("suggested")
        );
        assert_eq!(
            add_lands_as(Actor::Member(SessionRole::QueueEditor)),
            Some("queued")
        );
        assert_eq!(add_lands_as(Actor::Host), Some("queued"));
    }

    #[test]
    fn projection_stays_in_the_current_song() {
        let (a, at) = anchor(true, 10_000);
        let p = project(a, &[Some(200_000)], at + Duration::seconds(5));
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
            at + Duration::seconds(130),
        );
        // 190 + 130 = 320: past the first (200), 120 into the second (100),
        // so 20 into the third
        assert_eq!(p.entries_ahead, 2);
        assert_eq!(p.position_ms, 20_000);
    }

    #[test]
    fn projection_stops_at_an_unknown_length_and_at_the_end() {
        let (a, at) = anchor(true, 0);
        let unknown = project(a, &[None, Some(1_000)], at + Duration::seconds(500));
        assert_eq!(unknown.entries_ahead, 0);
        assert_eq!(unknown.position_ms, 500_000);

        let end = project(a, &[Some(1_000), Some(1_000)], at + Duration::seconds(10));
        assert!(end.finished);
        assert_eq!(end.entries_ahead, 1);
    }

    #[test]
    fn paused_does_not_move() {
        let (a, at) = anchor(false, 42_000);
        let p = project(a, &[Some(200_000)], at + Duration::seconds(60));
        assert_eq!(p.position_ms, 42_000);
    }

    #[test]
    fn host_times_out_after_half_an_hour() {
        let now = Utc::now();
        assert!(!host_timed_out(now - Duration::minutes(29), now));
        assert!(host_timed_out(now - Duration::minutes(31), now));
    }
}
