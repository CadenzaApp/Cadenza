use crate::{
    AppState,
    auth::SupabaseClaims,
    db::platform_roles,
    err::CadenzaError,
    routes::json::admin::{ChangeRole, RoleAccess},
};
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::get,
};
use axum_jwt_auth::Claims;
use sea_orm::{DatabaseConnection, prelude::Uuid};

/// Returns the caller's role and dashboard capability.
/// Example: {"role":"admin","dashboard":true,"allowed_roles":[]}
async fn me(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<RoleAccess>, CadenzaError> {
    Ok(Json(
        platform_roles::access(&db, claims.user_id, claims.user_id).await?,
    ))
}
/// Returns a target's role and the transitions available to the caller.
/// Example: {"role":"user","dashboard":false,"allowed_roles":["user","moderator"]}
async fn target(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(user): Path<Uuid>,
) -> Result<Json<RoleAccess>, CadenzaError> {
    Ok(Json(
        platform_roles::access(&db, claims.user_id, user).await?,
    ))
}
/// Changes a non-owner's role after checking both current roles transactionally.
/// Returns {"updated":true}.
async fn change(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(user): Path<Uuid>,
    Json(body): Json<ChangeRole>,
) -> Result<Json<serde_json::Value>, CadenzaError> {
    platform_roles::change(&db, claims.user_id, user, body.expected_role, body.role).await?;
    Ok(Json(serde_json::json!({"updated": true})))
}
pub fn get_admin_router() -> Router<AppState> {
    Router::new()
        .route("/metrics", get(metrics))
        .route("/access", get(me))
        .route("/users/{user}/role", get(target).patch(change))
}

async fn metrics(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    axum::extract::Query(params): axum::extract::Query<crate::routes::json::admin::MetricsParams>,
) -> Result<Json<serde_json::Value>, CadenzaError> {
    if !platform_roles::role(&db, claims.user_id).await?.dashboard() {
        return Err(CadenzaError::Forbidden(
            "Admin dashboard access required".into(),
        ));
    }
    Ok(Json(crate::services::admin::metrics(&db, params).await?))
}
