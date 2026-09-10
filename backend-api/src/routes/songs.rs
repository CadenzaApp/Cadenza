use crate::{
    AppState,
    auth::SupabaseClaims,
    db::{
        self,
        tags::{get_user_tags_on_song},
    },
    err::CadenzaError,
    routes::json::{tag::Tag, vec_into},
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{delete, get, post},
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
) -> Result<Json<Vec<Tag>>, CadenzaError> {
    let user_tags = get_user_tags_on_song(&db, claims.user_id, &params.song_id).await?;
    Ok(Json(vec_into(user_tags)))
}


#[derive(Deserialize)]
pub struct ApplyTagPayload {
    song_id: String,
    tag_id: i64,
}

async fn apply_user_tag_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Json(payload): Json<ApplyTagPayload>,
) -> Result<(), CadenzaError> {
    db::tags::apply_user_tag(db, claims.user_id, payload.song_id, payload.tag_id).await
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
        .route("/tags", delete(unapply_user_tag_handler))
}
