# services

Business logic that is not data access. Right now that means turning a song description into
tags with an LLM, normalizing tag names, and validating/canonicalizing tag values.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `tag_normalizer`, `tag_generation`, and `tag_values`. |
| `tag_normalizer.rs` | `normalize_tag_name`: trim, collapse whitespace, truncate to 50 chars, lowercase. Unit tested. |
| `tag_generation/mod.rs` | The `TagGenerator` trait and the `TagGenerationService` wrapper. |
| `tag_generation/openai_tag_generator.rs` | The OpenAI implementation, plus ignored integration tests. |
| `tag_values.rs` | `canonicalize_tag_value`: validates a tag value string against the tag's `TagType` and returns its canonical stored form (or `CadenzaError::InvalidTagValue`). Unit tested. |

## How it works

The generation stage is behind a trait so the provider can be swapped without touching any
caller:

```rust
#[async_trait]
pub trait TagGenerator: Send + Sync {
    async fn generate_tags(&self, song_descs: &[String], requested_tag_count: usize)
        -> Result<Vec<Vec<String>>, String>;
}
```

`TagGenerationService` is a newtype over `Arc<Box<dyn TagGenerator>>`, so it is `Clone` and lives
in `AppState`. It does two things on top of the trait: clamps `requested_tag_count` to
`DEFAULT_REQUESTED_TAG_COUNT` (10) when `None` and `MAX_REQUESTED_TAG_COUNT` (20) as a ceiling,
and converts the generator's `String` error into `CadenzaError::TagGenerationErr` (500).

Input is a list of song descriptions, output is a list of tag lists in the same order. It is
batch-shaped even though the only caller today (`GET /tags/suggest`) passes exactly one song and
takes `result[0]`.

`OpenAiTagGenerator` posts to the OpenAI responses api (`gpt-4o-mini`, 20 second timeout) with a
schema-constrained system prompt, then parses a `{"tags": [[...], ...]}` payload. It short
circuits on an empty input list or a zero tag count, rejects combined descriptions over 200
characters, truncates any over-long tag list from the model, and runs every tag through
`normalize_tag_name` before returning.

`canonicalize_tag_value` validates a tag value against the tag's `TagType` and returns the
canonical string to store. `None` and blank strings are always accepted (an attribute tag can be
applied with no value yet) and become `None`. `Basic` tags reject any non-blank value. `Text` is
trimmed and stored as-is. `Number` parses as `f64`, rejects non-finite values (`NaN`, `inf`), and
stores `to_string()`. `Datetime` requires strict RFC 3339 and is normalized to UTC. `Date` requires a
`YYYY-MM-DD` calendar day, with no time or zone, and is stored as that. `Checkbox`
accepts `"true"`/`"false"` case-insensitively and stores lowercase. Anything else returns
`CadenzaError::InvalidTagValue` (422).

## Connects to

- Constructed in `src/main.rs` as `TagGenerationService::new(OpenAiTagGenerator::new())` and
  stored in `AppState`.
- Consumed by `src/routes/tags.rs::suggest_tags_handler`.
- `normalize_tag_name` is called from the OpenAI generator. Note that it is **not** applied to
  user-created tag names coming through `POST /tags`.
- `canonicalize_tag_value` is called from `src/db/tags.rs::apply_user_tag` and
  `set_user_tag_value`, which both look up the tag's type through `get_owned_tag` first.

## Gotchas

- `OpenAiTagGenerator::new()` calls `dotenv().unwrap()` and then `expect`s `OPENAI_API_KEY`, so a
  missing `.env` or key panics during server startup, not at first use.
- `MAX_COMBINED_SONG_DESC_LENGTH` is 200 characters across the whole batch, not per song. Batch a
  handful of songs and it fails on length.
- The integration tests in `openai_tag_generator.rs` are `#[ignore]`d because they spend real
  tokens. Comment header says last run Jul 26.
- The trait returns `Result<_, String>`, so error detail is free text with no structure.
- Adding a provider means one new file next to `openai_tag_generator.rs`, an `impl TagGenerator`,
  and a one-line change in `main.rs`. Nothing else should need to know.
- `TagType::Text` has no length cap, unlike tag names (`normalize_tag_name` truncates to 50
  chars). A client can store an arbitrarily long string as a text attribute value.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
