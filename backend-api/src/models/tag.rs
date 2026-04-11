use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
}

impl Tag {
    pub fn builder() -> TagBuilder {
        TagBuilder::default()
    }

    pub fn normalized(mut self) -> Self {
        self.normalize_mut();
        self
    }

    pub fn normalize_mut(&mut self) {
        self.name = normalize_name(&self.name);
    }

    pub fn is_empty(&self) -> bool {
        self.name.is_empty()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TagBuildError {
    MissingName,
}

impl Display for TagBuildError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            TagBuildError::MissingName => write!(f, "tag name is required"),
        }
    }
}

impl Error for TagBuildError {}

#[derive(Debug, Clone, Default)]
pub struct TagBuilder {
    name: Option<String>,
}

impl TagBuilder {
    pub fn name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn build(self) -> Result<Tag, TagBuildError> {
        let name = normalize_name(self.name.as_deref().unwrap_or_default());

        if name.is_empty() {
            return Err(TagBuildError::MissingName);
        }

        Ok(Tag { name })
    }
}

fn normalize_name(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_normalizes_name() {
        let tag = Tag::builder().name("  synth   pop  ").build().unwrap();
        assert_eq!(tag.name, "synth pop");
    }

    #[test]
    fn build_rejects_empty_name() {
        let result = Tag::builder().name("   ").build();
        assert_eq!(result, Err(TagBuildError::MissingName));
    }
}
