use std::{error::Error, fmt};

use axum::{body::Body, http::Response, response::IntoResponse};
use sea_orm::{DbErr, RuntimeErr};
use serde_json::{Value, json};

// besides 401 and 422, all other errors will respond with JSON:
// {
//  "error_type": ...
//  "message": ... (optional)
// }

#[derive(Debug)]
pub enum CadenzaError {
    SongNotInLibrary,
    SongAlreadyInLibrary,
    TagAlreadyApplied,
    DatabaseError(String), // generic database error
    QueryFormatError(String)
}

impl CadenzaError {
    fn get_status(&self) -> u16 {
        match &self {
            Self::SongNotInLibrary => 404,
            Self::SongAlreadyInLibrary => 409,
            Self::TagAlreadyApplied => 409,
            Self::DatabaseError(_) => 500,
            Self::QueryFormatError(_) => 422,
        }
    }
    fn get_json(&self) -> Value {
        match &self {
            Self::SongNotInLibrary => json!({
                "error_type": "SongNotInLibrary",
            }),
            Self::SongAlreadyInLibrary => json!({
                "error_type": "SongAlreadyInLibrary",
            }),
            Self::TagAlreadyApplied => json!({
                "error_type": "TagAlreadyApplied",
            }),
            Self::DatabaseError(msg) => json!({
                "error_type": "DatabaseError",
                "message": msg
            }),
            Self::QueryFormatError(msg) => json!({
                "error_type": "QueryFormatError",
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

impl IntoResponse for CadenzaError {
    fn into_response(self) -> Response<Body> {
        let body = Into::<Body>::into(serde_json::to_vec(&self.get_json()).unwrap());

        Response::builder()
            .status(self.get_status())
            .header("Content-Type", "application/json")
            .body(body)
            .unwrap()
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
                    _ => {}
                },

                _ => {}
            }
        }
        Self::DatabaseError(db_err.to_string())
    }
}
