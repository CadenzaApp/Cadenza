use chrono::{DateTime, Utc};

use crate::db::entity::sea_orm_active_enums::TagType;
use crate::err::CadenzaError;

/// Validates a value being applied with a tag of the given type, returning the
/// canonical form to store in `user_tags_applied.value`.
///
/// Values are stored as text, so every type needs one canonical spelling that
/// the query engine can rely on later: RFC 3339 in UTC for `Datetime`, a plain
/// decimal for `Number`, and `"true"`/`"false"` for `Checkbox`.
///
/// Attribute tags may be applied without a value, so `None` (and a blank
/// string, which is what an emptied input sends) is always accepted. `Basic`
/// tags hold no value at all.
pub fn canonicalize_tag_value(
    tag_type: &TagType,
    value: Option<String>,
) -> Result<Option<String>, CadenzaError> {
    let Some(value) = value else {
        return Ok(None);
    };

    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }

    match tag_type {
        TagType::Basic => Err(CadenzaError::InvalidTagValue(
            "basic tags cannot hold a value".to_string(),
        )),

        TagType::Text => Ok(Some(value.to_string())),

        TagType::Number => match value.parse::<f64>() {
            Ok(number) if number.is_finite() => Ok(Some(number.to_string())),
            _ => Err(CadenzaError::InvalidTagValue(format!(
                "'{}' is not a number",
                value
            ))),
        },

        TagType::Datetime => match DateTime::parse_from_rfc3339(value) {
            Ok(datetime) => Ok(Some(datetime.with_timezone(&Utc).to_rfc3339())),
            Err(_) => Err(CadenzaError::InvalidTagValue(format!(
                "'{}' is not an RFC 3339 datetime",
                value
            ))),
        },

        TagType::Checkbox => match value.to_lowercase().as_str() {
            "true" => Ok(Some("true".to_string())),
            "false" => Ok(Some("false".to_string())),
            _ => Err(CadenzaError::InvalidTagValue(format!(
                "'{}' is not 'true' or 'false'",
                value
            ))),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canonical(tag_type: TagType, value: &str) -> Option<String> {
        canonicalize_tag_value(&tag_type, Some(value.to_string())).unwrap()
    }

    fn is_rejected(tag_type: TagType, value: &str) -> bool {
        canonicalize_tag_value(&tag_type, Some(value.to_string())).is_err()
    }

    #[test]
    fn missing_and_blank_values_are_always_accepted() {
        for tag_type in [
            TagType::Basic,
            TagType::Text,
            TagType::Number,
            TagType::Datetime,
            TagType::Checkbox,
        ] {
            assert_eq!(canonicalize_tag_value(&tag_type, None).unwrap(), None);
            assert_eq!(canonical(tag_type, "   "), None);
        }
    }

    #[test]
    fn basic_tags_reject_any_value() {
        assert!(is_rejected(TagType::Basic, "anything"));
    }

    #[test]
    fn text_values_are_trimmed_but_otherwise_untouched() {
        assert_eq!(
            canonical(TagType::Text, "  Live at Budokan  "),
            Some("Live at Budokan".to_string())
        );
    }

    #[test]
    fn numbers_accept_ints_floats_and_exponents() {
        assert_eq!(canonical(TagType::Number, "7"), Some("7".to_string()));
        assert_eq!(canonical(TagType::Number, "-2.50"), Some("-2.5".to_string()));
        assert_eq!(canonical(TagType::Number, "1e3"), Some("1000".to_string()));
    }

    #[test]
    fn numbers_reject_non_finite_and_unparseable_input() {
        assert!(is_rejected(TagType::Number, "NaN"));
        assert!(is_rejected(TagType::Number, "inf"));
        assert!(is_rejected(TagType::Number, "3 stars"));
    }

    #[test]
    fn datetimes_are_normalized_to_utc() {
        assert_eq!(
            canonical(TagType::Datetime, "1994-05-01T12:00:00-06:00"),
            Some("1994-05-01T18:00:00+00:00".to_string())
        );
    }

    #[test]
    fn datetimes_reject_non_rfc3339_input() {
        assert!(is_rejected(TagType::Datetime, "1994-05-01"));
        assert!(is_rejected(TagType::Datetime, "yesterday"));
    }

    #[test]
    fn checkboxes_accept_either_case_and_store_lowercase() {
        assert_eq!(
            canonical(TagType::Checkbox, "TRUE"),
            Some("true".to_string())
        );
        assert_eq!(
            canonical(TagType::Checkbox, "false"),
            Some("false".to_string())
        );
    }

    #[test]
    fn checkboxes_reject_anything_else() {
        assert!(is_rejected(TagType::Checkbox, "yes"));
        assert!(is_rejected(TagType::Checkbox, "1"));
    }
}
