//! The assistant's system prompt.
//!
//! The text lives in `prompt.txt`, embedded at compile time. Its `{{name}}`
//! markers are filled in per request by [`instructions`].

use serde_json::Value;

/// The most tags written into the prompt. Past this the model calls `list_tags`.
pub const MAX_PROMPT_TAGS: usize = 200;

/// The prompt text with its `{{name}}` markers.
const TEMPLATE: &str = include_str!("prompt.txt");

/// The instructions sent with every request.
///
/// `now` is the phone's local time with its offset, `time_zone` its zone name,
/// `tags` the user's own tags as `describe_tags` returns them, and `activity`
/// the activity tags as `describe_activity_tags` returns them.
pub fn instructions(now: &str, time_zone: &str, tags: &[Value], activity: &[Value]) -> String {
    let shown = &tags[..tags.len().min(MAX_PROMPT_TAGS)];
    let tags_json = serde_json::to_string(shown).unwrap_or_else(|_| "[]".to_owned());
    let cut_short = if tags.len() > MAX_PROMPT_TAGS {
        format!(
            "\nThe list above shows {MAX_PROMPT_TAGS} of the user's {} tags. Call list_tags for the rest.",
            tags.len()
        )
    } else {
        String::new()
    };
    let activity_json = serde_json::to_string(activity).unwrap_or_else(|_| "[]".to_owned());
    let activity_examples = activity_examples(activity);

    fill(
        TEMPLATE,
        &[
            ("now", now),
            ("time_zone", time_zone),
            ("tags_json", &tags_json),
            ("cut_short", &cut_short),
            ("activity_json", &activity_json),
            ("activity_examples", &activity_examples),
        ],
    )
    .trim_end()
    .to_owned()
}

/// Replaces each `{{name}}` in `template` with its value, in one pass, so a
/// value that itself contains `{{...}}` (a tag name, say) is never expanded.
/// A marker with no value is left as it is.
fn fill(template: &str, values: &[(&str, &str)]) -> String {
    let extra: usize = values.iter().map(|(_, value)| value.len()).sum();
    let mut out = String::with_capacity(template.len() + extra);
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let found = after.find("}}").and_then(|end| {
            values
                .iter()
                .find(|(name, _)| *name == &after[..end])
                .map(|(_, value)| (end, *value))
        });
        match found {
            Some((end, value)) => {
                out.push_str(value);
                rest = &after[end + 2..];
            }
            None => {
                out.push_str("{{");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Example queries on the activity tags, with their real ids, for the end of
/// the prompt. Empty when the tags are missing.
fn activity_examples(activity: &[Value]) -> String {
    let id_of = |name: &str| {
        activity
            .iter()
            .find(|tag| tag["name"] == name)
            .and_then(|tag| tag["id"].as_i64())
    };
    let mut examples = String::new();
    if let Some(library) = id_of("In My Library") {
        examples.push_str(&format!(
            r#"
- Every song in the user's library: {{"where": {{"filter": {{"field": "tag", "tag_id": {library}, "op": "is_true"}}}}}}"#
        ));
    }
    if let Some(plays) = id_of("My Plays") {
        examples.push_str(&format!(
            r#"
- Songs the user has played more than 20 times: {{"where": {{"filter": {{"field": "tag", "tag_id": {plays}, "op": "gt", "value": "20"}}}}}}"#
        ));
    }
    examples
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writes_the_time_and_the_tags() {
        let prompt = instructions(
            "2026-11-11T17:53:00-07:00",
            "America/Denver",
            &[json!({ "id": 12, "name": "chill", "type": "basic" })],
            &[],
        );
        assert!(prompt.contains("2026-11-11T17:53:00-07:00"));
        assert!(prompt.contains("America/Denver"));
        assert!(prompt.contains(r#""name":"chill""#));
        assert!(!prompt.contains("Call list_tags for the rest"));
    }

    #[test]
    fn lists_the_activity_tags_with_their_ids() {
        let activity = [json!({
            "id": 44,
            "name": "In My Library",
            "type": "checkbox",
            "means": "Whether the song is in the user's Apple Music library."
        })];
        let prompt = instructions("now", "UTC", &[], &activity);
        assert!(prompt.contains(r#""name":"In My Library""#));
        assert!(prompt.contains(r#""tag_id": 44, "op": "is_true""#));
        // no activity tags, no examples that would point at a missing id
        assert!(!instructions("now", "UTC", &[], &[]).contains("Every song in the user's library"));
    }

    #[test]
    fn says_when_the_tag_list_is_cut_short() {
        let tags: Vec<Value> = (0..MAX_PROMPT_TAGS + 5)
            .map(|id| json!({ "id": id, "name": format!("tag {id}"), "type": "basic" }))
            .collect();
        let prompt = instructions("now", "UTC", &tags, &[]);
        assert!(prompt.contains(&format!(
            "{} of the user's {} tags",
            MAX_PROMPT_TAGS,
            tags.len()
        )));
        assert!(!prompt.contains(&format!("tag {}", MAX_PROMPT_TAGS + 1)));
    }

    #[test]
    fn the_examples_are_valid_queries() {
        let activity = [
            json!({ "id": 41, "name": "My Plays", "type": "number", "means": "" }),
            json!({ "id": 44, "name": "In My Library", "type": "checkbox", "means": "" }),
        ];
        let prompt = instructions("now", "UTC", &[], &activity);
        let examples: Vec<&str> = prompt
            .lines()
            .filter(|line| line.starts_with("- ") && line.contains(r#"{"where""#))
            .map(|line| &line[line.find(r#"{"where""#).unwrap()..])
            .collect();
        assert_eq!(examples.len(), 5);
        for example in examples {
            serde_json::from_str::<crate::routes::json::query::Query>(example)
                .unwrap_or_else(|err| panic!("{example} does not parse: {err}"));
        }
    }

    #[test]
    fn fills_every_marker() {
        let activity = [
            json!({ "id": 41, "name": "My Plays", "type": "number", "means": "" }),
            json!({ "id": 44, "name": "In My Library", "type": "checkbox", "means": "" }),
        ];
        let prompt = instructions("now", "UTC", &[], &activity);
        assert!(
            !prompt.contains("{{"),
            "a marker in prompt.txt has no value"
        );
    }

    #[test]
    fn a_tag_name_with_a_marker_stays_as_written() {
        let prompt = instructions(
            "2026-11-11T17:53:00-07:00",
            "America/Denver",
            &[json!({ "id": 1, "name": "{{now}}", "type": "basic" })],
            &[],
        );
        assert!(prompt.contains(r#""name":"{{now}}""#));
    }
}
