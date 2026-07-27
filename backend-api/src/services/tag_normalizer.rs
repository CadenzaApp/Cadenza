const MAX_TAG_LENGTH: usize = 50;

pub fn normalize_tag_name(tag_name: &str) -> String {
    // trim and remove repeated whitespace
    let mut tag_name = tag_name.split_whitespace().collect::<Vec<_>>().join(" ");

    // limit max length
    if tag_name.len() > MAX_TAG_LENGTH {
        tag_name = tag_name[..MAX_TAG_LENGTH].to_string();
    }

    // make lowercase
    tag_name.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::string_of_length;

    #[test]
    fn normalize_tag_name_trims_and_collapses_internal_whitespace() {
        assert_eq!(normalize_tag_name("  Alt   Rock  "), "alt rock".to_string());
    }

    #[test]
    fn normalize_tag_name_doesnt_affect_empty_str() {
        assert_eq!(normalize_tag_name(""), "".to_string());
    }

    #[test]
    fn normalize_tag_name_truncates_long_inputs() {
        assert_eq!(
            normalize_tag_name(&string_of_length(MAX_TAG_LENGTH + 1)).len(),
            MAX_TAG_LENGTH
        );
    }
}
