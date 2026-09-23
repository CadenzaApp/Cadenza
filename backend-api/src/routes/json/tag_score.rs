use serde::Serialize;

use crate::db::tag_scores::TopTagScore;

/// Where a top tag's color came from.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TagSource {
    /// The user has a tag of this name.
    Local,
    /// Only a default tag has this name.
    Global,
}

/// One top tag, serialized as a three element array: `[score, color, source]`.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct ScoredTag(i64, String, TagSource);

impl From<TopTagScore> for ScoredTag {
    fn from(value: TopTagScore) -> Self {
        let source = if value.local {
            TagSource::Local
        } else {
            TagSource::Global
        };
        Self(value.score, value.color, source)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scored_tag_serializes_as_score_color_source() {
        let local = ScoredTag::from(TopTagScore {
            score: 12,
            color: "#ff0000".to_owned(),
            local: true,
        });
        let global = ScoredTag::from(TopTagScore {
            score: 3,
            color: "#00ff00".to_owned(),
            local: false,
        });

        assert_eq!(
            serde_json::to_string(&local).unwrap(),
            r##"[12,"#ff0000","local"]"##
        );
        assert_eq!(
            serde_json::to_string(&global).unwrap(),
            r##"[3,"#00ff00","global"]"##
        );
    }
}
