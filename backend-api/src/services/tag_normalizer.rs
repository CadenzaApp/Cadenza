/// The longest a tag name may be, in bytes.
const MAX_TAG_LENGTH: usize = 50;

pub fn normalize_tag_name(tag_name: &str) -> String {
    // trim and remove repeated whitespace
    let mut tag_name = tag_name.split_whitespace().collect::<Vec<_>>().join(" ");

    // limit max length
    if tag_name.len() > MAX_TAG_LENGTH {
        tag_name.truncate(char_boundary_at_or_below(&tag_name, MAX_TAG_LENGTH));
    }

    // make lowercase
    tag_name.to_lowercase()
}

/// Returns the largest byte index at or below `max` that `tag_name` can be cut
/// at. Cutting on any other index panics, so a name whose character straddles
/// `max` loses that whole character rather than half of it.
fn char_boundary_at_or_below(tag_name: &str, max: usize) -> usize {
    let mut boundary = max.min(tag_name.len());

    // index 0 is always a boundary, so this ends
    while !tag_name.is_char_boundary(boundary) {
        boundary -= 1;
    }

    boundary
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

    #[test]
    fn normalize_tag_name_truncates_a_multi_byte_character_whole() {
        // the last character straddles the limit, so the cut drops all of it
        // rather than panicking on a byte in the middle of it
        let mut straddles = string_of_length(MAX_TAG_LENGTH - 1);
        straddles.push('\u{e9}'); // two bytes, putting the name one over
        assert_eq!(straddles.len(), MAX_TAG_LENGTH + 1);
        assert_eq!(
            normalize_tag_name(&straddles),
            string_of_length(MAX_TAG_LENGTH - 1)
        );

        // a name of nothing but three byte characters keeps whole ones, so it
        // ends two bytes under the limit rather than one over it
        let wide = "\u{4e00}".repeat(MAX_TAG_LENGTH);
        assert_eq!(normalize_tag_name(&wide), "\u{4e00}".repeat(16));
    }
}
