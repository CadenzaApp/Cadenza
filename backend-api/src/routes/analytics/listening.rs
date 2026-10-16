//! Thin, authenticated reads for listening time and session details.

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::get,
};
use axum_jwt_auth::Claims;
use chrono::{DateTime, Utc};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    AppState, auth::SupabaseClaims, db::analytics::listening as db, err::CadenzaError,
    routes::json::analytics::listening as json, services::analytics::TimeWindow,
};

#[derive(Deserialize)]
struct Params {
    // Required bounds keep session reads within the period the card displays.
    since: DateTime<Utc>,
    until: DateTime<Utc>,
    bucket: Option<String>,
    tz: Option<String>,
    tag_id: Option<i64>,
    /// Counts only songs with none of the user's tags. Not with `tag_id`.
    untagged: Option<bool>,
    session_key: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
}

impl Params {
    fn window(&self) -> Result<TimeWindow, CadenzaError> {
        TimeWindow::new(Some(self.since), Some(self.until))
    }

    fn tag(&self) -> Result<db::TagMatch, CadenzaError> {
        match (self.tag_id, self.untagged.unwrap_or(false)) {
            (Some(_), true) => Err(CadenzaError::InvalidRequestBody(
                "tag_id and untagged cannot both be set".to_owned(),
            )),
            (Some(id), false) if id <= 0 => Err(CadenzaError::InvalidRequestBody(
                "tag_id must be positive".to_owned(),
            )),
            (Some(id), false) => Ok(db::TagMatch::Tag(id)),
            (None, true) => Ok(db::TagMatch::Untagged),
            (None, false) => Ok(db::TagMatch::Any),
        }
    }

    fn page(&self) -> Result<(i64, i64), CadenzaError> {
        let offset = self.offset.unwrap_or(0);
        if !(0..=100_000).contains(&offset) {
            return Err(CadenzaError::InvalidRequestBody(
                "invalid page offset".to_owned(),
            ));
        }
        Ok((offset, self.limit.unwrap_or(25).clamp(1, 100)))
    }
}

/// GET /analytics/listening: total_ms is unfiltered; listening_ms, plays,
/// session_count and local-time cells match the optional single tag.
async fn listening(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<Params>,
) -> Result<Json<json::Listening>, CadenzaError> {
    let window = params.window()?;
    let bucket = super::parse_bucket(params.bucket.as_deref().unwrap_or("day"))?;
    super::check_bucket_count(params.since, params.until, bucket)?;
    Ok(Json(
        db::get_listening(
            &db,
            claims.user_id,
            window,
            bucket,
            params.tz.as_deref().unwrap_or("UTC"),
            params.tag()?,
        )
        .await?
        .into(),
    ))
}

/// GET /analytics/sessions: bounded, newest-first recorded session groups.
/// Events without a session use key "unassigned" and are labeled separately.
async fn sessions(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<Params>,
) -> Result<Json<json::Page<json::Session>>, CadenzaError> {
    let window = params.window()?;
    let (offset, limit) = params.page()?;
    let rows = db::get_sessions(&db, claims.user_id, window, params.tag()?, offset, limit).await?;
    Ok(Json(json::Page::new(rows, limit as usize)))
}

/// GET /analytics/session-songs: song durations and neutral tag names in the
/// window and tag filter. `session_key` narrows it to one session; without it
/// the list covers every listen in the window.
async fn songs(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<Params>,
) -> Result<Json<json::Page<json::SessionSong>>, CadenzaError> {
    let window = params.window()?;
    let (offset, limit) = params.page()?;
    let session = match params.session_key.as_deref() {
        None => db::SessionFilter::Any,
        Some("unassigned") => db::SessionFilter::Unassigned,
        Some(key) => db::SessionFilter::One(
            Uuid::parse_str(key)
                .map_err(|_| CadenzaError::InvalidRequestBody("invalid session key".to_owned()))?,
        ),
    };
    let rows = db::get_session_songs(
        &db,
        claims.user_id,
        window,
        params.tag()?,
        session,
        offset,
        limit,
    )
    .await?;
    Ok(Json(json::Page::new(rows, limit as usize)))
}

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/listening", get(listening))
        .route("/sessions", get(sessions))
        .route("/session-songs", get(songs))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn params_validate_windows_filters_and_paging() {
        let mut params = Params {
            since: Utc::now(),
            until: Utc::now() + chrono::Duration::days(1),
            bucket: None,
            tz: None,
            tag_id: None,
            untagged: None,
            session_key: None,
            offset: None,
            limit: Some(9999),
        };
        assert!(params.window().is_ok());
        assert_eq!(params.page().unwrap(), (0, 100));
        params.offset = Some(-1);
        assert!(params.page().is_err());
        assert_eq!(params.tag().unwrap(), db::TagMatch::Any);
        params.tag_id = Some(-1);
        assert!(params.tag().is_err());
        params.tag_id = Some(3);
        assert_eq!(params.tag().unwrap(), db::TagMatch::Tag(3));
        params.untagged = Some(true);
        assert!(params.tag().is_err(), "a tag and untagged at once");
        params.tag_id = None;
        assert_eq!(params.tag().unwrap(), db::TagMatch::Untagged);
        params.until = params.since;
        assert!(params.window().is_err());
    }
}
