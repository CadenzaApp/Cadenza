use axum::{
    Json, Router,
    extract::{Path, State},
    routing::post,
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;

use crate::{
    AppState,
    auth::SupabaseClaims,
    err::CadenzaError,
    routes::json::invite::Redeemed,
    services::{
        invite_codes::{RedeemLimiter, accept_invite},
        realtime::SharedEventBus,
    },
};

/// Redeems an invite code and joins the shared playlist or live session it
/// points at. Case, spaces, and dashes in the code do not matter. 404
/// `InviteCodeInvalid` for a code that does not exist, expired, ran out, or was
/// revoked. 429 `TooManyRequests` past 10 tries a minute. 403 for someone the
/// session host removed.
///
/// ```json
/// { "kind": "live_session", "id": "6f1c...-..." }
/// ```
async fn redeem_handler(
    State(db): State<DatabaseConnection>,
    State(bus): State<SharedEventBus>,
    State(limiter): State<RedeemLimiter>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Path(code): Path<String>,
) -> Result<Json<Redeemed>, CadenzaError> {
    let target = accept_invite(&db, &bus, &limiter, claims.user_id, &code).await?;
    Ok(Json(target.into()))
}

pub fn get_invites_router() -> Router<AppState> {
    Router::new().route("/{code}/redeem", post(redeem_handler))
}
