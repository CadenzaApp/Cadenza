use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde_json::json;

use crate::{
    AppState,
    auth::SupabaseClaims,
    models::tag_generation_model::{TagGenerationSongRequest, TagGenerationSongResponse},
    services::{
        openai_client::{OpenAiApiKeyError, OpenAiClient},
        tag_generation_service::{TagGenerationService, TagGenerationServiceError},
    },
};

async fn generate_tags_for_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<TagGenerationSongRequest>,
) -> Result<Json<TagGenerationSongResponse>, Response> {
    let openai_client = OpenAiClient::from_env().map_err(map_openai_key_error_to_response)?;
    let service = TagGenerationService::new(openai_client);

    let response = service
        .generate_tags_for_song(&db, claims.user_id, payload)
        .await
        .map_err(map_service_error_to_response)?;

    Ok(Json(response))
}

fn map_openai_key_error_to_response(err: OpenAiApiKeyError) -> Response {
    let message = match err {
        OpenAiApiKeyError::OpenAiApiKeyMissing => {
            "OPENAI_API_KEY is missing from backend environment.".to_string()
        }
        OpenAiApiKeyError::HttpClientBuildFailed { message } => message,
    };

    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({
            "error_type": "openai_configuration_error",
            "message": message
        })),
    )
        .into_response()
}

fn map_service_error_to_response(err: TagGenerationServiceError) -> Response {
    match err {
        TagGenerationServiceError::InvalidRequest(validation_err) => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error_type": "invalid_tag_generation_request",
                "message": format!("{validation_err:?}")
            })),
        )
            .into_response(),
        TagGenerationServiceError::Database(db_err) => db_err.into_response(),
        TagGenerationServiceError::OpenAi(openai_err) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "error_type": "openai_request_failed",
                "message": format!("{openai_err:?}")
            })),
        )
            .into_response(),
    }
}

pub fn get_tag_generation_router() -> Router<AppState> {
    Router::new().route("/", post(generate_tags_for_song_handler))
}
