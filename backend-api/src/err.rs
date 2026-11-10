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
    /// The user already saved a query by this name.
    QueryNameAlreadyTaken,
    /// The signed-in user already has a profile row.
    ProfileAlreadyExists,
    /// Another profile already uses this username.
    UsernameAlreadyTaken,
    /// The pair is already friends.
    FriendshipAlreadyExists,
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
    /// The embedding service could not be reached, or its response could not be read.
    SocialFeedErr(String),
    /// The request body was not shaped the way the handler needs it.
    InvalidRequestBody(String),
    /// The assistant's model could not be reached, or its reply could not be read.
    AssistantErr(String),
    /// The assistant's model provider turned the request away for rate limiting.
    AssistantRateLimited {
        retry_after: Option<Duration>,
    },
    /// This user sent too many requests to a limited endpoint. Room opens
    /// again after `retry_after`.
    UserRateLimited {
        retry_after: Duration,
    },
    /// The invite code does not exist, expired, ran out of uses, or was
    /// revoked. One error for all four, so a guess learns nothing.
    InviteCodeInvalid,
    /// Too many attempts in a short time, like redeeming invite codes.
    TooManyRequests,
    /// The caller is signed in but their role does not allow this. The
    /// message says what was refused.
    Forbidden(String),
    /// The write named an `expected_version` that is no longer current.
    /// Refetch and try again.
    VersionConflict {
        current: i64,
    },
    /// The live session has ended.
    SessionEnded,
}

impl CadenzaError {
    fn get_status(&self) -> u16 {
        match &self {
            Self::NotFound => 404,
            Self::SongNotInLibrary => 404,
            Self::SongAlreadyInLibrary => 409,
            Self::TagAlreadyApplied => 409,
            Self::TagNameAlreadyTaken => 409,
            Self::QueryNameAlreadyTaken => 409,
            Self::ProfileAlreadyExists => 409,
            Self::UsernameAlreadyTaken => 409,
            Self::FriendshipAlreadyExists => 409,
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
            Self::AssistantErr(_) => 502,
            Self::AssistantRateLimited { .. } => 429,
            Self::UserRateLimited { .. } => 429,
            Self::InviteCodeInvalid => 404,
            Self::TooManyRequests => 429,
            Self::Forbidden(_) => 403,
            Self::VersionConflict { .. } => 409,
            Self::SessionEnded => 410,
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
            Self::QueryNameAlreadyTaken => json!({
                "error_type": "QueryNameAlreadyTaken",
                "message": "you already have a saved query with that name"
            }),
            Self::ProfileAlreadyExists => json!({
                "error_type": "ProfileAlreadyExists",
                "message": "you already have a profile"
            }),
            Self::UsernameAlreadyTaken => json!({
                "error_type": "UsernameAlreadyTaken",
                "message": "that username is already taken"
            }),
            Self::FriendshipAlreadyExists => json!({
                "error_type": "FriendshipAlreadyExists",
                "message": "you are already friends"
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
            Self::AssistantErr(msg) => json!({
                "error_type": "AssistantErr",
                "message": msg
            }),
            Self::AssistantRateLimited { retry_after } => json!({
                "error_type": "AssistantRateLimited",
                "message": match retry_after {
                    Some(wait) => format!(
                        "the assistant is rate limited, retry in {}s",
                        wait.as_secs()
                    ),
                    None => "the assistant is rate limited".to_owned(),
                }
            }),
            Self::UserRateLimited { retry_after } => json!({
                "error_type": "UserRateLimited",
                "message": format!("too many requests, retry in {}s", retry_after.as_secs()),
                "retry_after_secs": retry_after.as_secs(),
            }),
            Self::InviteCodeInvalid => json!({
                "error_type": "InviteCodeInvalid",
                "message": "that code is not valid any more"
            }),
            Self::TooManyRequests => json!({
                "error_type": "TooManyRequests",
                "message": "too many attempts, wait a minute"
            }),
            Self::Forbidden(msg) => json!({
                "error_type": "Forbidden",
                "message": msg
            }),
            Self::VersionConflict { current } => json!({
                "error_type": "VersionConflict",
                "message": "this changed since you loaded it, refresh and try again",
                "current_version": current
            }),
            Self::SessionEnded => json!({
                "error_type": "SessionEnded",
                "message": "this live session has ended"
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

                // duplicate row
                "23505" => match db_err.table() {
                    Some("applied_tags") => return Self::TagAlreadyApplied,
                    Some("songs") => return Self::SongAlreadyInLibrary,
                    Some("saved_queries") => return Self::QueryNameAlreadyTaken,
                    Some("profile") => {
                        return match db_err.constraint() {
                            Some("profile_pkey") => Self::ProfileAlreadyExists,
                            Some("profile_username_key") => Self::UsernameAlreadyTaken,
                            _ => Self::ProfileAlreadyExists,
                        };
                    }
                    _ => {}
                },

                _ => {}
            }
        }
        Self::DatabaseError(db_err.to_string())
    }
}
