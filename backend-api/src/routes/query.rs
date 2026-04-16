use crate::auth::SupabaseClaims;
use axum::extract::{Json, State};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde_json::Value;
use crate::db;


pub async fn run_json_query_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    json_query: Json<Value>
) -> Result<Value, String> {
    db::queries::run_json_query(&db, &json_query, claims.user_id).await
}
