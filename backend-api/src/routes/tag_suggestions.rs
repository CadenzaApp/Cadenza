use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    AppState, auth::SupabaseClaims, db::tags::get_tag_count, err::CadenzaError,
    services::tag_generation::TagGenerationService,
};

#[derive(Deserialize)]
struct TagGenerationPayload {
    user_id: Uuid,
    song_id: String,
    song_desc: String,
    requested_tag_count: usize,
}

async fn suggest_tags_for_song_handler(
    State(db): State<DatabaseConnection>,
    State(tag_gen_service): State<TagGenerationService>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<TagGenerationPayload>,
) -> Result<Vec<String>, CadenzaError> {
    let user_tags_count = get_tag_count(db, payload.user_id, &payload.song_id).await?;

    let mut suggested_tags = tag_gen_service
        .generate_tags(
            &[payload.song_desc],
            // add # of existing tags to requested tag count to ensure 
            // there's at least `requested_tag_count` new tags
            Some(payload.requested_tag_count + user_tags_count), 
        )
        .await?;

    match suggested_tags.is_empty() {
        true => Ok(vec![]),
        false => Ok(suggested_tags.remove(0)),
    }
}

// fn map_openai_key_error_to_response(err: OpenAiApiKeyError) -> Response {
//     let message = match err {
//         OpenAiApiKeyError::OpenAiApiKeyMissing => {
//             "OPENAI_API_KEY is missing from backend environment.".to_string()
//         }
//         OpenAiApiKeyError::HttpClientBuildFailed { message } => message,
//     };
//
//     (
//         StatusCode::INTERNAL_SERVER_ERROR,
//         Json(json!({
//             "error_type": "openai_configuration_error",
//             "message": message
//         })),
//     )
//         .into_response()
// }
//
// fn map_service_error_to_response(err: TagGenerationServiceError) -> Response {
//     match err {
//         TagGenerationServiceError::InvalidRequest(validation_err) => (
//             StatusCode::BAD_REQUEST,
//             Json(json!({
//                 "error_type": "invalid_tag_generation_request",
//                 "message": format!("{validation_err:?}")
//             })),
//         )
//             .into_response(),
//         TagGenerationServiceError::Database(db_err) => db_err.into_response(),
//         TagGenerationServiceError::OpenAi(openai_err) => (
//             StatusCode::BAD_GATEWAY,
//             Json(json!({
//                 "error_type": "openai_request_failed",
//                 "message": format!("{openai_err:?}")
//             })),
//         )
//             .into_response(),
//     }
// }
//
// pub fn get_tag_generation_router() -> Router<AppState> {
//     Router::new().route("/", post(generate_tags_for_song_handler))
// }
