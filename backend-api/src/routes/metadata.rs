use axum::Json;

use crate::models::metadata::Metadata;

pub async fn normalize(Json(payload): Json<Metadata>) -> Json<Metadata> {
    let metadata = payload.normalized();
    Json(metadata)
}
