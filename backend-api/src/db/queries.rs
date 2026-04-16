use std::fmt::Display;

use sea_orm::{DatabaseConnection, FromQueryResult};
use sea_orm::{DbBackend, Statement};
use serde_json::Value;

#[derive(Debug, FromQueryResult)]
pub struct SongTagPair {
    pub song_id: i64,
    pub tag_id: i64,
    pub tag_name: String,
}

/// Returns many matching `SongTagPair`
pub async fn run_json_query(
    db: &DatabaseConnection,
    json_query: &Value,
    user_id: impl Display,
) -> Result<Vec<SongTagPair>, String> {
    println!("starting query: {}", json_query);

    SongTagPair::find_by_statement(Statement::from_string(
        DbBackend::Postgres,
        decode_query(json_query, &user_id)?,
    ))
    .all(db)
    .await
    .map_err(|e| e.to_string())
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
fn decode_query(json_query: &Value, user_id: &impl Display) -> Result<String, String> {
    let where_clause = decode_query_json_node(json_query, user_id, false)?;

    // this sql first gets all song ids that match the query,
    // then finds all tags related to those matched songs
    let sql = format!(
        r#"
            SELECT
                matched_songs.song_id AS song_id,
                tags.tag_id AS tag_id,
                tags.name AS tag_name
            FROM
            (
                SELECT songs.song_id AS song_id 
                FROM songs
                WHERE songs.user_id='{}' AND {}
            ) AS matched_songs
            JOIN applied_tags ON matched_songs.song_id=applied_tags.song_id
            JOIN tags ON tags.tag_id=applied_tags.tag_id;
        "#,
        user_id, where_clause
    );
    println!("{}", sql);
    Ok(sql)
}

/// Converts the given JSON to a SQL snippet.
/// Applies Demorgan's Law when `inverted == true` to produce accurate SQL.
fn decode_query_json_node(
    curr: &Value,
    user_id: &impl Display,
    inverted: bool,
) -> Result<String, String> {
    if let Some(tag_id) = curr.as_number() {
        let exists_clause = format!(
            r#"
                EXISTS (
                    SELECT * FROM applied_tags AS exists_check 
                    WHERE exists_check.song_id=songs.song_id AND exists_check.user_id = '{}' AND exists_check.tag_id = {}
                )
            "#,
            user_id, tag_id
        );
        return match inverted {
            false => Ok(exists_clause),
            true => Ok(format!("NOT {}", exists_clause)),
        };
    }

    if curr.is_object() {
        if let Some(child) = curr.get("not") {
            // add another layer of inversion before recurring
            return decode_query_json_node(child, user_id, !inverted);
        }
        if let Some(child) = curr.get("and") {
            return decode_query_arr(child, BoolRelation::And, user_id, inverted);
        }
        if let Some(child) = curr.get("or") {
            return decode_query_arr(child, BoolRelation::Or, user_id, inverted);
        }

        return Err(format!(
            "error decoding query: this object is missing an 'and' or 'or' field: {}",
            curr
        ));
    }

    Err(format!(
        "error decoding query: expected tag id or object, got: {:?}",
        curr
    ))
}

/// Converts the given JSON arr to a SQL snippet, joining child SQL snippets with AND/OR depending on `bool_relation`.
/// Applies Demorgan's Law when `inverted == true` to produce accurate SQL.
fn decode_query_arr(
    arr: &Value,
    mut bool_relation: BoolRelation,
    user_id: &impl Display,
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
                match decode_query_json_node(child, user_id, inverted) {
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
