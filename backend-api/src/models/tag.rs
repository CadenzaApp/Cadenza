use bon::Builder;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Builder)]
pub struct Tag {
    pub name: String,
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
}

fn normalize_name(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_normalizes_name() {
        let tag = Tag::builder()
            .name("  synth   pop  ".to_string())
            .build()
            .normalized();
        assert_eq!(tag.name, "synth pop");
    }
}
