use std::{error::Error, fmt, time::Duration};

use axum::{body::Body, http::Response, response::IntoResponse};
use sea_orm::{DbErr, RuntimeErr};
use serde_json::{Value, json};

use crate::request_log::LoggedError;

// besides 401 and 422, all other errors will respond with JSON:
// {
//  "error_type": ...
//  "message": ... (optional)
// }

#[derive(Debug)]
pub enum CadenzaError {
    NotFound,
    SongNotInLibrary,
    SongAlreadyInLibrary,
    TagAlreadyApplied,
    TagNameAlreadyTaken,
    DatabaseError(String), // generic database error
    QueryFormatError(String),
    TagGenerationErr(String),
    /// The tag generation provider turned the request away for rate limiting.
    /// `retry_after` is what its response headers said about when the limit
    /// refills, when they said anything at all.
    TagGenerationRateLimited {
        retry_after: Option<Duration>,
    },
    SongMetadataErr(String),
    /// Apple Music turned a catalog request away for rate limiting.
    SongMetadataRateLimited,
    InvalidTagValue(String),
    /// An activity tag was named in a write. Their values come from listening.
    ActivityTagReadOnly,
    /// The social feed service could not be reached, or its response could not be read.
    SocialFeedErr(String),
    /// The request body was not shaped the way the handler needs it.
    InvalidRequestBody(String),
}

impl CadenzaError {
    fn get_status(&self) -> u16 {
        match &self {
            Self::NotFound => 404,
            Self::SongNotInLibrary => 404,
            Self::SongAlreadyInLibrary => 409,
            Self::TagAlreadyApplied => 409,
            Self::TagNameAlreadyTaken => 409,
            Self::DatabaseError(_) => 500,
            Self::QueryFormatError(_) => 422,
            Self::TagGenerationErr(_) => 500,
            Self::TagGenerationRateLimited { .. } => 429,
            Self::SongMetadataErr(_) => 500,
            Self::SongMetadataRateLimited => 429,
            Self::InvalidTagValue(_) => 422,
            Self::ActivityTagReadOnly => 403,
            Self::SocialFeedErr(_) => 502,
            Self::InvalidRequestBody(_) => 422,
        }
    }
    fn get_json(&self) -> Value {
        match &self {
            Self::NotFound => json!({
                "error_type": "NotFound",
            }),
            Self::SongNotInLibrary => json!({
                "error_type": "SongNotInLibrary",
            }),
            Self::SongAlreadyInLibrary => json!({
                "error_type": "SongAlreadyInLibrary",
            }),
            Self::TagAlreadyApplied => json!({
                "error_type": "TagAlreadyApplied",
            }),
            Self::TagNameAlreadyTaken => json!({
                "error_type": "TagNameAlreadyTaken",
                "message": "you already have a tag with that name"
            }),
            Self::DatabaseError(msg) => json!({
                "error_type": "DatabaseError",
                "message": msg
            }),
            Self::QueryFormatError(msg) => json!({
                "error_type": "QueryFormatError",
                "message": msg
            }),
            Self::TagGenerationErr(msg) => json!({
                "error_type": "TagGenerationErr",
                "message": msg
            }),
            Self::TagGenerationRateLimited { retry_after } => json!({
                "error_type": "TagGenerationRateLimited",
                "message": match retry_after {
                    Some(wait) => format!(
                        "the tag generator is rate limited, retry in {}s",
                        wait.as_secs()
                    ),
                    None => "the tag generator is rate limited".to_owned(),
                }
            }),
            Self::SongMetadataErr(msg) => json!({
                "error_type": "SongMetadataErr",
                "message": msg
            }),
            Self::SongMetadataRateLimited => json!({
                "error_type": "SongMetadataRateLimited",
                "message": "apple music is rate limiting catalog requests"
            }),
            Self::InvalidTagValue(msg) => json!({
                "error_type": "InvalidTagValue",
                "message": msg
            }),
            Self::ActivityTagReadOnly => json!({
                "error_type": "ActivityTagReadOnly",
                "message": "activity tags are set by listening and cannot be changed by hand"
            }),
            Self::SocialFeedErr(msg) => json!({
                "error_type": "SocialFeedErr",
                "message": msg
            }),
            Self::InvalidRequestBody(msg) => json!({
                "error_type": "InvalidRequestBody",
                "message": msg
            }),
        }
    }
}

impl fmt::Display for CadenzaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.get_json().to_string())
    }
}

impl Error for CadenzaError {}

impl CadenzaError {
    /// `Variant: message`, or just the variant, for the request log.
    fn log_reason(&self) -> String {
        let json = self.get_json();
        let kind = json["error_type"].as_str().unwrap_or("Error");
        match json["message"].as_str() {
            Some(message) => format!("{kind}: {message}"),
            None => kind.to_owned(),
        }
    }
}

impl IntoResponse for CadenzaError {
    fn into_response(self) -> Response<Body> {
        let body = Into::<Body>::into(serde_json::to_vec(&self.get_json()).unwrap());

        let mut response = Response::builder()
            .status(self.get_status())
            .header("Content-Type", "application/json")
            .body(body)
            .unwrap();
        // what the request log prints as the reason this request failed
        response
            .extensions_mut()
            .insert(LoggedError(self.log_reason()));
        response
    }
}

impl From<DbErr> for CadenzaError {
    fn from(db_err: DbErr) -> Self {
        if let DbErr::Query(RuntimeErr::SqlxError(sqlx_err)) = &db_err
            && let Some(db_err) = sqlx_err.as_database_error()
            && let Some(code) = db_err.code()
        {
            match code.as_ref() {
                // foreign key violation for applied_tags -> songs
                "23503" if db_err.constraint() == Some("applied_tags_user_id_song_id_fkey") => {
                    return Self::SongNotInLibrary;
                }

                // foreign key violation for a reply -> its parent comment, or a vote -> its
                // comment, when that comment doesn't exist or was deleted first
                "23503"
                    if matches!(
                        db_err.constraint(),
                        Some("comment_parent_fkey" | "comment_votes_comment_id_fkey")
                    ) =>
                {
                    return Self::NotFound;
                }

                // duplicate row
                "23505" => match db_err.table() {
                    Some("applied_tags") => return Self::TagAlreadyApplied,
                    Some("songs") => return Self::SongAlreadyInLibrary,
                    _ => {}
                },

                _ => {}
            }
        }
        Self::DatabaseError(db_err.to_string())
    }
}
