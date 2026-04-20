use bon::Builder;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Builder)]
pub struct Tag {
    pub name: String,

    #[builder(default)]
    #[serde(default)]
    pub user_created: bool,

    #[builder(default)]
    #[serde(default)]
    pub llm_suggested: bool,

    #[builder(default)]
    #[serde(default)]
    pub llm_approved: bool,

    #[builder(default)]
    #[serde(default)]
    pub canonical_or_default: bool,
}

impl Tag {
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

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.name.trim().is_empty() {
            return Err("tag name cannot be empty");
        }

        Ok(())
    }
}

fn normalize_name(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_normalizes_name_and_defaults_flags_to_false() {
        let tag = Tag::builder()
            .name("  synth   pop  ".to_string())
            .build()
            .normalized();

        assert_eq!(tag.name, "synth pop");
        assert!(!tag.user_created);
        assert!(!tag.llm_suggested);
        assert!(!tag.llm_approved);
        assert!(!tag.canonical_or_default);
    }

    #[test]
    fn build_allows_overriding_default_flags() {
        let tag = Tag::builder()
            .name("synth pop".to_string())
            .llm_suggested(true)
            .llm_approved(true)
            .build();

        assert!(tag.llm_suggested);
        assert!(tag.llm_approved);
        assert!(!tag.user_created);
        assert!(!tag.canonical_or_default);
    }

    #[test]
    fn validate_rejects_empty_name() {
        let tag = Tag::builder().name("   ".to_string()).build().normalized();
        assert!(tag.validate().is_err());
    }
}
