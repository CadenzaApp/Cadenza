use crate::{AppState, auth::SupabaseClaims};
use axum::{Router, extract::{Json, State}, routing::post};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde_json::Value;
use crate::db;


async fn run_json_query_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    json_query: Json<Value>
) -> axum::response::Result<String,String> {
    let json_resp = db::queries::run_json_query(&db, &json_query, claims.user_id).await?;
    Ok(json_resp.to_string())
}

pub fn get_queries_router() -> Router<AppState> {
    Router::new()
        .route("/", post(run_json_query_handler))
}
