use axum::{
    Json, Router,
    extract::{Path, RawQuery, State},
    http::{Method, header},
    response::IntoResponse,
    routing::any,
};
use axum_jwt_auth::Claims;
use serde_json::Value;

use crate::{
    AppState, auth::SupabaseClaims, err::CadenzaError, services::social_feed::SocialFeedService,
};

/// Forwards every `/social/...` request to the social feed service with the caller's user id
/// attached, and relays its status, content type, and body back unchanged.
///
/// There is no fixed endpoint list here on purpose: the service owns the routes, this only
/// owns the auth. See [`SocialFeedService`].
pub fn get_social_router() -> Router<AppState> {
    Router::new().route("/{*path}", any(forward_handler))
}

async fn forward_handler(
    Claims { claims, .. }: Claims<SupabaseClaims>,
    State(social_feed_service): State<SocialFeedService>,
    method: Method,
    Path(path): Path<String>,
    RawQuery(query): RawQuery,
    body: Option<Json<Value>>,
) -> Result<impl IntoResponse, CadenzaError> {
    let resp = social_feed_service
        .forward(
            method,
            &path,
            query.as_deref(),
            body.map(|Json(body)| body),
            &claims.user_id.to_string(),
        )
        .await?;

    let status = resp.status();
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json")
        .to_owned();
    let body = resp
        .bytes()
        .await
        .map_err(|err| CadenzaError::SocialFeedErr(err.to_string()))?;

    Ok((status, [(header::CONTENT_TYPE, content_type)], body))
}
