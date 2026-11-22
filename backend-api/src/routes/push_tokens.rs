use axum::{Json, Router, extract::State, routing::post};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    AppState,
    auth::SupabaseClaims,
    db::push_tokens::{delete_user_push_token, upsert_push_token},
    err::CadenzaError,
    services::push::PushService,
};

#[derive(Deserialize)]
struct PushTokenBody {
    /// `ExponentPushToken[...]`
    token: String,
}

fn require_push_token(body: &PushTokenBody) -> Result<&str, CadenzaError> {
    let token = body.token.trim();
    if PushService::is_push_token(token) {
        Ok(token)
    } else {
        Err(CadenzaError::InvalidRequestBody(
            "token is not an Expo push token".to_owned(),
        ))
    }
}

/// Registers this phone's Expo push token for the signed-in user, so pushes
/// for them reach it. Called after every sign in. A token another user had
/// moves to this one. 422 `InvalidRequestBody` for something that is not an
/// Expo push token. Responds with `null`.
async fn register_push_token(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<PushTokenBody>,
) -> Result<Json<Value>, CadenzaError> {
    upsert_push_token(&db, claims.user_id, require_push_token(&body)?).await?;
    Ok(Json(Value::Null))
}

/// Forgets this phone's Expo push token for the signed-in user. Called on sign
/// out, before the session ends. A token that is not theirs, or not stored, is
/// left alone and still answers `null`.
async fn unregister_push_token(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(body): Json<PushTokenBody>,
) -> Result<Json<Value>, CadenzaError> {
    delete_user_push_token(&db, claims.user_id, body.token.trim()).await?;
    Ok(Json(Value::Null))
}

pub fn get_push_tokens_router() -> Router<AppState> {
    Router::new().route("/", post(register_push_token).delete(unregister_push_token))
}
