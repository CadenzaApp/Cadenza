use axum::{Json, http::StatusCode};
use serde::Serialize;

use crate::models::metadata::Metadata;

#[derive(Serialize)]
pub struct MetadataErrorResponse {
    error: String,
}

pub async fn normalize(
    Json(payload): Json<Metadata>,
) -> Result<Json<Metadata>, (StatusCode, Json<MetadataErrorResponse>)> {
    let metadata = payload.normalized();

    if let Err(error) = metadata.validate() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(MetadataErrorResponse {
                error: error.to_string(),
            }),
        ));
    }

    Ok(Json(metadata))
}
