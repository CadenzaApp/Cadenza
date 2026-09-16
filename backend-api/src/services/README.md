# services

Business logic that is not data access. Right now that means turning song descriptions into tags
with an LLM, and normalizing tag names.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `tag_normalizer` and `tag_generation`. |
| `tag_normalizer.rs` | `normalize_tag_name`: trim, collapse whitespace, truncate to 50 chars, lowercase. Unit tested. |
| `tag_generation/mod.rs` | The `TagGenerator` trait, the `TagGenerationService` wrapper, `GeneratedTagsLog`, and `MAX_COMBINED_SONG_DESC_LENGTH`. Unit tested against a fake generator. |
| `tag_generation/openai_tag_generator.rs` | The OpenAI implementation, color normalization, matching a reply back to its song by description, unit tests plus ignored integration tests. |

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

- clamps `requested_tag_count` to `DEFAULT_REQUESTED_TAG_COUNT` (7) when `None` and
  `MAX_REQUESTED_TAG_COUNT` (20) as a ceiling.
- cuts any one description longer than `MAX_COMBINED_SONG_DESC_LENGTH` (2000 bytes) down to fit, on
  a char boundary.
- splits the descriptions into consecutive chunks that each fit under that limit, and calls the
  generator once per chunk, one after another.
- pads or trims each chunk's result to the chunk's length, as a backstop for a `TagGenerator` that
  returns the wrong number of lists. A padded song gets no tags. `OpenAiTagGenerator` already
  returns one list per song, so this is a no-op for it.
- converts the generator's `String` error into `CadenzaError::TagGenerationErr` (500).
- prints one block to stdout naming the tags each description got, once every chunk has succeeded.

A `TagSpecs` is a tag `name` plus a `#rrggbb` `color` reflecting the tag's mood.

Input is a list of song descriptions, output is a list of tag lists in the same order.
`GET /tags/suggest` passes one song and takes `result[0]`. `POST /songs/default-tags` passes every
song in its request that has no default tags yet.

`OpenAiTagGenerator` posts to the OpenAI responses api (`gpt-4o-mini`, 60 second timeout) with a
schema-constrained system prompt, then parses a
`{"tags": [{"song", "tags": [{"name", "color"}, ...]}, ...]}` payload. The songs go out as a real
JSON array of strings built with `serde_json`, so punctuation in a title cannot change how many
songs the model sees. Every reply entry copies its song's description back in `song`. The schema
puts a color on every tag, so the model cannot leave a tag without one.
`to_tag_specs` cleans the reply and realigns it: it matches each entry to the song whose
description it echoes and returns exactly one list per input song, truncates any over-long tag
list, runs every name through `normalize_tag_name`, replaces a color that is not a `#RRGGBB` hex
string with `FALLBACK_TAG_COLOR` (`#808080`), and gives a name that shows up more than once the
first color it got. Matching ignores case and spacing, a description matching no input song is
dropped, and two songs sharing a description get the same tags. The generator short circuits on an
empty input list or a zero tag count, and rejects combined descriptions over
`MAX_COMBINED_SONG_DESC_LENGTH` bytes (the service never sends that much).

Every finished batch prints one block to stdout, so a run can be checked for tags landing on the
wrong song:

```
tag generation: 2 songs
  "Jolene by Dolly Parton" -> folk, country, storytelling
  "Master of Puppets by Metallica" -> no tags
```

`GeneratedTagsLog` in `tag_generation/mod.rs` formats it, and it is unit tested like the vote log
line in `../db/README.md`. The descriptions are the ones the generator was given, after truncation,
paired with the tags that came back. A song the model returned nothing for says `no tags`.

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
- On big batches the model returns fewer tag lists than songs. Each reply entry echoes the
  description of the song it belongs to, so a song the model skips just gets no tags. It no longer
  slides the songs after it onto the wrong tags.
- Matching on the echoed description means a model that paraphrases a description instead of
  copying it loses that song's tags. `desc_match_key` absorbs case and spacing drift, nothing more.
- The batch log is one line per song, so a 100 song batch from `POST /songs/default-tags` prints
  100 lines to stdout. It logs tag names only, not colors, and a batch that fails part way through
  logs nothing at all.
- Default tags saved before the description echo can be wrong, and nothing re-generates them. Song
  descriptions used to be pasted into the prompt separated by bare commas, so a comma in a title or
  an artist name ("Earth, Wind & Fire") read as two songs, and every later song in that batch took
  the previous song's tags. A song that already has default tags is skipped by
  `POST /songs/default-tags`, so those rows stay as they are until something clears them.
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
