//! The assistant's activity log, `assistant_actions` (see `sql/assistant_actions.sql`), and
//! the tag writes the assistant makes, each run inside the caller's transaction so the
//! change and its log row commit together.
//!
//! The tag writes report exactly what they changed (which songs got the tag, which values
//! they overwrote, which applications they took off), and that is what the log keeps, so
//! Undo reverses only that. The undo writes check each row still looks the way the change
//! left it, and leave alone (and count) anything changed since.
//!
//! Raw SQL, in the style of `db::shared_playlists`, since the table is new and its entity
//! has not been generated.

use chrono::{DateTime, FixedOffset};
use sea_orm::{ConnectionTrait, DatabaseTransaction, FromQueryResult, prelude::Uuid};
use serde_json::{Value, json};

use crate::db::entity::tags;
use crate::db::stmt;
use crate::db::tag_activity::{RecordedActivity, count_tags_applied, count_tags_unapplied};
use crate::err::CadenzaError;

/// How long a user's log keeps a row.
pub const KEEP_DAYS: i64 = 30;
/// The most rows a user's log keeps.
pub const KEEP_ROWS: i64 = 100;

const COLUMNS: &str = "action_id, user_id, created_at, kind, summary, target_kind, target_id, \
                       target_name, changes, undoable, undone_at, undo_result";

/// One row of the log.
#[derive(Clone, Debug, PartialEq, FromQueryResult)]
pub struct ActionRow {
    pub action_id: i64,
    pub user_id: Uuid,
    pub created_at: DateTime<FixedOffset>,
    pub kind: String,
    pub summary: String,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub target_name: Option<String>,
    pub changes: Value,
    pub undoable: bool,
    pub undone_at: Option<DateTime<FixedOffset>>,
    pub undo_result: Option<String>,
}

/// A row to write.
#[derive(Clone, Debug)]
pub struct NewAction {
    pub kind: &'static str,
    pub summary: String,
    pub target_kind: Option<&'static str>,
    pub target_id: Option<String>,
    pub target_name: Option<String>,
    pub changes: Value,
    pub undoable: bool,
}

fn json_value(value: Value) -> sea_orm::Value {
    sea_orm::Value::Json(Some(Box::new(value)))
}

/// Writes `action` to `user_id`'s log and prunes it to [`KEEP_DAYS`] and [`KEEP_ROWS`].
/// Returns the new row.
pub async fn record(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    action: NewAction,
) -> Result<ActionRow, CadenzaError> {
    let row = ActionRow::find_by_statement(stmt(
        &format!(
            "INSERT INTO assistant_actions
                 (user_id, kind, summary, target_kind, target_id, target_name, changes, undoable)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING {COLUMNS}"
        ),
        vec![
            user_id.into(),
            action.kind.into(),
            action.summary.into(),
            action.target_kind.map(str::to_owned).into(),
            action.target_id.into(),
            action.target_name.into(),
            json_value(action.changes),
            action.undoable.into(),
        ],
    ))
    .one(db)
    .await?
    .ok_or_else(|| CadenzaError::DatabaseError("insert returned nothing".into()))?;
    db.execute_raw(stmt(
        &format!(
            "DELETE FROM assistant_actions
             WHERE user_id = $1
               AND (created_at < now() - interval '{KEEP_DAYS} days'
                    OR action_id NOT IN (
                        SELECT action_id FROM assistant_actions WHERE user_id = $1
                        ORDER BY created_at DESC, action_id DESC LIMIT {KEEP_ROWS}))"
        ),
        vec![user_id.into()],
    ))
    .await?;
    Ok(row)
}

/// `user_id`'s log, newest first.
pub async fn list(
    db: &impl ConnectionTrait,
    user_id: Uuid,
) -> Result<Vec<ActionRow>, CadenzaError> {
    Ok(ActionRow::find_by_statement(stmt(
        &format!(
            "SELECT {COLUMNS} FROM assistant_actions
             WHERE user_id = $1 AND created_at >= now() - interval '{KEEP_DAYS} days'
             ORDER BY created_at DESC, action_id DESC LIMIT {KEEP_ROWS}"
        ),
        vec![user_id.into()],
    ))
    .all(db)
    .await?)
}

/// One of `user_id`'s rows, locked until the transaction ends, so two undos of it cannot
/// both run. `NotFound` for one that is not theirs.
pub async fn get_for_update(
    txn: &DatabaseTransaction,
    user_id: Uuid,
    action_id: i64,
) -> Result<ActionRow, CadenzaError> {
    ActionRow::find_by_statement(stmt(
        &format!(
            "SELECT {COLUMNS} FROM assistant_actions
             WHERE user_id = $1 AND action_id = $2 FOR UPDATE"
        ),
        vec![user_id.into(), action_id.into()],
    ))
    .one(txn)
    .await?
    .ok_or(CadenzaError::NotFound)
}

/// The id of `user_id`'s newest change that can still be undone.
pub async fn latest_undoable(
    db: &impl ConnectionTrait,
    user_id: Uuid,
) -> Result<Option<i64>, CadenzaError> {
    let row = db
        .query_one_raw(stmt(
            &format!(
                "SELECT action_id FROM assistant_actions
                 WHERE user_id = $1 AND undoable AND undone_at IS NULL
                   AND created_at >= now() - interval '{KEEP_DAYS} days'
                 ORDER BY created_at DESC, action_id DESC LIMIT 1"
            ),
            vec![user_id.into()],
        ))
        .await?;
    Ok(match row {
        Some(row) => Some(row.try_get("", "action_id")?),
        None => None,
    })
}

/// Marks a row undone with what the undo did. Returns the row.
pub async fn mark_undone(
    txn: &DatabaseTransaction,
    user_id: Uuid,
    action_id: i64,
    result: &str,
) -> Result<ActionRow, CadenzaError> {
    ActionRow::find_by_statement(stmt(
        &format!(
            "UPDATE assistant_actions SET undone_at = now(), undo_result = $3
             WHERE user_id = $1 AND action_id = $2
             RETURNING {COLUMNS}"
        ),
        vec![user_id.into(), action_id.into(), result.into()],
    ))
    .one(txn)
    .await?
    .ok_or(CadenzaError::NotFound)
}

/// What [`apply_tag`] changed.
#[derive(Default)]
pub struct TagApplied {
    /// Songs that did not have the tag before.
    pub added: Vec<String>,
    /// Songs that had it with another value, and that value.
    pub overwritten: Vec<(String, Option<String>)>,
    pub recorded: Vec<RecordedActivity>,
}

/// Puts `tag` on `song_ids` with `value`. A song that already has it keeps it, and with a
/// value, has its value set to `value`. `value` must already be canonical for the tag's type.
pub async fn apply_tag(
    txn: &DatabaseTransaction,
    user_id: Uuid,
    tag: &tags::Model,
    song_ids: &[String],
    value: Option<String>,
) -> Result<TagApplied, CadenzaError> {
    if song_ids.is_empty() {
        return Ok(TagApplied::default());
    }
    let added: Vec<String> = txn
        .query_all_raw(stmt(
            "INSERT INTO user_tags_applied (user_id, song_id, tag_id, value)
             SELECT $1, song_id, $2, $3 FROM unnest($4::text[]) AS t(song_id)
             ON CONFLICT (song_id, user_id, tag_id) DO NOTHING
             RETURNING song_id",
            vec![
                user_id.into(),
                tag.tag_id.into(),
                value.clone().into(),
                song_ids.to_vec().into(),
            ],
        ))
        .await?
        .iter()
        .map(|row| row.try_get::<String>("", "song_id"))
        .collect::<Result<_, _>>()?;
    let mut overwritten = Vec::new();
    if value.is_some() {
        // the rows inserted above already hold `value`, so only older ones change
        for row in txn
            .query_all_raw(stmt(
                "UPDATE user_tags_applied AS u SET value = $3
                 FROM (
                     SELECT song_id, value AS old FROM user_tags_applied
                     WHERE user_id = $1 AND tag_id = $2 AND song_id = ANY($4)
                       AND value IS DISTINCT FROM $3
                     FOR UPDATE
                 ) AS before
                 WHERE u.user_id = $1 AND u.tag_id = $2 AND u.song_id = before.song_id
                 RETURNING u.song_id, before.old",
                vec![
                    user_id.into(),
                    tag.tag_id.into(),
                    value.clone().into(),
                    song_ids.to_vec().into(),
                ],
            ))
            .await?
        {
            overwritten.push((row.try_get("", "song_id")?, row.try_get("", "old")?));
        }
    }
    let recorded = count_tags_applied(
        txn,
        user_id,
        added
            .iter()
            .map(|song_id| (song_id.clone(), tag.name.clone(), tag.color.clone()))
            .collect(),
    )
    .await?;
    Ok(TagApplied {
        added,
        overwritten,
        recorded,
    })
}

/// What [`remove_tag`] took off: each song and the value it held.
#[derive(Default)]
pub struct TagRemoved {
    pub removed: Vec<(String, Option<String>)>,
    pub recorded: Vec<RecordedActivity>,
}

/// Takes `tag` off `song_ids`. A song without it is left alone.
pub async fn remove_tag(
    txn: &DatabaseTransaction,
    user_id: Uuid,
    tag: &tags::Model,
    song_ids: &[String],
) -> Result<TagRemoved, CadenzaError> {
    if song_ids.is_empty() {
        return Ok(TagRemoved::default());
    }
    let mut removed: Vec<(String, Option<String>)> = Vec::new();
    for row in txn
        .query_all_raw(stmt(
            "DELETE FROM user_tags_applied
             WHERE user_id = $1 AND tag_id = $2 AND song_id = ANY($3)
             RETURNING song_id, value",
            vec![user_id.into(), tag.tag_id.into(), song_ids.to_vec().into()],
        ))
        .await?
    {
        removed.push((row.try_get("", "song_id")?, row.try_get("", "value")?));
    }
    let recorded = count_tags_unapplied(
        txn,
        user_id,
        removed
            .iter()
            .map(|(song_id, _)| (song_id.clone(), tag.name.clone()))
            .collect(),
    )
    .await?;
    Ok(TagRemoved { removed, recorded })
}

/// The pairs as a JSON array of `{song_id, value}`, for `jsonb_to_recordset`, which keeps
/// a null value null.
fn song_values(pairs: &[(String, Option<String>)]) -> sea_orm::Value {
    json_value(Value::from(
        pairs
            .iter()
            .map(|(song_id, value)| json!({ "song_id": song_id, "value": value }))
            .collect::<Vec<_>>(),
    ))
}

/// What an undo did: how many rows went back, how many were left because they changed
/// since, and the counts to log once committed.
#[derive(Default)]
pub struct Reverted {
    pub reverted: usize,
    pub skipped: usize,
    pub recorded: Vec<RecordedActivity>,
}

/// Reverses [`apply_tag`]: takes `tag` off the songs it added, where it still holds the
/// value it was given, and puts back the values it overwrote, where they still hold it.
pub async fn undo_apply_tag(
    txn: &DatabaseTransaction,
    user_id: Uuid,
    tag: &tags::Model,
    added: &[String],
    value: Option<String>,
    overwritten: &[(String, Option<String>)],
) -> Result<Reverted, CadenzaError> {
    let mut taken_off: Vec<String> = Vec::new();
    if !added.is_empty() {
        taken_off = txn
            .query_all_raw(stmt(
                "DELETE FROM user_tags_applied
                 WHERE user_id = $1 AND tag_id = $2 AND song_id = ANY($3)
                   AND value IS NOT DISTINCT FROM $4
                 RETURNING song_id",
                vec![
                    user_id.into(),
                    tag.tag_id.into(),
                    added.to_vec().into(),
                    value.clone().into(),
                ],
            ))
            .await?
            .iter()
            .map(|row| row.try_get::<String>("", "song_id"))
            .collect::<Result<_, _>>()?;
    }
    let mut restored = 0;
    if !overwritten.is_empty() {
        restored = txn
            .execute_raw(stmt(
                "UPDATE user_tags_applied AS u SET value = t.value
                 FROM jsonb_to_recordset($3) AS t(song_id text, value text)
                 WHERE u.user_id = $1 AND u.tag_id = $2 AND u.song_id = t.song_id
                   AND u.value IS NOT DISTINCT FROM $4",
                vec![
                    user_id.into(),
                    tag.tag_id.into(),
                    song_values(overwritten),
                    value.into(),
                ],
            ))
            .await?
            .rows_affected() as usize;
    }
    let recorded = count_tags_unapplied(
        txn,
        user_id,
        taken_off
            .iter()
            .map(|song_id| (song_id.clone(), tag.name.clone()))
            .collect(),
    )
    .await?;
    let reverted = taken_off.len() + restored;
    Ok(Reverted {
        reverted,
        skipped: added.len() + overwritten.len() - reverted,
        recorded,
    })
}

/// Reverses [`remove_tag`]: puts `tag` back on each song with the value it held, unless
/// the song has the tag again by now.
pub async fn undo_remove_tag(
    txn: &DatabaseTransaction,
    user_id: Uuid,
    tag: &tags::Model,
    removed: &[(String, Option<String>)],
) -> Result<Reverted, CadenzaError> {
    if removed.is_empty() {
        return Ok(Reverted::default());
    }
    let put_back: Vec<String> = txn
        .query_all_raw(stmt(
            "INSERT INTO user_tags_applied (user_id, song_id, tag_id, value)
             SELECT $1, t.song_id, $2, t.value
             FROM jsonb_to_recordset($3) AS t(song_id text, value text)
             ON CONFLICT (song_id, user_id, tag_id) DO NOTHING
             RETURNING song_id",
            vec![user_id.into(), tag.tag_id.into(), song_values(removed)],
        ))
        .await?
        .iter()
        .map(|row| row.try_get::<String>("", "song_id"))
        .collect::<Result<_, _>>()?;
    let recorded = count_tags_applied(
        txn,
        user_id,
        put_back
            .iter()
            .map(|song_id| (song_id.clone(), tag.name.clone(), tag.color.clone()))
            .collect(),
    )
    .await?;
    Ok(Reverted {
        reverted: put_back.len(),
        skipped: removed.len() - put_back.len(),
        recorded,
    })
}

/// How many songs carry `tag_id` for `user_id`.
pub async fn tag_application_count(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    tag_id: i64,
) -> Result<i64, CadenzaError> {
    let row = db
        .query_one_raw(stmt(
            "SELECT COUNT(*) AS n FROM user_tags_applied WHERE user_id = $1 AND tag_id = $2",
            vec![user_id.into(), tag_id.into()],
        ))
        .await?
        .ok_or_else(|| CadenzaError::DatabaseError("count returned nothing".into()))?;
    Ok(row.try_get("", "n")?)
}

/// Of `song_ids`, the ones that already have `tag_id`, for a preview.
pub async fn songs_with_tag(
    db: &impl ConnectionTrait,
    user_id: Uuid,
    tag_id: i64,
    song_ids: &[String],
) -> Result<Vec<String>, CadenzaError> {
    if song_ids.is_empty() {
        return Ok(Vec::new());
    }
    db.query_all_raw(stmt(
        "SELECT song_id FROM user_tags_applied
         WHERE user_id = $1 AND tag_id = $2 AND song_id = ANY($3)",
        vec![user_id.into(), tag_id.into(), song_ids.to_vec().into()],
    ))
    .await?
    .iter()
    .map(|row| Ok(row.try_get::<String>("", "song_id")?))
    .collect()
}
