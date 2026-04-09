use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TagValidationError {
    EmptyTagName,
    TagNameTooLong,
}

impl Display for TagValidationError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            TagValidationError::EmptyTagName => {
                write!(f, "tag name cannot be empty")
            }
            TagValidationError::TagNameTooLong => {
                write!(f, "tag name is too long")
            }
        }
    }
}

impl Error for TagValidationError {}

impl Tag {
    pub fn new(tag_name: impl Into<String>) -> Self {
        Self {
            name: tag_name.into(),
        }
        .normalized()
    }

    pub fn normalized(mut self) -> Self {
        self.normalize_mut();
        self
    }

    pub fn normalize_mut(&mut self) {
        self.name = normalize_tag_name(&self.name);
    }

    pub fn is_empty(&self) -> bool {
        self.name.is_empty()
    }

    pub fn validate(&self) -> Result<(), TagValidationError> {
        if self.name.is_empty() {
            return Err(TagValidationError::EmptyTagName);
        }

        if self.name.len() > 100 {
            return Err(TagValidationError::TagNameTooLong);
        }

        Ok(())
    }
}

fn normalize_tag_name(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_normalizes_tag_name() {
        let tag = Tag::new("  synth   pop  ");
        assert_eq!(tag.name, "synth pop");
    }

    #[test]
    fn normalize_mut_trims_and_collapses_whitespace() {
        let mut tag = Tag {
            name: "  indie   rock  ".to_string(),
        };

        tag.normalize_mut();

        assert_eq!(tag.name, "indie rock");
    }

    #[test]
    fn is_empty_returns_true_for_empty_tag() {
        let tag = Tag::new("   ");
        assert!(tag.is_empty());
    }

    #[test]
    fn validate_rejects_empty_tag_name() {
        let tag = Tag::new("   ");
        assert_eq!(tag.validate(), Err(TagValidationError::EmptyTagName));
    }

    #[test]
    fn validate_rejects_overlong_tag_name() {
        let tag = Tag::new("a".repeat(101));
        assert_eq!(tag.validate(), Err(TagValidationError::TagNameTooLong));
    }

    #[test]
    fn validate_accepts_normal_tag() {
        let tag = Tag::new("dream pop");
        assert_eq!(tag.validate(), Ok(()));
    }
}
