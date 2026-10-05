//! The write path for `listening_events`. Append only: nothing here updates or
//! deletes a row.
//!
//! Reads are in [`crate::db::analytics`], so the ingest side and the aggregate
//! side can change without touching each other.

use chrono::{DateTime, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, QueryFilter, QuerySelect, Statement,
    Value as DbValue, prelude::Uuid,
};
use serde_json::Value;

use crate::db::entity::listening_events;
use crate::err::CadenzaError;
use crate::services::analytics::EventType;

/// One event on its way in, already validated.
#[derive(Clone, Debug)]
pub struct NewEvent {
    pub event_type: EventType,
    pub song_id: Option<String>,
    pub occurred_at: DateTime<Utc>,
    pub client_tz: String,
    pub session_id: Option<Uuid>,
    /// Unique per user. A second insert under the same id does nothing.
    pub client_event_id: String,
    pub payload: Value,
}

/// What one batch did.
#[derive(Clone, Debug, Default)]
pub struct InsertedEvents {
    /// Ids this call actually wrote a row for.
    ///
    /// Anything that reacts to an event, like counting it towards an activity
    /// tag, must key off this and not [`Self::accepted`], or a retried batch
    /// counts twice.
    pub inserted: Vec<String>,
    /// Ids now stored, whether this call or an earlier one stored them. What the
    /// client may drop from its queue.
    pub accepted: Vec<String>,
}

/// Inserts a batch of events for one user.
///
/// Idempotent on `(user_id, client_event_id)`: a retried batch inserts nothing
/// and still reports every id as accepted, so a client that never saw the first
/// response can clear its queue on the retry.
///
/// One statement, so either the batch lands or none of it does. A client
/// retrying a partly-stored batch cannot happen.
pub async fn insert_events(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    events: &[NewEvent],
) -> Result<InsertedEvents, CadenzaError> {
    if events.is_empty() {
        return Ok(InsertedEvents::default());
    }

    // Raw rather than insert_many so `returning` can say which rows were new.
    // created_at is left out so the column's now() default stamps it: that is our
    // clock, and occurred_at is the client's.
    let columns = "(user_id, event_type, song_id, occurred_at, client_tz, session_id, \
                    client_event_id, payload)";
    const COLUMNS_PER_ROW: usize = 8;

    let placeholders = (0..events.len())
        .map(|row| {
            let base = row * COLUMNS_PER_ROW;
            let slot = |offset: usize| base + offset + 1;
            format!(
                "(${}, ${}, ${}, ${}, ${}, ${}, ${}, ${}::jsonb)",
                slot(0),
                slot(1),
                slot(2),
                slot(3),
                slot(4),
                slot(5),
                slot(6),
                slot(7),
            )
        })
        .collect::<Vec<_>>()
        .join(", ");

    let mut values: Vec<DbValue> = Vec::with_capacity(events.len() * COLUMNS_PER_ROW);
    for event in events {
        values.push(user_id.into());
        values.push(event.event_type.name().into());
        values.push(event.song_id.clone().into());
        values.push(event.occurred_at.into());
        values.push(event.client_tz.clone().into());
        values.push(event.session_id.into());
        values.push(event.client_event_id.clone().into());
        values.push(event.payload.to_string().into());
    }

    let sql = format!(
        "insert into listening_events {columns}
         values {placeholders}
         on conflict (user_id, client_event_id) do nothing
         returning client_event_id"
    );

    let inserted: Vec<String> = db
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            values,
        ))
        .await?
        .into_iter()
        .map(|row| row.try_get_by_index::<String>(0))
        .collect::<Result<_, _>>()?;

    // Everything in the batch that is stored now, which is the new rows plus any
    // an earlier attempt already wrote. Read back rather than assumed, because
    // that is the whole point of answering a retry correctly.
    let sent: Vec<&str> = events
        .iter()
        .map(|event| event.client_event_id.as_str())
        .collect();

    let accepted: Vec<String> = listening_events::Entity::find()
        .select_only()
        .column(listening_events::Column::ClientEventId)
        .filter(listening_events::Column::UserId.eq(user_id))
        .filter(listening_events::Column::ClientEventId.is_in(sent))
        .into_tuple::<String>()
        .all(db)
        .await?;

    Ok(InsertedEvents { inserted, accepted })
}
