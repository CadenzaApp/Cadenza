use std::fmt::Display;

use sea_orm::{DatabaseConnection, FromQueryResult};
use sea_orm::{DbBackend, Statement};
use serde_json::{Value, json};

#[derive(Debug, FromQueryResult)]
struct SongsAndTags {
    song_id: i64,
    tag_id: i64,
    tag_name: String,
}

/// Returns JSON response listing matching songs from the given query.
///
/// JSON return value format:
/// ```json
/// {
///    "song id": {
///        "name": ...    ( TODO: song/duration fields don't exist yet)
///        "duration": ...
///        "tags": [
///            {
///                "id": ..
///                "name": ..
///            }
///        ]
///    },
///    ...
///}
/// ```
pub async fn run_json_query(
    db: &DatabaseConnection,
    json_query: &Value,
    user_id: impl Display,
) -> Result<Value, String> {
    let songs_and_tags = SongsAndTags::find_by_statement(Statement::from_string(
        DbBackend::Postgres,
        decode_query(json_query, user_id)?,
    ))
    .all(db)
    .await
    .map_err(|e| e.to_string())?;

    let mut response = json!({});
    let response_obj = response.as_object_mut().unwrap();

    // construct json response
    for row in songs_and_tags {
        match response_obj.get_mut(&row.song_id.to_string()) {
            None => {
                // song isn't in response yet, add it
                response_obj.insert(
                    row.song_id.to_string(),
                    json!({
                        // TODO: other song metadata can go here e.g. name, duration
                    }),
                );
            }
            Some(song_obj) => {
                // this song was already in the response, so add this tag to its "tags" array
                let song_obj = song_obj.as_object_mut().unwrap();
                let tags_arr = song_obj.get_mut("tags").unwrap().as_array_mut().unwrap();
                tags_arr.push(json!({
                    "id": row.tag_id,
                    "name": row.tag_name
                }));
            }
        }
    }

    Ok(response)
}

enum BoolRelation {
    And,
    Or,
}
impl BoolRelation {
    fn inverted(self) -> Self {
        match self {
            BoolRelation::And => BoolRelation::Or,
            BoolRelation::Or => BoolRelation::And,
        }
    }
}

/// Converts the given JSON to a full SQL statement.
fn decode_query(json_query: &Value, user_id: impl Display) -> Result<String, String> {
    let where_clause = decode_query_json_node(json_query, false)?;
    Ok(format!(
        "SELECT * FROM applied_tags WHERE user_id = {} AND {};",
        user_id, where_clause
    ))
}

/// Converts the given JSON to a SQL snippet.
/// Applies Demorgan's Law when `inverted == true` to produce accurate SQL.
fn decode_query_json_node(curr: &Value, inverted: bool) -> Result<String, String> {
    if curr.is_string() {
        return match inverted {
            false => Ok(format!("tag_id = {}", curr)),
            true => Ok(format!("tag_id != {}", curr)),
        };
    }

    if curr.is_object() {
        if let Some(child) = curr.get("not") {
            // recur on the child, adding an inversion
            return decode_query_json_node(child, !inverted);
        }
        if let Some(child) = curr.get("and") {
            return decode_query_arr(child, BoolRelation::And, inverted);
        }
        if let Some(child) = curr.get("or") {
            return decode_query_arr(child, BoolRelation::Or, inverted);
        }

        return Err(format!(
            "error decoding query: this object is missing an 'and' or 'or' field: {}",
            curr
        ));
    }

    Err(format!(
        "error decoding query: expected string or object, got: {:?}",
        curr
    ))
}

/// Converts the given JSON arr to a SQL snippet, joining child SQL snippets with AND/OR depending on `bool_relation`.
/// Applies Demorgan's Law when `inverted == true` to produce accurate SQL.
fn decode_query_arr(
    arr: &Value,
    mut bool_relation: BoolRelation,
    inverted: bool,
) -> Result<String, String> {
    match arr.as_array() {
        None => Err(format!(
            "error decoding query: expected array, got: {:?}",
            arr
        )),
        Some(arr) => {
            let mut child_strs = Vec::with_capacity(arr.len());

            // recur on children to get their decoded strs
            for child in arr {
                match decode_query_json_node(child, inverted) {
                    Err(msg) => return Err(msg),
                    Ok(child_str) => child_strs.push(child_str),
                }
            }

            // join child strs and surround with parentheses before returning
            if inverted {
                bool_relation = bool_relation.inverted()
            }
            let joined_child_strs = child_strs
                .join(match bool_relation {
                    BoolRelation::And => " AND ",
                    BoolRelation::Or => " OR ",
                })
                .to_string();

            Ok(format!("({})", joined_child_strs))
        }
    }
}
