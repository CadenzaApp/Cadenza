use crate::entity::prelude::*;

use sea_orm::{Database, EntityTrait};
use std::env;

/// Returns the first student's name and major from the database.
/// Just an example function to help me get practice with SeaORM, obviously getting deleted later
/// # Example
/// ```rs
/// assert_eq!(
///     get_first_student(),
///     "Name: David Cosby, Major: Computer Science".to_string()
/// );
/// ```
pub async fn get_first_student() -> String {
    let db_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let db = Database::connect(db_url)
        .await
        .expect("Failed to connect to database");

    let result = Students::find()
        .find_also_related(Majors)
        .one(&db)
        .await
        .expect("Failed to query database");

    if let Some((student, major)) = result {
        let name = student.name.unwrap_or_else(|| "Unknown".to_string());
        let major_name = major
            .and_then(|m| m.major_name)
            .unwrap_or_else(|| "Unknown".to_string());

        format!("Name: {}, Major: {}", name, major_name)
    } else {
        println!("No students found.");
        "No students found.".to_string()
    }
}
