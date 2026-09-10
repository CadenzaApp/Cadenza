use serde::{Deserialize, Serialize};

use crate::db::entity::sea_orm_active_enums::TagType as DbTagType;
use crate::db::entity::*;

/// What kind of value a tag can hold. `Basic` tags carry no value and behave
/// exactly like tags did before attribute tags existed.
///
/// This mirrors the generated `sea_orm_active_enums::TagType`, which cannot
/// derive serde without regenerating every entity with `--with-serde`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TagType {
    #[default]
    Basic,
    Text,
    Datetime,
    Number,
    Checkbox,
}

impl From<DbTagType> for TagType {
    fn from(value: DbTagType) -> Self {
        match value {
            DbTagType::Basic => Self::Basic,
            DbTagType::Text => Self::Text,
            DbTagType::Datetime => Self::Datetime,
            DbTagType::Number => Self::Number,
            DbTagType::Checkbox => Self::Checkbox,
        }
    }
}

impl From<TagType> for DbTagType {
    fn from(value: TagType) -> Self {
        match value {
            TagType::Basic => Self::Basic,
            TagType::Text => Self::Text,
            TagType::Datetime => Self::Datetime,
            TagType::Number => Self::Number,
            TagType::Checkbox => Self::Checkbox,
        }
    }
}

#[derive(Serialize)]
pub struct Tag {
    id: i64,
    name: String,
    color: String,
    r#type: TagType,
}

impl From<tags::Model> for Tag {
    fn from(value: tags::Model) -> Self {
        Self {
            id: value.tag_id,
            color: value.color,
            name: value.name,
            r#type: value.r#type.into(),
        }
    }
}

/// A tag as it appears on a song, carrying the value applied with it.
/// `value` is always `null` for basic tags, and may be `null` for an attribute
/// tag that was applied without one.
#[derive(Serialize)]
pub struct AppliedTag {
    #[serde(flatten)]
    tag: Tag,
    value: Option<String>,
}

impl From<(tags::Model, Option<String>)> for AppliedTag {
    fn from((tag, value): (tags::Model, Option<String>)) -> Self {
        Self {
            tag: tag.into(),
            value,
        }
    }
}
