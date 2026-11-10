//! Another user's recent plays, read from `listening_events` and gated by
//! their `listening_history` privacy setting.

use chrono::{DateTime, FixedOffset};
use sea_orm::{DatabaseConnection, DbBackend, FromQueryResult, Statement, prelude::Uuid};

use crate::db::audience::{PrivacyField, can_see_field};
use crate::err::CadenzaError;

/// The most recent plays one read returns.
pub const MAX_RECENT_PLAYS: u64 = 50;

/// One counted play. Titles are not stored, so the client asks Apple Music by
/// `song_id`.
#[derive(Clone, Debug, FromQueryResult)]
pub struct RecentPlay {
    pub song_id: String,
    pub played_at: DateTime<FixedOffset>,
    pub artist_name: Option<String>,
    pub album_name: Option<String>,
}

/// `owner`'s last `limit` counted plays, newest first, or `None` when `viewer`
/// may not see them. Library only songs are left out, since their ids mean
/// nothing on another account.
pub async fn recent_plays_for_viewer(
    db: &DatabaseConnection,
    viewer: Uuid,
    owner: Uuid,
    limit: u64,
) -> Result<Option<Vec<RecentPlay>>, CadenzaError> {
    if !can_see_field(db, viewer, owner, PrivacyField::ListeningHistory).await? {
        return Ok(None);
    }
    let limit = limit.clamp(1, MAX_RECENT_PLAYS) as i64;
    let plays = RecentPlay::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT
             song_id,
             occurred_at AS played_at,
             payload->>'artist_name' AS artist_name,
             payload->>'album_name' AS album_name
         FROM listening_events
         WHERE user_id = $1
           AND event_type = 'play_counted'
           AND song_id IS NOT NULL
           AND song_id NOT LIKE 'i.%'
         ORDER BY occurred_at DESC
         LIMIT $2",
        vec![owner.into(), limit.into()],
    ))
    .all(db)
    .await?;
    Ok(Some(plays))
}
