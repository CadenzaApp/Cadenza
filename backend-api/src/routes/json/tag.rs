use serde::Serialize;

use crate::db::entity::*;

#[derive(Serialize)]
pub struct Tag {
    tag_id: i64,
    name: String,
    color: String,
}

impl From<tags::Model> for Tag {
    fn from(value: tags::Model) -> Self {
        Self {
            tag_id: value.tag_id,
            color: value.color,
            name: value.name,
        }
    }
}
