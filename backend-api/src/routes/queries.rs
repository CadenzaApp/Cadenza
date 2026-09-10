use std::collections::{HashMap, HashSet};

use crate::db;
use crate::err::CadenzaError;
use crate::{AppState, auth::SupabaseClaims};
use axum::extract::Query;
use axum::routing::get;
use axum::{
    Router,
    extract::State,
};
use axum_jwt_auth::Claims;
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
struct QueryResultsParams {
    query_id: Option<i64>,
    q: Option<String>,
}
impl QueryResultsParams {
    fn into_json_query(self) -> Result<Value, CadenzaError> {
        if let Some(q) = self.q {
            return match serde_json::from_str(&q) {
                Ok(json_query) => Ok(json_query),
                Err(_) => Err(CadenzaError::QueryFormatError("invalid json".to_string()))
            }
        }

        todo!("get query json from query id (a saved query)")
    }
}

/// Returns JSON array of ids of matching songs from the given query.
///
/// JSON return value format:
/// ```json
/// [ 1, 2, 3, ... ]
/// ```
async fn query_results_handler(
    State(db): State<DatabaseConnection>,
    Claims { claims, .. }: Claims<SupabaseClaims>,
    Query(params): Query<QueryResultsParams>,
) -> Result<String, CadenzaError> {
    let json_query = params.into_json_query()?;

    let matched_songs_and_tags =
        db::queries::run_json_query(&db, &json_query, claims.user_id).await?;

    let mut mentioned_tags = HashSet::new();
    get_mentioned_tags(&json_query, &mut mentioned_tags);

    // song id -> its relevancy score (# of mentioned tags it has)
    let mut relevancies: HashMap<&str, i32> = HashMap::new();
    for (song, tags) in &matched_songs_and_tags {
        let mut score = 0;
        for tag in tags {
            if mentioned_tags.contains(tag) {
                score += 1;
            }
        }
        relevancies.insert(song, score);
    }

    // order songs by relevancy
    let mut song_ids: Vec<&String> = matched_songs_and_tags.keys().collect();
    song_ids.sort_by_key(|song| -relevancies.get(&song.as_str()).unwrap());

    // construct json response
    let mut response = json!([]);
    let response_arr = response.as_array_mut().unwrap();
    for song_id in song_ids {
        response_arr.push(song_id.as_str().into());
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
        }
        Value::Array(arr) => {
            for child in arr {
                get_mentioned_tags(child, out);
            }
        }
        Value::Number(tag_id) => {
            if let Some(tag_id) = tag_id.as_i64() {
                out.insert(tag_id);
            }
        }
        _ => {}
    }
}

pub fn get_queries_router() -> Router<AppState> {
    Router::new().route("/results", get(query_results_handler))
}
