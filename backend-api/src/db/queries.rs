use std::fmt::Display;

use sea_orm::prelude::Uuid;
use sea_orm::{DatabaseConnection, FromQueryResult};
use sea_orm::{DbBackend, Statement};

use crate::models::tag;

#[derive(Debug, FromQueryResult)]
pub struct SongTagPair {
    pub song_id: i64,
    pub tag_id: i64,
}

/// Returns many matching `SongTagPair`
pub async fn run_json_query(
    db: &DatabaseConnection,
    json_query: &serde_json::Value,
    user_id: Uuid,
) -> Result<Vec<SongTagPair>, String> {
    println!("starting query: {}", json_query);

    let user_id = sea_query::Value::Uuid(Some(user_id));
    let (sql, values) = decode_query(json_query, user_id)?;

    SongTagPair::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        values,
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

/// Converts the given JSON to a full SQL statement and its values
fn decode_query(
    json_query: &serde_json::Value,
    user_id: sea_query::Value,
) -> Result<(String, Vec<sea_query::Value>), String> {
    let (where_clause, mut child_values, _) = decode_query_json_node(json_query, user_id.clone(), 2, false)?;

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
                WHERE songs.user_id=$1 AND {}
            ) AS matched_songs
            JOIN applied_tags ON matched_songs.song_id=applied_tags.song_id
            JOIN tags ON tags.tag_id=applied_tags.tag_id;
        "#,
        where_clause
    );
    println!("{}", sql);
    let mut values = vec![user_id];
    values.append(&mut child_values);
    println!("{:?}", values);
    Ok((sql, values))
}

/// Converts the given JSON to a SQL snippet and its values.
/// Returns `(SQL snippet, values, next param_counter)`
/// Applies Demorgan's Law when `inverted == true` to produce accurate SQL.
fn decode_query_json_node(
    curr: &serde_json::Value,
    user_id: sea_query::Value,
    param_counter: usize,
    inverted: bool,
) -> Result<(String, Vec<sea_query::Value>, usize), String> {
    if let Some(tag_id) = curr.as_number() {
        let mut exists_clause = format!(
            r#"
                EXISTS (
                    SELECT * FROM applied_tags AS exists_check 
                    WHERE exists_check.song_id=songs.song_id AND exists_check.user_id = ${} AND exists_check.tag_id = ${}
                )
            "#,
            param_counter,
            param_counter + 1
        );

        if inverted {
            exists_clause = format!("NOT {}", exists_clause);
        }

        let vals: Vec<sea_query::Value> = vec![user_id, sea_query::Value::BigInt(tag_id.as_i64())];

        return Ok((exists_clause, vals, param_counter + 2));
    }

    if curr.is_object() {
        if let Some(child) = curr.get("not") {
            // add another layer of inversion before recurring
            return decode_query_json_node(child, user_id.clone(), param_counter, !inverted);
        }
        if let Some(child) = curr.get("and") {
            return decode_query_arr(
                child,
                BoolRelation::And,
                user_id.clone(),
                param_counter,
                inverted,
            );
        }
        if let Some(child) = curr.get("or") {
            return decode_query_arr(
                child,
                BoolRelation::Or,
                user_id.clone(),
                param_counter,
                inverted,
            );
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
/// Returns `(SQL snippet, values, next param_counter)`
/// Applies Demorgan's Law when `inverted == true` to produce accurate SQL.
fn decode_query_arr(
    arr: &serde_json::Value,
    mut bool_relation: BoolRelation,
    user_id: sea_query::Value,
    mut param_counter: usize,
    inverted: bool,
) -> Result<(String, Vec<sea_query::Value>, usize), String> {
    match arr.as_array() {
        None => Err(format!(
            "error decoding query: expected array, got: {:?}",
            arr
        )),
        Some(arr) => {
            let mut child_snippets = Vec::with_capacity(arr.len());
            let mut child_values = Vec::with_capacity(arr.len() * 2);

            // recur on children to get their sql snippets
            for child in arr {
                let (sql, mut values, next_param_counter) =
                    decode_query_json_node(child, user_id.clone(), param_counter, inverted)?;
                child_snippets.push(sql);
                child_values.append(&mut values);
                param_counter = next_param_counter;
            }

            // join child strs and surround with parentheses before returning
            if inverted {
                bool_relation = bool_relation.inverted()
            }
            let joined_child_snippets = child_snippets
                .join(match bool_relation {
                    BoolRelation::And => " AND ",
                    BoolRelation::Or => " OR ",
                })
                .to_string();

            Ok((
                format!("({})", joined_child_snippets),
                child_values,
                param_counter,
            ))
        }
    }
}
