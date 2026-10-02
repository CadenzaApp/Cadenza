use axum::{Json, Router, extract::State, routing::post};
use axum_jwt_auth::Claims;
use chrono::Utc;
use sea_orm::{DatabaseConnection, TransactionTrait};
use serde_json::{Value, json};
use std::collections::HashSet;

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        activity_tags::record_play_within,
        events::{NewEvent, insert_events},
    },
    err::CadenzaError,
    routes::json::analytics::{EventBatchPayload, EventBatchResponse, EventPayload},
    services::analytics::{EventType, check_not_in_future, sanitize_timezone},
};

/// How many events one batch may carry. A client flushing a long offline queue
/// sends several batches rather than one enormous insert.
const MAX_EVENTS_PER_BATCH: usize = 500;

/// Records a batch of listening events for the signed in user.
///
/// Idempotent on `client_event_id`: re-sending a batch stores nothing the second
/// time and still reports every id as accepted, so a client that never saw the
/// first response can safely retry. The whole batch is validated before any of
/// it is inserted, so one malformed event rejects the request rather than
/// leaving half of it stored.
///
/// `occurred_at` is the client's clock, which is what the user experienced.
/// Anything more than ten minutes ahead of the server is refused.
///
/// JSON request body format:
/// ```json
/// {
///   "events": [
///     {
///       "type": "play_counted",
///       "song_id": "1234567",
///       "occurred_at": "2026-09-28T18:03:11Z",
///       "client_tz": "America/Denver",
///       "session_id": "0b5c3f2e-7b1a-4f84-9f0f-6a2d1c8e4b55",
///       "client_event_id": "3f1c-play-counted-1234567-1759080191",
///       "payload": {}
///     }
///   ]
/// }
/// ```
///
/// JSON return value format, the ids the client may now drop from its queue:
/// ```json
/// { "accepted": ["3f1c-play-counted-1234567-1759080191"] }
/// ```
async fn record_events_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<EventBatchPayload>,
) -> Result<Json<EventBatchResponse>, CadenzaError> {
    if payload.events.len() > MAX_EVENTS_PER_BATCH {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "a batch is limited to {MAX_EVENTS_PER_BATCH} events"
        )));
    }

    let now = Utc::now();
    let events = payload
        .events
        .into_iter()
        .map(|event| validate_event(event, now))
        .collect::<Result<Vec<_>, _>>()?;

    // the events and the activity tags they move go in together, so My Plays can
    // never drift from the log it is derived from
    let txn = db.begin().await?;
    let stored = insert_events(&txn, claims.user_id, &events).await?;
    count_plays(&txn, claims.user_id, &events, &stored.inserted).await?;
    txn.commit().await?;

    Ok(Json(EventBatchResponse {
        accepted: stored.accepted,
    }))
}

/// Counts every newly stored `play_counted` event towards the My Plays, First
/// Played, and Last Played activity tags.
///
/// Keyed on the ids that were actually inserted, not the ones accepted, so a
/// retried batch moves nothing. This is why `insert_events` reports the two
/// separately.
///
/// Uses the event's own `occurred_at`, so a play flushed from an offline queue
/// days later still lands on the day it happened.
async fn count_plays(
    db: &impl sea_orm::ConnectionTrait,
    user_id: uuid::Uuid,
    events: &[NewEvent],
    inserted: &[String],
) -> Result<(), CadenzaError> {
    let inserted: HashSet<&str> = inserted.iter().map(String::as_str).collect();

    for event in events {
        if event.event_type != EventType::PlayCounted {
            continue;
        }
        if !inserted.contains(event.client_event_id.as_str()) {
            continue;
        }
        let Some(song_id) = event.song_id.as_deref() else {
            continue;
        };
        record_play_within(db, user_id, song_id, event.occurred_at).await?;
    }

    Ok(())
}

/// Turns one event off the wire into a storable one, or says why it cannot be
/// stored.
fn validate_event(
    event: EventPayload,
    now: chrono::DateTime<Utc>,
) -> Result<NewEvent, CadenzaError> {
    let client_event_id = event.client_event_id.trim().to_owned();
    if client_event_id.is_empty() {
        return Err(CadenzaError::InvalidRequestBody(
            "every event needs a non-empty client_event_id".to_owned(),
        ));
    }

    let event_type = EventType::from_name(&event.event_type).ok_or_else(|| {
        CadenzaError::InvalidRequestBody(format!(
            "event '{client_event_id}' has unknown type '{}'",
            event.event_type
        ))
    })?;

    check_not_in_future(event.occurred_at, now, &client_event_id)?;

    let payload: Value = event.payload.unwrap_or_else(|| json!({}));
    let song_id = event
        .song_id
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty());

    event_type.validate(song_id.as_deref(), &payload, &client_event_id)?;

    Ok(NewEvent {
        event_type,
        song_id,
        occurred_at: event.occurred_at,
        client_tz: sanitize_timezone(event.client_tz.as_deref().unwrap_or("UTC")).to_owned(),
        session_id: event.session_id,
        client_event_id,
        payload,
    })
}

pub fn get_events_router() -> Router<AppState> {
    Router::new().route("/", post(record_events_handler))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, Duration};

    fn at(iso: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(iso)
            .unwrap()
            .with_timezone(&Utc)
    }

    const NOW: &str = "2026-09-28T18:00:00Z";

    /// Builds the wire shape by parsing json, so these cover deserialization too.
    fn parse(body: &str) -> Result<NewEvent, CadenzaError> {
        let event: EventPayload = serde_json::from_str(body).expect("valid json");
        validate_event(event, at(NOW))
    }

    #[test]
    fn the_documented_example_parses() {
        let event = parse(
            r#"{
                "type": "play_counted",
                "song_id": "1234567",
                "occurred_at": "2026-09-28T17:03:11Z",
                "client_tz": "America/Denver",
                "session_id": "0b5c3f2e-7b1a-4f84-9f0f-6a2d1c8e4b55",
                "client_event_id": "abc",
                "payload": {}
            }"#,
        )
        .expect("should validate");

        assert_eq!(event.event_type, EventType::PlayCounted);
        assert_eq!(event.song_id.as_deref(), Some("1234567"));
        assert_eq!(event.client_tz, "America/Denver");
        assert_eq!(event.client_event_id, "abc");
        assert!(event.session_id.is_some());
    }

    #[test]
    fn the_optional_fields_are_optional() {
        let event = parse(
            r#"{
                "type": "play_start",
                "song_id": "1",
                "occurred_at": "2026-09-28T17:03:11Z",
                "client_event_id": "abc"
            }"#,
        )
        .expect("should validate");

        assert_eq!(event.client_tz, "UTC", "the default zone");
        assert_eq!(event.session_id, None);
        assert_eq!(event.payload, json!({}));
    }

    #[test]
    fn an_unknown_type_is_refused_by_name() {
        let err = parse(
            r#"{"type": "danced", "song_id": "1",
                "occurred_at": "2026-09-28T17:03:11Z", "client_event_id": "abc"}"#,
        )
        .expect_err("unknown type");
        let message = err.to_string();
        assert!(message.contains("danced"), "{message}");
        assert!(message.contains("abc"), "names the event: {message}");
    }

    #[test]
    fn a_blank_client_event_id_is_refused() {
        for id in ["", "   "] {
            let body = format!(
                r#"{{"type": "play_start", "song_id": "1",
                     "occurred_at": "2026-09-28T17:03:11Z", "client_event_id": "{id}"}}"#
            );
            assert!(parse(&body).is_err(), "id {id:?} should be refused");
        }
    }

    #[test]
    fn a_client_event_id_is_trimmed_so_it_cannot_collide_by_whitespace() {
        let event = parse(
            r#"{"type": "play_start", "song_id": "1",
                "occurred_at": "2026-09-28T17:03:11Z", "client_event_id": "  abc  "}"#,
        )
        .unwrap();
        assert_eq!(event.client_event_id, "abc");
    }

    #[test]
    fn a_blank_song_id_reads_as_absent() {
        // so it fails the "needs a song" check rather than storing a blank string
        let err = parse(
            r#"{"type": "play_start", "song_id": "   ",
                "occurred_at": "2026-09-28T17:03:11Z", "client_event_id": "abc"}"#,
        )
        .expect_err("a blank song id is no song id");
        assert!(err.to_string().contains("needs a song_id"));
    }

    #[test]
    fn the_far_future_is_refused_but_drift_is_not() {
        let soon = at(NOW) + Duration::minutes(2);
        let body = format!(
            r#"{{"type": "play_start", "song_id": "1",
                 "occurred_at": "{}", "client_event_id": "abc"}}"#,
            soon.to_rfc3339()
        );
        assert!(parse(&body).is_ok(), "two minutes of drift is fine");

        let later = at(NOW) + Duration::days(30);
        let body = format!(
            r#"{{"type": "play_start", "song_id": "1",
                 "occurred_at": "{}", "client_event_id": "abc"}}"#,
            later.to_rfc3339()
        );
        assert!(parse(&body).is_err(), "a month ahead is not");
    }

    #[test]
    fn a_nonsense_timezone_falls_back_rather_than_failing_the_event() {
        // losing the zone costs a correct bucket; losing the play costs the play
        let event = parse(
            r#"{"type": "play_start", "song_id": "1",
                "occurred_at": "2026-09-28T17:03:11Z", "client_event_id": "abc",
                "client_tz": "'; drop table tags; --"}"#,
        )
        .unwrap();
        assert_eq!(event.client_tz, "UTC");
    }

    #[test]
    fn a_skip_without_its_payload_is_refused() {
        let err = parse(
            r#"{"type": "skip", "song_id": "1",
                "occurred_at": "2026-09-28T17:03:11Z", "client_event_id": "abc",
                "payload": {}}"#,
        )
        .expect_err("a skip needs position_ms and listened_ms");
        assert!(err.to_string().contains("listened_ms"));
    }

    #[test]
    fn a_query_run_carries_no_song() {
        let event = parse(
            r#"{"type": "query_run", "occurred_at": "2026-09-28T17:03:11Z",
                "client_event_id": "abc", "payload": {"result_count": 12}}"#,
        )
        .unwrap();
        assert_eq!(event.song_id, None);
    }

    #[test]
    fn the_batch_cap_matches_what_the_queue_sends() {
        // client-app/src/lib/event-queue.ts FLUSH_BATCH_SIZE, which must not be
        // larger or every flush would be refused
        assert_eq!(MAX_EVENTS_PER_BATCH, 500);
    }
}
