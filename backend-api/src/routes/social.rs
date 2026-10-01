use crate::{AppState, auth::SupabaseClaims};
use axum::{
    Json, Router,
    extract::{Path, Query, RawQuery, Request, State},
    http::{Method, header},
    routing::{any, get},
};
use axum_jwt_auth::Claims;
use reqwest::StatusCode;
use serde_json::{Value, json};

const SOCIAL_SERVICE_URL: &'static str = "http://localhost:3001";

/// Forwards all /social/... requests to the social feed service,
/// putting user id in query params or request body
pub fn get_social_router() -> Router<AppState> {
    Router::new().route(
        "/{*path}",
        any(
            async |Claims { claims, .. }: Claims<SupabaseClaims>,
                   State(http_client): State<reqwest::Client>,
                   method: Method,
                   Path(path): Path<String>,
                   RawQuery(query): RawQuery,
                   body: Option<Json<Value>>| {
                let user_id = claims.user_id.to_string();

                let mut url = format!("{SOCIAL_SERVICE_URL}/{path}");
                match query {
                    Some(query) => {
                        url.push_str(&format!("?{query}"));
                        if method == Method::GET {
                            url.push_str(&format!("&user_id={user_id}"));
                        }
                    }
                    None => {
                        if method == Method::GET {
                            url.push_str(&format!("?user_id={user_id}"));
                        }
                    }
                }
                let mut req = http_client.request(method.clone(), url);

                match method {
                    Method::GET => {}
                    _ => {
                        req = req.header("Content-Type", "application/json");
                        match body {
                            Some(body) => match body.as_object() {
                                Some(json) => {
                                    let mut json = json.clone();
                                    json.insert("user_id".into(), user_id.into());
                                    let json = Value::Object(json);
                                    req = req.body(serde_json::to_vec(&json).unwrap());
                                }
                                None => {
                                    return (
                                        StatusCode::UNPROCESSABLE_ENTITY,
                                        [(header::CONTENT_TYPE, "text/plain")],
                                        "req body must be a json object".to_string(),
                                    );
                                }
                            },
                            None => {
                                req = req.body(format!("{{ \"user_id\": \"{}\" }}", user_id));
                            }
                        }
                    }
                };

                match req.send().await {
                    Ok(resp) => (
                        resp.status(),
                        [(header::CONTENT_TYPE, "application/json")],
                        resp.text().await.unwrap_or("".into()),
                    ),
                    Err(err) => (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        [(header::CONTENT_TYPE, "text/plain")],
                        err.to_string(),
                    ),
                }
            },
        ),
    )
}
