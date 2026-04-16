use crate::db;
use crate::{AppState, auth::SupabaseClaims};
use axum::{
    Router,
    extract::{Json, State},
    routing::post,
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde_json::{Value, json};

/// Returns JSON response listing matching songs from the given query.
///
/// JSON return value format:
/// ```json
/// {
///    "song id": {
///        "name": ...    ( TODO: song/duration fields don't exist yet)
///        "duration": ...
///        "tags": [ 1, 2, 3, ... ]
///    },
///    ...
///}
/// ```
async fn run_json_query_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    json_query: Json<Value>,
) -> axum::response::Result<String, String> {
    let song_tag_pairs = db::queries::run_json_query(&db, &json_query, claims.user_id).await?;
    println!("returned pairs:");
    dbg!(&song_tag_pairs);

    let mut response = json!({});
    let response_obj = response.as_object_mut().unwrap();

    // construct json response
    for row in song_tag_pairs {
        match response_obj.get_mut(&row.song_id.to_string()) {
            None => {
                // song isn't in response yet, add it
                response_obj.insert(
                    row.song_id.to_string(),
                    json!({
                        // TODO: other song metadata can go here e.g. name, duration
                        "tags": [ row.tag_id ]
                    }),
                );
            }
            Some(song_obj) => {
                // this song was already in the response, so add this tag to its "tags" array
                let song_obj = song_obj.as_object_mut().unwrap();
                let tags_arr = song_obj.get_mut("tags").unwrap().as_array_mut().unwrap();
                tags_arr.push(row.tag_id.into());
            }
        }
    }
    Ok(response.to_string())
}

pub fn get_queries_router() -> Router<AppState> {
    Router::new().route("/", post(run_json_query_handler))
}
