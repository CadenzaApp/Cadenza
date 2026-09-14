# services

Business logic that is not data access. Right now that means turning song descriptions into tags
with an LLM, and normalizing tag names.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `tag_normalizer` and `tag_generation`. |
| `tag_normalizer.rs` | `normalize_tag_name`: trim, collapse whitespace, truncate to 50 chars, lowercase. Unit tested. |
| `tag_generation/mod.rs` | The `TagGenerator` trait, the `TagGenerationService` wrapper, and `MAX_COMBINED_SONG_DESC_LENGTH`. Unit tested against a fake generator. |
| `tag_generation/openai_tag_generator.rs` | The OpenAI implementation, color normalization, unit tests plus ignored integration tests. |

## How it works

The generation stage is behind a trait so the provider can be swapped without touching any
caller:

```rust
#[async_trait]
pub trait TagGenerator: Send + Sync {
    async fn generate_tags(&self, song_descs: &[String], requested_tag_count: usize)
        -> Result<Vec<Vec<TagSpecs>>, String>;
}
```

`TagGenerationService` is a newtype over `Arc<Box<dyn TagGenerator>>`, so it is `Clone` and lives
in `AppState`. On top of the trait it:

- clamps `requested_tag_count` to `DEFAULT_REQUESTED_TAG_COUNT` (10) when `None` and
  `MAX_REQUESTED_TAG_COUNT` (20) as a ceiling.
- cuts any one description longer than `MAX_COMBINED_SONG_DESC_LENGTH` (2000 bytes) down to fit, on
  a char boundary.
- splits the descriptions into consecutive chunks that each fit under that limit, and calls the
  generator once per chunk, one after another.
- pads or trims each chunk's result to the chunk's length, so a model that returns the wrong
  number of lists cannot shift later songs onto the wrong tags. A padded song gets no tags.
- converts the generator's `String` error into `CadenzaError::TagGenerationErr` (500).

A `TagSpecs` is a tag `name` plus a `#rrggbb` `color` reflecting the tag's mood.

Input is a list of song descriptions, output is a list of tag lists in the same order.
`GET /tags/suggest` passes one song and takes `result[0]`. `POST /songs/default-tags` passes every
song in its request that has no default tags yet.

`OpenAiTagGenerator` posts to the OpenAI responses api (`gpt-4o-mini`, 60 second timeout) with a
schema-constrained system prompt, then parses a `{"tags": [[{"name", "color"}, ...], ...]}` payload.
The schema puts a color on every tag, so the model cannot leave a tag without one.
`to_tag_specs` cleans the reply: it truncates any over-long tag list, runs every name through
`normalize_tag_name`, replaces a color that is not a `#RRGGBB` hex string with
`FALLBACK_TAG_COLOR` (`#808080`), and gives a name that shows up more than once the first color it
got. The generator short circuits on an empty input list or a zero tag count, and rejects combined
descriptions over `MAX_COMBINED_SONG_DESC_LENGTH` bytes (the service never sends that much).

## Connects to

- Constructed in `src/main.rs` as `TagGenerationService::new(OpenAiTagGenerator::new())` and
  stored in `AppState`.
- Consumed by `src/routes/tags.rs::suggest_tags_handler` and
  `src/routes/songs.rs::set_default_tags_on_songs_handler`.
- `normalize_tag_name` is called from the OpenAI generator. Note that it is **not** applied to
  user-created tag names coming through `POST /tags`.

## Gotchas

- `OpenAiTagGenerator::new()` calls `dotenv().unwrap()` and then `expect`s `OPENAI_API_KEY`, so a
  missing `.env` or key panics during server startup, not at first use.
- `MAX_COMBINED_SONG_DESC_LENGTH` counts bytes (`str::len`), not characters, so a chunk holds fewer
  songs with non-Latin titles. Only the service splits and truncates. Calling a `TagGenerator`
  directly with too much text still fails on length.
- A large batch through the service is several OpenAI calls in a row, each with its own 20 second
  timeout, and one failed chunk fails the whole call. A full chunk is dozens of songs in one
  reply, so it is the call most likely to hit that timeout or `gpt-4o-mini`'s 16,384 output token
  cap.
- On big batches the model returns fewer tag lists than songs. The service pads the end with empty
  lists, so the last songs get no tags, and a song skipped in the middle shifts later songs onto
  the wrong tags.
- Colors used to come back in a separate list that the model left half empty on big batches, so
  many default tags already saved are `#808080`. They stay gray, because
  `db::tags::set_default_tags_on_songs` reuses an existing tag by name without updating its color.
- The integration tests in `openai_tag_generator.rs` are `#[ignore]`d because they spend real
  tokens. Comment header says last run Jul 26. The `normalize_tag_color` and `to_tag_specs` tests
  in the same module are plain unit tests and do run.
- The trait returns `Result<_, String>`, so error detail is free text with no structure.
- Adding a provider means one new file next to `openai_tag_generator.rs`, an `impl TagGenerator`,
  and a one-line change in `main.rs`. Nothing else should need to know. The service still chunks
  by `MAX_COMBINED_SONG_DESC_LENGTH`, so a provider with a different limit means changing that
  constant.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
