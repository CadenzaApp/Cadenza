use crate::{
    AppState,
    auth::SupabaseClaims,
    db::profile::{create_profile, get_profile, update_profile},
    db::user_data::get_user_data,
    err::CadenzaError,
    routes::json::{profile::Profile, user_data::UserDataCount},
};
use axum::{
    Json, Router,
    extract::State,
    routing::{get, patch, post},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;

/// Returns the signed-in user's profile. 404 when they have none.
///
/// JSON return value format:
/// ```json
/// { "uid": "11111111-1111-1111-1111-111111111111", "username": "alice", "bio": "hi" }
/// ```
async fn get_profile_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<Profile>, CadenzaError> {
    let model = get_profile(&db, claims.user_id).await?;
    Ok(Json(Profile::from(model)))
}

/// Returns a count of everything Cadenza stores about the signed-in user, for
/// the Your data screen. `section` groups the rows; `unit` is `count` or
/// `milliseconds`, the same as an analytics metric.
///
/// JSON return value format:
/// ```json
/// [
///   { "name": "songs", "section": "library", "description": "Songs in your library", "unit": "count", "value": 1204 },
///   { "name": "listening_ms", "section": "listening", "description": "Listening time", "unit": "milliseconds", "value": 71280000 }
/// ]
/// ```
async fn get_user_data_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
) -> Result<Json<Vec<UserDataCount>>, CadenzaError> {
    let counts = get_user_data(&db, claims.user_id).await?;
    Ok(Json(counts.into_iter().map(UserDataCount::from).collect()))
}

#[derive(Deserialize, Default)]
pub struct CreateProfilePayload {
    /// Defaults to the email local part when left out.
    username: Option<String>,
    /// Defaults to empty when left out.
    bio: Option<String>,
}

/// Creates the signed-in user's profile. Username defaults to everything before
/// `@` in their email. Returns the new profile, or `ProfileAlreadyExists` /
/// `UsernameAlreadyTaken`. An empty body is the same as `{}`.
///
/// JSON return value format:
/// ```json
/// { "uid": "11111111-1111-1111-1111-111111111111", "username": "alice", "bio": "" }
/// ```
async fn create_profile_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    payload: Option<Json<CreateProfilePayload>>,
) -> Result<Json<Profile>, CadenzaError> {
    let payload = payload.map(|Json(p)| p).unwrap_or_default();
    let model = create_profile(
        &db,
        claims.user_id,
        &claims.email,
        payload.username.as_deref(),
        payload.bio.as_deref(),
    )
    .await?;
    Ok(Json(Profile::from(model)))
}

#[derive(Deserialize)]
pub struct UpdateProfilePayload {
    username: Option<String>,
    bio: Option<String>,
}

/// Changes the signed-in user's username and/or bio. At least one field must be
/// set. Returns the updated profile, or `NotFound` / `UsernameAlreadyTaken`.
///
/// JSON return value format:
/// ```json
/// { "uid": "11111111-1111-1111-1111-111111111111", "username": "alice", "bio": "hi" }
/// ```
async fn update_profile_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<UpdateProfilePayload>,
) -> Result<Json<Profile>, CadenzaError> {
    let model = update_profile(
        &db,
        claims.user_id,
        payload.username.as_deref(),
        payload.bio.as_deref(),
    )
    .await?;
    Ok(Json(Profile::from(model)))
}

pub fn get_profile_router() -> Router<AppState> {
    Router::new()
        .route("/", get(get_profile_handler))
        .route("/", post(create_profile_handler))
        .route("/", patch(update_profile_handler))
        .route("/data", get(get_user_data_handler))
}
