use std::collections::{HashMap, HashSet};

use sea_orm::prelude::Uuid;
use sea_orm::{DatabaseConnection, FromQueryResult};
use sea_orm::{DbBackend, Statement};

use crate::err::CadenzaError;

#[derive(Debug, FromQueryResult)]
struct SongTagPair {
    song_id: String,
    tag_id: Option<i64>,
}

/// Returns hashmap of (matched song id) -> (its tag ids)
pub async fn run_json_query(
    db: &DatabaseConnection,
    json_query: &serde_json::Value,
    user_id: Uuid,
    candidate_song_ids: Option<&[String]>,
) -> Result<HashMap<String, HashSet<i64>>, CadenzaError> {
    if candidate_song_ids.is_some_and(|song_ids| song_ids.is_empty()) {
        return Ok(HashMap::new());
    }

    let user_id = sea_query::Value::Uuid(Some(user_id));
    let (sql, values) = decode_query(json_query, user_id, candidate_song_ids)?;

    let song_tag_pairs = SongTagPair::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        values,
    ))
    .all(db)
    .await?;

    let mut res: HashMap<String, HashSet<i64>> = HashMap::new();

    for row in song_tag_pairs {
        let tags = res.entry(row.song_id).or_default();
        if let Some(tag_id) = row.tag_id {
            tags.insert(tag_id);
        }
    }

    Ok(res)
}

enum BoolRelation {
    And,
    Or,
}

/// Converts the given JSON to a full SQL statement and its values
fn decode_query(
    json_query: &serde_json::Value,
    user_id: sea_query::Value,
    candidate_song_ids: Option<&[String]>,
) -> Result<(String, Vec<sea_query::Value>), CadenzaError> {
    let first_tag_param = if candidate_song_ids.is_some() { 3 } else { 2 };
    let (where_clause, mut child_values, _) = decode_query_json_node(json_query, first_tag_param)?;

    let (sql, mut values) = if let Some(song_ids) = candidate_song_ids {
        (
            format!(
                r#"
                    SELECT query_songs.song_id, applied_tags.tag_id
                    FROM unnest($2::text[]) AS query_songs(song_id)
                    LEFT JOIN user_tags_applied AS applied_tags
                        ON applied_tags.song_id=query_songs.song_id
                        AND applied_tags.user_id=$1
                    WHERE {}
                "#,
                where_clause
            ),
            vec![user_id, song_ids.to_vec().into()],
        )
    } else {
        (
            format!(
                r#"
                    SELECT query_songs.song_id, query_songs.tag_id
                    FROM user_tags_applied AS query_songs
                    WHERE query_songs.user_id=$1 AND {}
                "#,
                where_clause
            ),
            vec![user_id],
        )
    };

    values.append(&mut child_values);
    Ok((sql, values))
}

/// Converts the given JSON to a SQL snippet and its values.
/// Returns `(SQL snippet, values, next param_counter)`
fn decode_query_json_node(
    curr: &serde_json::Value,
    param_counter: usize,
) -> Result<(String, Vec<sea_query::Value>, usize), CadenzaError> {
    if let Some(tag_id) = curr.as_number() {
        let exists_clause = format!(
            r#"
                EXISTS (
                    SELECT * FROM user_tags_applied AS exists_check
                    WHERE exists_check.song_id=query_songs.song_id AND exists_check.user_id = $1 AND exists_check.tag_id=${}
                )
            "#,
            param_counter,
        );

        let vals: Vec<sea_query::Value> = vec![sea_query::Value::BigInt(tag_id.as_i64())];

        return Ok((exists_clause, vals, param_counter + 1));
    }

    if curr.is_object() {
        if let Some(child) = curr.get("not") {
            let (sql, values, next_param_counter) = decode_query_json_node(child, param_counter)?;
            return Ok((format!("NOT ({})", sql), values, next_param_counter));
        }
        if let Some(child) = curr.get("and") {
            return decode_query_arr(child, BoolRelation::And, param_counter);
        }
        if let Some(child) = curr.get("or") {
            return decode_query_arr(child, BoolRelation::Or, param_counter);
        }

        return Err(CadenzaError::QueryFormatError(format!(
            "this object is missing an 'and' or 'or' field: {}",
            curr
        )));
    }

    Err(CadenzaError::QueryFormatError(format!(
        "expected tag id or object, got: {:?}",
        curr
    )))
}

/// Converts the given JSON arr to a SQL snippet, joining child SQL snippets with AND/OR depending on `bool_relation`.
/// Returns `(SQL snippet, values, next param_counter)`
fn decode_query_arr(
    arr: &serde_json::Value,
    bool_relation: BoolRelation,
    mut param_counter: usize,
) -> Result<(String, Vec<sea_query::Value>, usize), CadenzaError> {
    match arr.as_array() {
        None => Err(CadenzaError::QueryFormatError(format!(
            "expected array, got: {:?}",
            arr
        ))),
        Some(arr) => {
            let mut child_snippets = Vec::with_capacity(arr.len());
            let mut child_values = Vec::with_capacity(arr.len() * 2);

            // recur on children to get their sql snippets
            for child in arr {
                let (sql, mut values, next_param_counter) =
                    decode_query_json_node(child, param_counter)?;
                child_snippets.push(sql);
                child_values.append(&mut values);
                param_counter = next_param_counter;
            }

            // join child strs and surround with parentheses before returning
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn candidate_query_starts_from_every_supplied_song() {
        let candidates = vec!["untagged-song".to_string(), "tagged-song".to_string()];
        let (sql, values) = decode_query(
            &json!({ "not": 7 }),
            sea_query::Value::Uuid(Some(Uuid::nil())),
            Some(&candidates),
        )
        .unwrap();

        assert!(sql.contains("FROM unnest($2::text[]) AS query_songs(song_id)"));
        assert!(sql.contains("LEFT JOIN user_tags_applied AS applied_tags"));
        assert!(sql.contains("NOT"));
        assert!(sql.contains("exists_check.tag_id=$3"));
        assert_eq!(values.len(), 3);
    }

    #[test]
    fn tagged_song_query_keeps_the_original_parameter_order() {
        let (sql, values) = decode_query(
            &json!({ "and": [7, 8] }),
            sea_query::Value::Uuid(Some(Uuid::nil())),
            None,
        )
        .unwrap();

        assert!(sql.contains("FROM user_tags_applied AS query_songs"));
        assert!(sql.contains("exists_check.tag_id=$2"));
        assert!(sql.contains("exists_check.tag_id=$3"));
        assert_eq!(values.len(), 3);
    }
}
