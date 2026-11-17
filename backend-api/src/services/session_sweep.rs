//! Every 30 s, ends live sessions that ran their course (paused 10 minutes,
//! the host's app closed while playing, a host alone and quiet), and takes
//! members whose app closed or went quiet out of theirs, then tells everyone
//! affected. The rules are `services::live_sessions::timed_out` and
//! `member_gone`; the writes are `db::live_sessions::end_timed_out` and
//! `remove_away_members`.
//!
//! Reads find a timed out session over on their own, but nothing would tell a
//! member just watching it, so this does.

use std::time::Duration;

use sea_orm::DatabaseConnection;
use tokio::time::{MissedTickBehavior, interval};

use crate::db::live_sessions;
use crate::services::realtime::{Event, EventKind, SharedEventBus, Topic, publish_user};

const LOG_TAG: &str = "session sweep";
const SWEEP_INTERVAL: Duration = Duration::from_secs(30);

/// Runs the sweep for as long as the server lives. Every host and member counts
/// as away at startup, since no socket survives a restart; reconnecting clears
/// it.
pub fn spawn_session_sweep(db: DatabaseConnection, bus: SharedEventBus) {
    println!("{LOG_TAG}: on, every {}s", SWEEP_INTERVAL.as_secs());
    tokio::spawn(async move {
        if let Err(err) = live_sessions::mark_all_away(&db).await {
            eprintln!("{LOG_TAG}: could not mark everyone away at startup: {err}");
        }
        let mut ticker = interval(SWEEP_INTERVAL);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            match live_sessions::end_timed_out(&db).await {
                Ok(ended) => {
                    for session in ended {
                        // says why, so members are not told the host ended it
                        bus.publish(
                            Event::new(
                                Topic::LiveSession(session.session_id),
                                session.version,
                                EventKind::Ended,
                            )
                            .with_data(serde_json::json!({ "reason": session.reason })),
                        );
                        // their current session is gone too
                        for user_id in session.member_ids {
                            publish_user(&bus, user_id, EventKind::LiveSession);
                        }
                    }
                }
                Err(err) => eprintln!("{LOG_TAG}: pass failed: {err}"),
            }
            match live_sessions::remove_away_members(&db).await {
                Ok(gone) => {
                    for session in gone {
                        let kind = if session.ended {
                            EventKind::Ended
                        } else {
                            EventKind::Session
                        };
                        bus.publish(Event::new(
                            Topic::LiveSession(session.session_id),
                            session.version,
                            kind,
                        ));
                        // their current session is gone
                        for user_id in session.user_ids {
                            publish_user(&bus, user_id, EventKind::LiveSession);
                        }
                    }
                }
                Err(err) => eprintln!("{LOG_TAG}: removing away members failed: {err}"),
            }
        }
    });
}
