# services

Business logic that is not data access. Right now that means turning a song description into
tags with an LLM, normalizing tag names, validating/canonicalizing tag values, reading catalog
song metadata from Apple Music, and the one step that puts those together: generating a song's
default tags the first time anything asks for them.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `default_tags`, `song_metadata`, `tag_generation`, `tag_normalizer`, and `tag_values`. |
| `tag_normalizer.rs` | `normalize_tag_name`: trim, collapse whitespace, truncate to 50 chars, lowercase. Unit tested. |
| `tag_generation/mod.rs` | The `TagGenerator` trait and the `TagGenerationService` wrapper. |
| `tag_generation/openai_tag_generator.rs` | The OpenAI implementation, plus ignored integration tests. |
| `tag_values.rs` | `canonicalize_tag_value`: validates a tag value string against the tag's `TagType` and returns its canonical stored form (or `CadenzaError::InvalidTagValue`). Unit tested. |
| `song_metadata.rs` | `SongMetadataService`: song ids to Apple Music catalog metadata, developer token only. Unit tested, plus ignored integration tests. |
| `default_tags.rs` | `ensure_default_tags_generated`: generates a song's default tags the first time they are read, and marks it so it happens once. |

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
in `AppState`. It does two things on top of the trait: clamps `requested_tag_count` to
`DEFAULT_REQUESTED_TAG_COUNT` (7) when `None` and `MAX_REQUESTED_TAG_COUNT` (20) as a ceiling,
and converts the generator's `String` error into `CadenzaError::TagGenerationErr` (500).

Input is a list of song descriptions, output is a list of tag lists in the same order. It is
batch-shaped even though the only caller today (`GET /tags/suggest`) passes exactly one song and
takes `result[0]`.

`OpenAiTagGenerator` posts to the OpenAI responses api (`gpt-4o-mini`, 60 second timeout) with a
schema-constrained system prompt, then parses a
`{"tags": [{"song": "...", "tags": [{"name": "...", "color": "#rrggbb"}]}]}` payload. Each entry
echoes its song's description back, which is how tags are matched to songs rather than by
position. It short circuits on an empty input list or a zero tag count, rejects combined
descriptions over `MAX_COMBINED_SONG_DESC_LENGTH` (2000 bytes), truncates any over-long tag list
from the model, and runs every tag through `normalize_tag_name` before returning.

`SongMetadataService::get_songs_metadata` takes a slice of song ids and returns one
`Option<SongMetadata>` per id, in input order. It hits
`GET /v1/catalog/{storefront}/songs?ids=...`, which authenticates with the developer token
alone: no Apple Music account, no `Music-User-Token`. `SongMetadata` carries title, artist,
album, duration, artwork url, genres, release date, and ISRC, plus a `description()` helper that
formats `"<title> by <artist>"`, the shape `TagGenerator::generate_tags` takes.

Nothing is persisted. Cadenza still stores only a song id; this is fetched fresh per call.

It returns a `HashMap<String, SongMetadata>` keyed by the id each song was found under, never
a positional list, so an id Apple knows nothing about is simply absent rather than shifting
every later id onto the wrong song. The caller looks each id up and decides what a miss means.

It is one request, so it **panics** on more than 300 ids, which is Apple's cap on the `ids`
filter. Chunking the input is the caller's job.

`ensure_default_tags_generated` is the one place that composes the two services with the db. It
takes a slice of song ids and does nothing for the ones already marked in
`default_tags_generated`, which is the common case and costs one indexed read. For the rest it
reads titles through `SongMetadataService`, formats them with `SongMetadata::description()`,
generates through `TagGenerationService`, stores through `db::tags::set_default_tags_on_songs`,
and finally marks every song it tried.

The marking is last on purpose: a generation that errors out marks nothing, so the next read
retries it rather than leaving the song permanently tagless. A song Apple Music has no catalog
entry for is marked with no tags, because it has no title to generate from and leaving it
unmarked would call Apple again on every later read.

It is called by the default tag read handlers in `src/routes/songs.rs`, not by any write. Nothing
generates default tags when a song is added to a library.

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
- `SongMetadataService` is built in `src/main.rs` and lives in `AppState`. Its only caller is
  `default_tags::ensure_default_tags_generated`.
- `ensure_default_tags_generated` is called by `src/routes/songs.rs::get_default_tags_on_song_handler`
  and `get_default_tags_on_songs_handler`.

## Gotchas

- `OpenAiTagGenerator::new()` calls `dotenv().unwrap()` and then `expect`s `OPENAI_API_KEY`, so a
  missing `.env` or key panics during server startup, not at first use.
- `MAX_COMBINED_SONG_DESC_LENGTH` is 2000 bytes across the whole batch, not per song.
  `TagGenerationService::generate_tags` splits the batch into as many generator calls as it
  takes to stay under it, and truncates any single description longer than that on its own.
- The integration tests in `openai_tag_generator.rs` are `#[ignore]`d because they spend real
  tokens. Comment header says last run Jul 26.
- The trait returns `Result<_, String>`, so error detail is free text with no structure.
- Adding a provider means one new file next to `openai_tag_generator.rs`, an `impl TagGenerator`,
  and a one-line change in `main.rs`. Nothing else should need to know.
- `TagType::Text` has no length cap, unlike tag names (`normalize_tag_name` truncates to 50
  chars). A client can store an arbitrarily long string as a text attribute value.
- `SongMetadataService` is catalog only. A library-only song id has no catalog entry and is
  absent from the map, indistinguishable from a bad id.
- The storefront comes from `APPLE_MUSIC_STOREFRONT` and defaults to `us`. The backend has no
  user token, so it cannot ask Apple for the user's real storefront (`/v1/me/storefront` needs
  one). A song not released in the configured storefront is absent from the map.
- `SongMetadataService::new()` `expect`s `APPLE_MUSIC_DEVELOPER_TOKEN`, and `main.rs` constructs
  it at startup, so a missing token panics the server on boot the same way `OPENAI_API_KEY` does.
- The developer token is a JWT that Apple caps at 6 months. It is read from the environment
  already signed; nothing here mints or refreshes it, so an expired token shows up as a 401
  inside `SongMetadataErr`.
- More than 300 ids panics rather than returning an error. Nothing catches panics in this
  process, so a handler that passes a caller-controlled list straight through would drop the
  connection. `ensure_default_tags_generated` passes its input straight down, and is safe only
  because both callers run `check_batch_size` first, which caps at 200. A new caller has to do
  the same.
- A default tag read is now a write path. The first read of a song makes an Apple Music call and
  an LLM call before it answers, so it is slow, and it fails the whole read if either fails.
- Nothing serializes generation, so two reads racing on the same new song both generate.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
