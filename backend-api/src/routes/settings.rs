use crate::{
    AppState,
    auth::SupabaseClaims,
    db::settings::{get_settings, update_settings},
    err::CadenzaError,
    routes::json::settings::{PatchUserSettings, UserSettings},
};
use axum::{
    Json, Router,
    extract::State,
    routing::{get, patch},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;

/// Returns the signed-in user's settings. A user who has never changed one gets
/// the defaults.
///
/// JSON return value format:
/// ```json
/// {
///   "theme_mode": "system",
///   "accent_color": null,
///   "background_color": null,
///   "glass_tint": null,
///   "glass_style": "clear",
///   "accent_swatches": null,
///   "glass_tint_swatches": null,
///   "tag_color_swatches": null,
///   "background_swatches": null,
///   "hide_explicit": false,
///   "show_suggested_tags": true
/// }
/// ```
async fn get_settings_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<UserSettings>, CadenzaError> {
    let model = get_settings(&db, claims.user_id).await?;
    Ok(Json(UserSettings::from(model)))
}

/// Changes any subset of the signed-in user's settings and returns all of them.
/// A missing key is left alone. `null` resets `accent_color`,
/// `background_color`, or `glass_tint` to the default, and a swatch list to the
/// presets. `InvalidRequestBody` for an empty body or a bad value.
///
/// JSON return value format:
/// ```json
/// {
///   "theme_mode": "dark",
///   "accent_color": "#ff3b30",
///   "background_color": null,
///   "glass_tint": null,
///   "glass_style": "clear",
///   "accent_swatches": ["#ff9f0a", null, "#0a84ff"],
///   "glass_tint_swatches": null,
///   "tag_color_swatches": null,
///   "background_swatches": null,
///   "hide_explicit": true,
///   "show_suggested_tags": true
/// }
/// ```
async fn patch_settings_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<PatchUserSettings>,
) -> Result<Json<UserSettings>, CadenzaError> {
    let model = update_settings(&db, claims.user_id, payload.into()).await?;
    Ok(Json(UserSettings::from(model)))
}

pub fn get_settings_router() -> Router<AppState> {
    Router::new()
        .route("/", get(get_settings_handler))
        .route("/", patch(patch_settings_handler))
}
