use sea_orm::prelude::Uuid;
use sea_orm::{DatabaseConnection, DbBackend, FromQueryResult, Statement};
use sea_query::Value;

use crate::err::CadenzaError;

#[derive(Debug, FromQueryResult)]
struct SongTagName {
    name: String,
}

pub async fn get_user_tag_names_for_song(
    db: &DatabaseConnection,
    user_id: Uuid,
    song_id: &str,
) -> Result<Vec<String>, CadenzaError> {
    let rows = SongTagName::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r#"
            SELECT DISTINCT tags.name
            FROM applied_tags
            INNER JOIN tags ON tags.tag_id = applied_tags.tag_id
            WHERE applied_tags.user_id = $1
              AND tags.user_id = $1
              AND applied_tags.song_id = $2
            ORDER BY tags.name ASC
        "#,
        vec![
            Value::Uuid(Some(user_id)),
            Value::String(Some(song_id.to_string())),
        ],
    ))
    .all(db)
    .await?;

    Ok(rows.into_iter().map(|row| row.name).collect())
}
