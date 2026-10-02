//! What kinds of listening event exist, and what each one's payload has to
//! carry.
//!
//! The database stores `event_type` as plain text and checks nothing, so this
//! is the only validation there is. Adding an event type means adding a variant
//! here, not a schema change.

use serde_json::Value;

use crate::err::CadenzaError;

/// One kind of thing a user did while listening.
///
/// Names are the exact strings stored in `listening_events.event_type` and sent
/// by the client. They are part of the api contract, so renaming one orphans
/// every row already written under the old name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EventType {
    /// A song became the active track and started playing.
    PlayStart,
    /// The song played long enough to count as a play. The client decides how
    /// long; see `client-app/src/lib/play-tracker.ts`.
    PlayCounted,
    /// The song reached its end.
    PlayComplete,
    /// The user left the song before its end.
    Skip,
    /// The user jumped to another position in the song.
    Seek,
    /// A tag query was run.
    QueryRun,
    /// A song was played from a query's results.
    QueryPlay,
    /// The user put a tag on a song.
    TagApplied,
    /// The user took a tag off a song.
    TagRemoved,
}

impl EventType {
    pub const ALL: [EventType; 9] = [
        Self::PlayStart,
        Self::PlayCounted,
        Self::PlayComplete,
        Self::Skip,
        Self::Seek,
        Self::QueryRun,
        Self::QueryPlay,
        Self::TagApplied,
        Self::TagRemoved,
    ];

    /// The string stored in the column and sent over the wire.
    pub fn name(self) -> &'static str {
        match self {
            Self::PlayStart => "play_start",
            Self::PlayCounted => "play_counted",
            Self::PlayComplete => "play_complete",
            Self::Skip => "skip",
            Self::Seek => "seek",
            Self::QueryRun => "query_run",
            Self::QueryPlay => "query_play",
            Self::TagApplied => "tag_applied",
            Self::TagRemoved => "tag_removed",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|event| event.name() == name)
    }

    /// Whether the event is about one song. Everything but `query_run` is.
    pub fn needs_song(self) -> bool {
        self != Self::QueryRun
    }

    /// Payload keys the event cannot be stored without, because an aggregate
    /// reads them. Anything else in the payload is kept but not required, so
    /// the client can add context without a backend change.
    ///
    /// These must be whole numbers. The aggregates in
    /// [`crate::services::analytics::metrics`] cast the stored text straight to
    /// `bigint`, and the log is append only, so one row holding `1.5` or `1e30`
    /// would make the summary raise for that user with no way to delete it
    /// through the api. Validation here is the only thing preventing that.
    fn required_integers(self) -> &'static [&'static str] {
        match self {
            // listening time is summed from the two events that end a listen,
            // so neither can be missing its duration
            Self::PlayComplete => &["listened_ms"],
            Self::Skip => &["listened_ms", "position_ms"],
            Self::Seek => &["from_ms", "to_ms"],
            Self::QueryRun => &["result_count"],
            _ => &[],
        }
    }

    /// Payload keys that have to be present and a non-empty string.
    fn required_strings(self) -> &'static [&'static str] {
        match self {
            Self::TagApplied | Self::TagRemoved => &["tag_name"],
            _ => &[],
        }
    }

    /// Checks one event's song id and payload against this type.
    ///
    /// Returns `InvalidRequestBody` naming the event and what is wrong with it,
    /// so a client sending the wrong shape can see which of its events to fix.
    pub fn validate(
        self,
        song_id: Option<&str>,
        payload: &Value,
        client_event_id: &str,
    ) -> Result<(), CadenzaError> {
        let bad = |msg: String| Err(CadenzaError::InvalidRequestBody(msg));

        let has_song = song_id.is_some_and(|id| !id.trim().is_empty());
        if self.needs_song() && !has_song {
            return bad(format!(
                "event '{client_event_id}' of type '{}' needs a song_id",
                self.name()
            ));
        }
        if !self.needs_song() && has_song {
            return bad(format!(
                "event '{client_event_id}' of type '{}' must not carry a song_id",
                self.name()
            ));
        }

        if !payload.is_object() {
            return bad(format!(
                "event '{client_event_id}' has a payload that is not a json object"
            ));
        }

        for key in self.required_integers() {
            match payload.get(key) {
                // is_i64 is false for a float and for anything outside i64,
                // so this is also the overflow guard
                Some(value) if value.is_i64() => {}
                Some(_) => {
                    return bad(format!(
                        "event '{client_event_id}' of type '{}' needs payload.{key} to be a whole number",
                        self.name()
                    ));
                }
                None => {
                    return bad(format!(
                        "event '{client_event_id}' of type '{}' is missing payload.{key}",
                        self.name()
                    ));
                }
            }
        }

        for key in self.required_strings() {
            match payload.get(key).and_then(Value::as_str) {
                Some(text) if !text.trim().is_empty() => {}
                _ => {
                    return bad(format!(
                        "event '{client_event_id}' of type '{}' needs payload.{key} to be a non-empty string",
                        self.name()
                    ));
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn names_round_trip() {
        for event in EventType::ALL {
            assert_eq!(EventType::from_name(event.name()), Some(event));
        }
        assert_eq!(EventType::from_name("play-start"), None);
        assert_eq!(EventType::from_name(""), None);
    }

    #[test]
    fn only_query_run_has_no_song() {
        for event in EventType::ALL {
            assert_eq!(event.needs_song(), event != EventType::QueryRun);
        }
    }

    #[test]
    fn song_events_need_a_song() {
        let err = EventType::PlayStart.validate(None, &json!({}), "a");
        assert!(err.is_err());
        let err = EventType::PlayStart.validate(Some("  "), &json!({}), "a");
        assert!(err.is_err());
        assert!(
            EventType::PlayStart
                .validate(Some("1234"), &json!({}), "a")
                .is_ok()
        );
    }

    #[test]
    fn query_run_refuses_a_song() {
        let payload = json!({ "result_count": 3 });
        assert!(
            EventType::QueryRun
                .validate(Some("1234"), &payload, "a")
                .is_err()
        );
        assert!(EventType::QueryRun.validate(None, &payload, "a").is_ok());
    }

    #[test]
    fn required_integers_are_checked() {
        // missing
        assert!(
            EventType::Skip
                .validate(Some("1"), &json!({}), "a")
                .is_err()
        );
        // present but not a number
        assert!(
            EventType::Skip
                .validate(
                    Some("1"),
                    &json!({"listened_ms": "12", "position_ms": 12}),
                    "a"
                )
                .is_err()
        );
        // both present
        assert!(
            EventType::Skip
                .validate(
                    Some("1"),
                    &json!({"listened_ms": 12, "position_ms": 12}),
                    "a"
                )
                .is_ok()
        );
    }

    /// A stored float or an out-of-range value would make the `::bigint` cast in
    /// the aggregates raise, and the log cannot be edited to fix it.
    #[test]
    fn a_fractional_or_oversized_number_is_refused() {
        for bad_value in [json!(1.5), json!(1e30), json!(-1e30), json!(f64::MAX)] {
            let payload = json!({"listened_ms": bad_value, "position_ms": 0});
            assert!(
                EventType::Skip.validate(Some("1"), &payload, "a").is_err(),
                "{bad_value} should be refused"
            );
        }
    }

    #[test]
    fn a_whole_number_is_accepted_at_either_sign() {
        for value in [json!(0), json!(-1), json!(i64::MAX), json!(i64::MIN)] {
            let payload = json!({"listened_ms": value, "position_ms": 0});
            assert!(
                EventType::Skip.validate(Some("1"), &payload, "a").is_ok(),
                "{value} should be accepted"
            );
        }
    }

    #[test]
    fn required_strings_are_checked() {
        assert!(
            EventType::TagApplied
                .validate(Some("1"), &json!({}), "a")
                .is_err()
        );
        assert!(
            EventType::TagApplied
                .validate(Some("1"), &json!({"tag_name": "  "}), "a")
                .is_err()
        );
        assert!(
            EventType::TagApplied
                .validate(Some("1"), &json!({"tag_name": "GYM"}), "a")
                .is_ok()
        );
    }

    #[test]
    fn a_payload_that_is_not_an_object_is_refused() {
        assert!(
            EventType::PlayStart
                .validate(Some("1"), &json!([1, 2]), "a")
                .is_err()
        );
        assert!(
            EventType::PlayStart
                .validate(Some("1"), &json!(null), "a")
                .is_err()
        );
    }

    #[test]
    fn extra_payload_keys_are_allowed() {
        let payload = json!({ "listened_ms": 1000, "anything": "else" });
        assert!(
            EventType::PlayComplete
                .validate(Some("1"), &payload, "a")
                .is_ok()
        );
    }
}
