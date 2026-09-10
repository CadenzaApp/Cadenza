use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        self,
        tags::{get_user_tags_on_song},
    },
    err::CadenzaError,
    routes::json::{tag::AppliedTag, vec_into},
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{delete, get, patch, post},
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;


#[derive(Deserialize)]
pub struct GetTagsOnSongQueryParams {
    song_id: String,
}

async fn get_tags_on_song_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<GetTagsOnSongQueryParams>,
) -> Result<Json<Vec<AppliedTag>>, CadenzaError> {
    let user_tags = get_user_tags_on_song(&db, claims.user_id, &params.song_id).await?;
    Ok(Json(vec_into(user_tags)))
}


#[derive(Deserialize)]
pub struct ApplyTagPayload {
    song_id: String,
    tag_id: i64,
    /// Only meaningful for attribute tags. Omitting it applies the tag without
    /// a value, which is always allowed.
    #[serde(default)]
    value: Option<String>,
}

async fn apply_user_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<ApplyTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::apply_user_tag(
        db,
        claims.user_id,
        payload.song_id,
        payload.tag_id,
        payload.value,
    )
    .await
}

#[derive(Deserialize)]
pub struct SetTagValuePayload {
    song_id: String,
    tag_id: i64,
    /// `null` clears the value while leaving the tag applied.
    #[serde(default)]
    value: Option<String>,
}

async fn set_user_tag_value_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<SetTagValuePayload>,
) -> Result<(), CadenzaError> {
    db::tags::set_user_tag_value(
        db,
        claims.user_id,
        payload.song_id,
        payload.tag_id,
        payload.value,
    )
    .await
}

#[derive(Deserialize)]
pub struct UnapplyTagPayload {
    song_id: String,
    tag_id: i64,
}
async fn unapply_user_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<UnapplyTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::unapply_user_tag(db, claims.user_id, payload.song_id, payload.tag_id).await
}


pub fn get_songs_router() -> Router<AppState> {
    Router::new()
        .route("/tags", get(get_tags_on_song_handler))
        .route("/tags", post(apply_user_tag_handler))
        .route("/tags", patch(set_user_tag_value_handler))
        .route("/tags", delete(unapply_user_tag_handler))
}
