//! Pieces shared by the things several people edit together: shared
//! playlists and live sessions. Each keeps an ordered list of entries in a
//! `position` column, scoped by its own id.

use sea_orm::{ConnectionTrait, Value};

use crate::db::stmt;
use crate::err::CadenzaError;

/// The longest name a playlist or session takes.
const MAX_NAME_CHARS: usize = 100;

/// `name` trimmed, or an error naming `what` when it is empty or too long.
pub fn check_name(name: &str, what: &str) -> Result<String, CadenzaError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(CadenzaError::InvalidRequestBody(format!(
            "a {what} name is 1 to {MAX_NAME_CHARS} characters"
        )));
    }
    Ok(name.to_owned())
}

/// `ids` with `entry_id` moved to `to`, clamped to the ends. `None` when it is
/// not there.
pub fn moved_order(ids: &[i64], entry_id: i64, to: i32) -> Option<Vec<i64>> {
    let from = ids.iter().position(|id| *id == entry_id)?;
    let mut order = ids.to_vec();
    let moved = order.remove(from);
    let to = (to.max(0) as usize).min(order.len());
    order.insert(to, moved);
    Some(order)
}

/// Writes positions 0..n to `table`'s entries in `order`, among those whose
/// `scope` column is `scope_id`.
pub async fn write_order<C: ConnectionTrait>(
    db: &C,
    table: &str,
    scope: &str,
    scope_id: impl Into<Value>,
    order: &[i64],
) -> Result<(), CadenzaError> {
    db.execute_raw(stmt(
        &format!(
            "UPDATE {table} e SET position = t.ord::int - 1
             FROM unnest($2::bigint[]) WITH ORDINALITY AS t(entry_id, ord)
             WHERE e.{scope} = $1 AND e.entry_id = t.entry_id"
        ),
        vec![scope_id.into(), order.to_vec().into()],
    ))
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moving_an_entry_reorders_and_clamps() {
        let ids = [10, 20, 30, 40];
        assert_eq!(moved_order(&ids, 10, 2).unwrap(), vec![20, 30, 10, 40]);
        assert_eq!(moved_order(&ids, 40, 0).unwrap(), vec![40, 10, 20, 30]);
        assert_eq!(moved_order(&ids, 20, 99).unwrap(), vec![10, 30, 40, 20]);
        assert_eq!(moved_order(&ids, 20, -5).unwrap(), vec![20, 10, 30, 40]);
        assert!(moved_order(&ids, 99, 0).is_none());
    }

    #[test]
    fn names_are_trimmed_and_bounded() {
        assert_eq!(check_name("  Road trip ", "playlist").unwrap(), "Road trip");
        assert!(check_name("   ", "playlist").is_err());
        assert!(check_name(&"x".repeat(101), "session").is_err());
    }
}
