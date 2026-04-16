use std::collections::{HashMap, HashSet};

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
/// [
///    {
///        "song_id": ...,
///        "tags": [ 1, 2, 3, ... ],
///    },
///    ...
/// ]
/// ```
async fn run_json_query_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    json_query: Json<Value>,
) -> axum::response::Result<String, String> {
    let matched_songs_and_tags = db::queries::run_json_query(&db, &json_query, claims.user_id).await?;
    let mut songs: Vec<i64> = matched_songs_and_tags.keys().copied().collect();

    let mut mentioned_tags = HashSet::new();
    get_mentioned_tags(&json_query, &mut mentioned_tags);

    // song id -> its relevancy score (# of mentioned tags it has)
    let mut relevancies: HashMap<i64, usize> = HashMap::new();
    for song in &songs {
        match relevancies.get_mut(song) {
            Some(relevance) => { *relevance += 1; },
            None => { relevancies.insert(*song, 1); } 
        }
    }

    // order songs by relevancy
    songs.sort_by_key(|song| relevancies.get(song).unwrap());

    // construct json response
    let mut response = json!([]);
    let response_arr = response.as_array_mut().unwrap();
    for song in songs {
        let tags: Vec<i64> = matched_songs_and_tags.get(&song).unwrap().iter().copied().collect();
        response_arr.push(
            json!({
                "song_id": song,
                "tags": tags
            })
        );
    }

    Ok(response.to_string())
}

/// Returns a set of all the tags mentioned in the query.
fn get_mentioned_tags(query: &Value, out: &mut HashSet<i64>) {
    match query {
        Value::Object(obj) => {
            for child in ["not", "and", "or"] {
                if let Some(child) = obj.get(child) {
                    get_mentioned_tags(child, out);
                }
            }
        },
        Value::Array(arr) => {
            for child in arr {
                get_mentioned_tags(child, out);
            }
        },
        Value::Number(tag_id) => {
            if let Some(tag_id) = tag_id.as_i64() {
                out.insert(tag_id);
            }
        },
        _ => {}
    }
}


pub fn get_queries_router() -> Router<AppState> {
    Router::new().route("/", post(run_json_query_handler))
}
