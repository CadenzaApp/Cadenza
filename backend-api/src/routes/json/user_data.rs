use serde::Serialize;

use crate::db::user_data::{DataCount, DataSection};
use crate::services::analytics::metrics::MetricUnit;

/// One row of the Your data screen.
#[derive(Serialize)]
pub struct UserDataCount {
    pub name: &'static str,
    pub section: &'static str,
    pub description: &'static str,
    pub unit: MetricUnit,
    pub value: i64,
}

impl From<(DataCount, i64)> for UserDataCount {
    fn from((count, value): (DataCount, i64)) -> Self {
        Self {
            name: count.name,
            section: match count.section {
                DataSection::Library => "library",
                DataSection::Tags => "tags",
                DataSection::Listening => "listening",
                DataSection::Social => "social",
            },
            description: count.description,
            unit: count.unit,
            value,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_count_serializes_with_its_section_and_unit() {
        let count = DataCount {
            name: "songs",
            section: DataSection::Library,
            description: "Songs in your library",
            unit: MetricUnit::Count,
            sql: String::new(),
        };
        let body = serde_json::to_value(UserDataCount::from((count, 12))).unwrap();

        assert_eq!(
            body,
            json!({
                "name": "songs",
                "section": "library",
                "description": "Songs in your library",
                "unit": "count",
                "value": 12,
            })
        );
    }
}
