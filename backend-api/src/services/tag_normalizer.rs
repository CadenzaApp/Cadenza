use std::collections::HashSet;

pub fn normalize_tag_name(input: &str) -> Option<String> {
    let normalized = input.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }

    Some(normalized.to_lowercase())
}

pub fn normalize_generated_tags_for_song(
    generated_tags: &[String],
    existing_global_tag_names: &[String],
    max_tags: Option<usize>,
) -> Vec<String> {
    let mut existing = HashSet::new();
    for tag in existing_global_tag_names {
        if let Some(normalized) = normalize_tag_name(tag) {
            existing.insert(normalized);
        }
    }

    let limit = max_tags.unwrap_or(usize::MAX);
    let mut seen = HashSet::new();
    let mut output = Vec::new();

    for raw_tag in generated_tags {
        let Some(normalized) = normalize_tag_name(raw_tag) else {
            continue;
        };

        if existing.contains(&normalized) || !seen.insert(normalized.clone()) {
            continue;
        }

        output.push(normalized);
        if output.len() >= limit {
            break;
        }
    }

    output
}

pub fn normalize_existing_tags_for_prompt(
    existing_global_tag_names: &[String],
    max_tags: usize,
) -> Vec<String> {
    if max_tags == 0 {
        return Vec::new();
    }

    let mut seen = HashSet::new();
    let mut output = Vec::new();

    for raw_tag in existing_global_tag_names {
        let Some(normalized) = normalize_tag_name(raw_tag) else {
            continue;
        };

        if !seen.insert(normalized.clone()) {
            continue;
        }

        output.push(normalized);
        if output.len() >= max_tags {
            break;
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_tag_name_trims_and_collapses_internal_whitespace() {
        assert_eq!(
            normalize_tag_name("  Alt   Rock  "),
            Some("alt rock".to_string())
        );
    }

    #[test]
    fn normalize_generated_tags_drops_empty_and_duplicate_values() {
        let generated = vec![
            "  rock ".to_string(),
            "".to_string(),
            "ROCK".to_string(),
            " alt   rock ".to_string(),
        ];

        let result = normalize_generated_tags_for_song(&generated, &[], None);
        assert_eq!(result, vec!["rock".to_string(), "alt rock".to_string()]);
    }

    #[test]
    fn normalize_generated_tags_filters_existing_global_tags() {
        let generated = vec![
            "rock".to_string(),
            "  synth pop".to_string(),
            "ROCK".to_string(),
        ];

        let existing = vec![" Rock ".to_string()];
        let result = normalize_generated_tags_for_song(&generated, &existing, None);

        assert_eq!(result, vec!["synth pop".to_string()]);
    }

    #[test]
    fn normalize_generated_tags_caps_output_count() {
        let generated = vec![
            "rock".to_string(),
            "synth pop".to_string(),
            "shoegaze".to_string(),
        ];

        let result = normalize_generated_tags_for_song(&generated, &[], Some(2));
        assert_eq!(result, vec!["rock".to_string(), "synth pop".to_string()]);
    }

    #[test]
    fn normalize_existing_tags_for_prompt_drops_empty_and_deduplicates() {
        let existing = vec![
            "  alt   rock ".to_string(),
            "".to_string(),
            "ALT ROCK".to_string(),
            "  ".to_string(),
            "dream pop".to_string(),
        ];

        let result = normalize_existing_tags_for_prompt(&existing, 25);
        assert_eq!(
            result,
            vec!["alt rock".to_string(), "dream pop".to_string()]
        );
    }

    #[test]
    fn normalize_existing_tags_for_prompt_caps_to_max_count() {
        let existing = vec![
            "rock".to_string(),
            "indie".to_string(),
            "shoegaze".to_string(),
        ];

        let result = normalize_existing_tags_for_prompt(&existing, 2);
        assert_eq!(result, vec!["rock".to_string(), "indie".to_string()]);
    }

    #[test]
    fn normalize_existing_tags_for_prompt_passes_small_lists_through() {
        let existing = vec!["jazz".to_string(), "evening".to_string()];

        let result = normalize_existing_tags_for_prompt(&existing, 25);
        assert_eq!(result, vec!["jazz".to_string(), "evening".to_string()]);
    }
}
