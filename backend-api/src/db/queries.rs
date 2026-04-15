use std::fmt::Display;

use sea_orm::sea_query::raw_sql;
use sea_orm::DbBackend;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, DatabaseConnection, DbErr, EntityTrait, QueryFilter,
};
use sea_orm::{ColumnTrait, ModelTrait, prelude::Uuid};
use serde_json::Value;

use crate::db::entity::applied_tags;

pub fn run_json_query(json_query: &Value, user_id: impl Display) -> Result<(), String> {
    let json_sql = decode_query(json_query, user_id)?;

    

    Ok(())
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

/// converts json query into sql
fn decode_query(json_query: &Value, user_id: impl Display) -> Result<String, String> {
    let where_clause = decode_query_json_node(json_query, false)?;
    Ok(format!(
        "SELECT * FROM applied_tags WHERE user_id = {} AND {};",
        user_id, where_clause
    ))
}

/// demorgan's law!!
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
