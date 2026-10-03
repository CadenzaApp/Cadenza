# services

Business logic that is not data access. Right now that means turning a song description into
tags with an LLM, normalizing tag names, validating/canonicalizing tag values, reading catalog
song metadata from Apple Music, the one step that puts those together (generating a song's
default tags the first time anything asks for them), the weekly decay that halves each user's
tag scores, the proxy to the social feed service, and the definitions the listening analytics
are computed from.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `analytics`, `default_tags`, `social_feed`, `song_metadata`, `tag_generation`, `tag_normalizer`, `tag_score_decay`, and `tag_values`. |
| `analytics/dimension.rs` | `Dimension`, what a ranking can be grouped by (song, artist, album) and the SQL that pulls each one's key, label and id out of a play. Unit tested. |
| `analytics/mod.rs` | `TimeWindow`, the future-clock guard, and `sanitize_timezone`. Unit tested. |
| `analytics/event_type.rs` | `EventType`, the nine listening event types, and the payload validation each one requires. Unit tested. |
| `analytics/metrics.rs` | `Metric`, the registry pairing a metric name with one SQL aggregate, and `Bucket` (day, week, month, year) with its `date_trunc` unit, series step, and size caps. Unit tested. |
| `tag_normalizer.rs` | `normalize_tag_name`: trim, collapse whitespace, truncate to 50 bytes on a character boundary, lowercase. Unit tested. |
| `tag_generation/mod.rs` | The `TagGenerator` trait, its `TagGenerationError`, and the `TagGenerationService` wrapper. |
| `tag_generation/openai_tag_generator.rs` | The OpenAI implementation, including rate limit detection off the response headers. Unit tested, plus ignored integration tests. |
| `tag_values.rs` | `canonicalize_tag_value`: validates a tag value string against the tag's `TagType` and returns its canonical stored form (or `CadenzaError::InvalidTagValue`). Unit tested. |
| `song_metadata.rs` | `SongMetadataService`: song ids to Apple Music catalog metadata, developer token only. Unit tested, plus ignored integration tests. |
| `default_tags.rs` | `ensure_default_tags_generated`: generates a song's default tags the first time they are read, claiming the song in `default_tags_generation` first so it happens once. Also `backfill_default_tags` and the background job that runs it, which does the same for songs nothing has read yet. |
| `social_feed.rs` | `SocialFeedService::forward`: sends a request to the social feed service with the caller's user id attached, and hands the response back for the route to relay. Unit tested. |
| `tag_score_decay.rs` | `decay_due_users` and the background job that runs it: halves each user's tag scores once a week in one transaction per user, skipping users whose highest score is below 5, tracked by a week number per user in `tag_scores_metadata`. Unit tested. |

## Listening analytics

`analytics/` is definitions only. No SQL runs here and it touches no connection; `db::events` and
`db::analytics` are what execute against the database. That split is the point: the event types
and the metric list can change without touching a query, and a query can change without touching
them.

Adding a metric is one entry in `Metric::ALL`. Both `/analytics/summary` and `/analytics/trends`
read that list, so neither needs a code change to pick it up. The `aggregate` string is
interpolated into SQL rather than bound, so it has to stay a literal written in that file, and it
has to come back as `bigint` (postgres sums a bigint into numeric, so a `sum` needs `::bigint`). A
unit test checks no aggregate contains a statement break.

Adding a dimension is one entry in `Dimension::ALL`. `db::analytics::get_top_entities` serves all
three rankings from one query, so a new dimension needs no handler. Tags are deliberately not a
dimension: they group through a join to `user_tags_applied` rather than a payload key, so they
keep their own query, the same split replays already have.

Adding an event type is one variant in `EventType`. The database stores `event_type` as plain text
and constrains nothing, so this is a deploy and not a schema change, which is the whole reason it
is not a postgres enum.

`sanitize_timezone` falls back to UTC rather than erroring on an unrecognized zone. Postgres
raises on an unknown zone name, which would turn one misconfigured client into a 500; losing the
right bucket is better than losing the event.

## How it works

The generation stage is behind a trait so the provider can be swapped without touching any
caller:

```rust
#[async_trait]
pub trait TagGenerator: Send + Sync {
    async fn generate_tags(&self, song_descs: &[String], requested_tag_count: usize)
        -> Result<Vec<Vec<TagSpecs>>, TagGenerationError>;
}
```

`TagGenerationError` has two variants. `RateLimited { retry_after: Option<Duration> }` is the
provider turning the request away, with whatever its headers said about the wait.
`Other(String)` is everything else, as free text. It converts `From<String>` and `From<&str>`,
so a generator can still write `Err("...".into())`, and `From<TagGenerationError>` turns it into
a `CadenzaError`: `RateLimited` becomes `CadenzaError::TagGenerationRateLimited` (429) carrying
the same `retry_after`, `Other` becomes `CadenzaError::TagGenerationErr` (500).

Rate limiting is its own variant rather than more free text because a caller acts on it. The
default tag backfill job stands down for five minutes when it sees one, which it cannot do off a
string.

`TagGenerationService` is a newtype over `Arc<Box<dyn TagGenerator>>`, so it is `Clone` and lives
in `AppState`. It does two things on top of the trait: clamps `requested_tag_count` to
`DEFAULT_REQUESTED_TAG_COUNT` (7) when `None` and `MAX_REQUESTED_TAG_COUNT` (20) as a ceiling,
and converts the generator's error into a `CadenzaError`.

Input is a list of song descriptions, output is a list of tag lists in the same order. It is
batch-shaped even though the only caller today (`GET /tags/suggest`) passes exactly one song and
takes `result[0]`.

`OpenAiTagGenerator` posts to the OpenAI responses api (`gpt-4o-mini`, 60 second timeout) with a
schema-constrained system prompt, then parses a
`{"tags": [{"song": "...", "tags": [{"name": "...", "color": "#rrggbb"}]}]}` payload. Each entry
echoes its song's description back, which is how tags are matched to songs rather than by
position. It short circuits on an empty input list or a zero tag count, rejects combined
descriptions over `MAX_COMBINED_SONG_DESC_LENGTH` (2000 bytes), truncates any over-long tag list
from the model, and runs every tag through `normalize_tag_name` before returning. It ignores the
model's color and randomly chooses an accessible RGB palette color instead. The curated palette is
sorted by hue, followed by brown and gray, and every color has at least 4.5:1 contrast against its
preferred black or white foreground. Repeated names in one response share their first generated
color.

It checks the response status before the body, because a 429 body has no `output` and would
otherwise come back as a parse failure rather than as the rate limit it is. A 429 returns
`TagGenerationError::RateLimited`, with the wait read off the headers by `rate_limit_wait`:
`retry-after` in plain seconds when it is there, otherwise the longer of
`x-ratelimit-reset-requests` and `x-ratelimit-reset-tokens`, since both buckets have to refill
before the next call works. Those two are written in OpenAI's own `1s` / `88ms` / `1h2m3s`
format, which `parse_reset_duration` reads. Headers that say nothing readable still give a
`RateLimited` with no wait; the caller decides how long to stand down.

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
takes a slice of song ids and does nothing for the ones that already have a
`default_tags_generation` row, which is the common case and costs one indexed read. For the rest
it reads titles through `SongMetadataService` and formats them with `SongMetadata::description()`.

Then it claims every one of those songs with `db::tags::start_default_tag_generation`, which
writes an `in_flight` row, and only then calls the generator. Anything else reading the same song
while the call runs sees the row and skips it, so a second reader does not pay OpenAI for
generation that is already happening.

The claim is settled after the attempt, in `generate_and_store_default_tags`, which is split out
so the generator call and `db::tags::set_default_tags_on_songs` settle the same way. Both
succeeded means `finish_default_tag_generation` moves the rows to `done`. Either failed means
`clear_default_tag_generation` deletes them, so the next read retries rather than leaving the
song permanently tagless behind an `in_flight` row. A failure to clear is logged, not returned,
so the caller still sees what actually broke.

The Apple Music read happens before the claim, so a metadata failure writes no rows at all and
is simply retried. A song Apple Music has no catalog entry for is claimed and marked `done` with
no tags, because it has no title to generate from and leaving it unclaimed would call Apple again
on every later read. When no song in the batch is describable there is no generator call, and the
rows go straight to `done`.

It is called by the default tag read handlers in `src/routes/songs.rs` and by the backfill job
below, not by any write. Nothing generates default tags when a song is added to a library.

`spawn_default_tag_backfill` runs one pass on a `tokio` task every
`DEFAULT_TAG_BACKFILL_INTERVAL_SECS`, for as long as the server lives, so a song can have its
default tags before anyone reads it rather than paying for generation inside that first read. A
pass takes the newest songs with no `default_tags_generation` row, through
`db::user_songs::get_recent_songs_without_generated_default_tags`, and hands them straight to
`ensure_default_tags_generated`.

It asks `default_tags_generation` rather than `default_tags_applied` for the same reason the read
path does. A song Apple Music has no catalog entry for ends up with no applied tags but is still
marked `done`, so selecting on applied rows would hand the same unsatisfiable songs back every
pass and never reach the ones that need generating. Any row counts, `in_flight` included, so a
pass skips songs a live read is generating for right now.

A pass that comes back `CadenzaError::TagGenerationRateLimited` stops there and the job waits
`RATE_LIMIT_BACKOFF` (300 seconds) before the next one, through `Interval::reset_after`, so the
wait is exactly five minutes however short `DEFAULT_TAG_BACKFILL_INTERVAL_SECS` is. Nothing is
lost by stopping: `ensure_default_tags_generated` already dropped the claim on every song the
pass took, so the next pass picks the same songs up. Any other error is logged and the job
carries on at its usual interval.

`BackfillConfig::from_env` reads the three `DEFAULT_TAG_BACKFILL_*` vars and returns `None` when
the job is off, which is what it is unless `DEFAULT_TAG_BACKFILL_ENABLED` is `true`. `main.rs`
logs which way it went and only spawns the task when it got a config. Ticks are delayed rather
than burst, so a pass that outruns its interval is followed by a full interval of quiet instead
of another pass immediately.

### The weekly tag score halving

`spawn_tag_score_decay` runs `decay_due_users` on a `tokio` task at startup and then every
`CHECK_INTERVAL` (24 hours), for as long as the server lives. Scores only ever go up, through
`PATCH /tags/scores`, so without this a name the user cared about a year ago outranks one they
use now forever.

The interval is not what makes it weekly. What does is each user's `last_decay_week` in
`tag_scores_metadata`, counted from the unix epoch, so `0` is the week of 1 Jan 1970 and a week
is a flat 7 days from that point rather than a calendar week.

A pass lists the due users through `db::tag_scores::get_users_due_for_decay`: everyone with a
score whose week is before this one, or who has no row. Then each user gets `decay_user`, one
transaction of its own:

- **no row**: insert this week and leave their scores alone. The job has no idea when their scores
  last decayed, so they halve for the first time next week. This is also what happens to every
  existing user on the first pass after deploy.
- **row locked by another server, or already this week**: nothing. The lock is taken with
  `SKIP LOCKED`, so two servers split the users instead of queueing on each other.
- **due, highest score 5 or more** (`MIN_MAX_SCORE_TO_HALVE`): halve their scores, then write this
  week.
- **due, highest score below 5**: write this week and leave their scores alone. This is what
  keeps a quiet user's scores from all truncating to 0: once their top score is under 5 they stop
  moving, so their order survives until they score something again.

The halving and the week commit together, so a crash leaves each user either fully done or
untouched. A user whose transaction fails is logged and left for the next pass, and the loop
moves on. Each user's row is locked for one short transaction, so a `PATCH /tags/scores` from a
user only waits on their own halving, never on the whole pass.

Checking daily rather than weekly means a server restarted at any point in the week still
catches up within a day. A pass with nobody due is one query.

`is_due`, `should_halve`, and `week_since_epoch` are the pure parts, and where the tests live. A
clock reading before the epoch counts as week 0, which can only leave the job idle.

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
- `normalize_tag_name` is called from the OpenAI generator and from
  `src/db/tag_scores.rs::add_to_tag_scores`, which is the one path that hands it raw client input.
  Note that it is **not** applied to user-created tag names coming through `POST /tags`.
- `MAX_TAG_LENGTH` is 50 **bytes**, not characters, and the cut lands on a character boundary at or
  below it, so a name of multi-byte characters comes back shorter than 50 bytes rather than cut in
  the middle of one. It used to slice by byte index, which panicked on a name whose character
  straddled byte 50.
- Lowercasing happens after the cut, and a few characters get longer when lowercased, so a
  normalized name can come back a byte or two over `MAX_TAG_LENGTH`. Nothing stores tag names in a
  bounded column, so this is harmless.
- `canonicalize_tag_value` is called from `src/db/tags.rs::apply_user_tag` and
  `set_user_tag_value`, which both look up the tag's type through `get_owned_tag` first.
- `SongMetadataService` is built in `src/main.rs` and lives in `AppState`. Its only caller is
  `default_tags::ensure_default_tags_generated`.
- `ensure_default_tags_generated` is called by `src/routes/songs.rs::get_default_tags_on_song_handler`,
  `get_default_tags_on_songs_handler`, and `backfill_default_tags`. It owns the whole
  `default_tags_generation` lifecycle through `db::tags`: `start_`, `finish_`, and
  `clear_default_tag_generation`. Nothing else writes that table.
- The backfill job is spawned from `src/main.rs`, which is also where `BackfillConfig::from_env`
  decides whether it runs at all.
- `SocialFeedService` is built in `src/main.rs` from `SOCIAL_FEED_URL` and lives in `AppState`.
  Its only caller is `src/routes/social.rs`.
- `tag_score_decay` reads and writes `tag_scores_metadata` through `db::tag_scores_metadata`, and
  lists and halves users through `db::tag_scores::get_users_due_for_decay`, `get_max_score`, and
  `halve_user_tag_scores`. It is the only caller of all of them. It is spawned from `src/main.rs` unconditionally.

### The social feed proxy

`social_feed.rs` exists because the social feed service (`backend-api/social-feed/`, python)
has no auth and takes `user_id` as data. The id has to come from the verified JWT, so every
call goes through here.

`forward` builds `base_url/path`, keeps the original query string, and puts the user id where
the service reads it: the query string on a GET, the top level of the JSON body on anything
else. A body that is not a JSON object has nowhere to hold the id and comes back as
`CadenzaError::InvalidRequestBody` (422). A body that carries its own `user_id` has it
overwritten, so a client cannot act as someone else.

`build_url` and `with_user_id` are free functions so they can be tested without a service
running. The one method that does I/O returns the raw `reqwest::Response`, and
`routes/social.rs` relays its status, content type, and body unchanged. Nothing here reads the
response, so the service can add endpoints without touching rust.

## Gotchas

- `OpenAiTagGenerator::new()` calls `dotenv().unwrap()` and then `expect`s `OPENAI_API_KEY`, so a
  missing `.env` or key panics during server startup, not at first use.
- `MAX_COMBINED_SONG_DESC_LENGTH` is 2000 bytes across the whole batch, not per song.
  `TagGenerationService::generate_tags` splits the batch into as many generator calls as it
  takes to stay under it, and truncates any single description longer than that on its own.
- `SocialFeedService::new()` does not panic on a missing `SOCIAL_FEED_URL`, unlike the other
  services. It falls back to `http://localhost:3001`, so a misconfigured deployment proxies into
  nothing and `/social/*` answers 502 instead of failing at startup.
- The social feed service has no auth of its own. If it is reachable from outside, anyone can
  pass any `user_id`. Keep `SOCIAL_FEED_URL` on a private address.
- The integration tests in `openai_tag_generator.rs` are `#[ignore]`d because they spend real
  tokens. Comment header says last run Jul 26.
- Only rate limiting is structured. Everything else is `TagGenerationError::Other`, so that
  error detail is still free text with no shape to match on.
- Rate limiting is read off the status code and headers, not the error body, so a provider that
  reports a limit some other way would need its own check. Nothing retries inside the generator;
  the 429 goes straight back to the caller.
- Adding a provider means one new file next to `openai_tag_generator.rs`, an `impl TagGenerator`,
  and a one-line change in `main.rs`. Nothing else should need to know.
- `TagType::Text` has no length cap, unlike tag names (`normalize_tag_name` truncates to 50
  bytes). A client can store an arbitrarily long string as a text attribute value.
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
- The `in_flight` claim narrows the race but does not close it. It is written after the Apple
  Music read, so two reads that both pass `get_songs_without_generated_default_tags` before
  either claims still both generate. The insert upserts so nothing breaks, but the song costs two
  LLM calls. The backfill job is one more racer here.
- Nothing recovers a stuck `in_flight` row. A crash between the claim and the settle leaves the
  row behind, and because any row is skipped, that song never gets default tags again. There is
  no sweeper and no timeout; clearing the row by hand is the only way out.
- The decay job has no env var. Unlike the backfill it is always on, because it costs one short
  transaction per user a week and nothing outside the database. Changing `CHECK_INTERVAL` means editing the constant.
- A gap of several weeks still halves once. Each user's row records the week they were decayed
  in, not the weeks they owe, so a server down for a month comes back and halves once rather than
  four times.
- A stored week ahead of the clock is treated as done, not rewound. A machine whose clock is
  behind therefore skips a user instead of halving a week another server already covered.
- A pass is a loop, one transaction per user, so it gets slower as users grow. Every user
  decays on the same schedule.
- A user who removes their scores keeps their `tag_scores_metadata` row. It only goes when the
  auth user does, through the cascade.
- The threshold looks at a user's highest score only. A user with one score of 5 and the rest at
  1 or 2 is still halved, and those small scores truncate into ties or 0.
- The max score is read without locking the user's `tag_scores` rows. A score edit that lands
  between that read and the `UPDATE` can halve a user who just dropped below 5, or skip one who
  just rose to it. It sorts itself out the next week.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
