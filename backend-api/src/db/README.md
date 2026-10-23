# db

The data access layer. Everything that touches postgres lives here, so handlers in
`src/routes/` never build a query themselves.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `activity_tags`, `analytics`, `entity`, `events`, `metadata_tags`, `profile`, `queries`, `social`, `tag_activity`, `tags`, `user_songs`. |
| `profile.rs` | Profile reads and writes: own profile, create with a default username from the email local part, and update username/bio. Unit tested. |
| `events.rs` | The write path for `listening_events`: `NewEvent` and `insert_events`, which is idempotent on `client_event_id` and reports which rows were new. |
| `analytics.rs` | The read path for `listening_events`: the metric summary, dense time bucketed trends, the song, artist, album, playlist and query rankings, replays, top tags with a cover song, tags played, the tag-colored heatmap, plays by hour, active days, and the event bounds. Integration tested against a real database (`--ignored`). |
| `activity_tags.rs` | `ActivityTag` (My Plays, First Played, Last Played, In My Library, Favorited, Tagged), finding their rows by `is_activity` and name, creating missing ones and recoloring stale ones, `record_play`, `set_favorites_within`, and reading their values per song with defaults filled in. Unit tested. |
| `tags.rs` | User tag CRUD and applied values, plus searching, reading, and applying default tags, and claiming, finishing, and dropping a song's default tag generation. User tag reads never copy or return defaults. |
| `tag_activity.rs` | Not activity tags. Counts applies and removes of a tag name on a song in `default_tag_activity`, and promotes popular names to default tags. |
| `queries.rs` | Compiles a tag query to SQL, runs it over every song Cadenza knows, and ranks, sorts, or groups the matches. Also sorts and groups a list of song ids the caller sends. Unit tested, plus integration tests against a real database (`--ignored`) that need `sql/metadata_tags.sql` and `sql/query_sort.sql`. |
| `social.rs` | Posts, likes, view status, interest scores, and the feed's SQL and score math. `post_likes` writes use the generated entity; `hot_score` and embeddings stay raw SQL. Embeddings come from `services::social_feed`. `topic_mk_id` is an optional Apple Music catalog id; song vs artist is not stored. `get_topic_posts` returns the posts for one catalog id, most liked first. Unit tested for the vector math. |
| `metadata_tags.rs` | The copy of Apple Music song metadata that queries and metadata tags read in `metadata_song_tags_applied`, and the album crawl queue in `metadata_albums`: storing songs, storing what a phone says about songs Apple's catalog has no entry for (`store_library_song_metadata`), finding ones with no row, and queueing, claiming, finishing, and releasing albums. Unit tested, plus integration tests against a real database (`--ignored`). |
| `user_songs.rs` | `edit_user_songs`: adds and removes the user's songs in one transaction. `get_recent_songs_without_generated_default_tags`: the newest songs nothing has generated default tags for, which the backfill job walks. |
| `entity/` | sea-orm-codegen output. Includes tag, default-tag, and related tables, plus `prelude` and `mod`. Do not hand edit. |

## Schema

Most of the tables below are keyed on song ids that come from Apple Music.

- `tags` - `tag_id` (bigserial pk), `name`, `color`, nullable `user_id`, `type` (`tag_type` enum:
  `basic`, `text`, `datetime`, `number`, `checkbox`, `date`; defaults to `basic`), and `is_activity`
  (bool, defaults to false). A null `user_id` means the tag is not owned by any user: a default tag,
  or an activity tag when `is_activity` is set. A check constraint keeps activity tags ownerless, a
  partial unique index keeps one activity tag per name, and a trigger refuses to delete one.
- `user_tags_applied` - tags a user put on a song, plus a nullable `value` (text column, always
  the tag's canonical string form regardless of `type`; see
  [../services/README.md](../services/README.md)). Composite pk of `(song_id, user_id, tag_id)`.
  Cascades on delete from `tags`. Local tag reads and queries use this table.
- `default_tags_applied` - default tags on a song, composite pk of `(song_id, tag_id)`, no user.
  `get_default_tags_on_songs` reads it, and `set_default_tags_on_songs` replaces a song's rows.
- `default_tags_generation` - one row per song whose default tags have been generated or are
  being generated right now. `song_id` alone as the pk, plus `status`, a `tag_gen_status` enum
  of `in_flight` and `done` with no column default, so every insert sets it. Not user scoped:
  generation happens once per song for everyone. `start_default_tag_generation` writes the
  `in_flight` row, `finish_default_tag_generation` moves it to `done`,
  `clear_default_tag_generation` deletes it when the attempt failed, and
  `get_songs_without_generated_default_tags` reads it. A `done` row means the attempt finished,
  not that it produced any tags. This table was called `default_tags_generated` before, and had
  no `status` column.
- `default_tag_activity` - what users did with a tag name on a song, composite pk of
  `(song_id, tag_name)`. `apply_count` is how many users have a tag of that name on the song, and
  `remove_count` how many removed it as a suggested tag. The row is written once and never
  deleted, so the counts outlive the promotion to `default_tags_applied`.
- `default_tags_removed` - one row per user who removed a default tag from a song, composite pk of
  `(user_id, tag_id, song_id)`, so a removal counts once. Its fk to `default_tags_applied`
  cascades, so a default tag coming off a song takes its removals with it. Default tag reads and
  queries hide the rows a user has here, and nothing else changes: the tag stays on the song for
  everyone else.
- `user_songs` - the songs in a user's library. Composite pk of `(song_id, user_id)`, plus
  `created_at`, a `timestamptz` that defaults to `now()` and is left `NotSet` on insert so the
  database stamps it rather than the api's clock. `user_songs_user_id_idx` on `user_id` alone so a
  whole-library read does not scan the table, and `user_songs_created_at_idx` on `created_at DESC`
  for the backfill job's walk of the newest songs. `user_id` references `auth.users` and cascades. `PATCH /songs` is the only thing that
  writes it, through `user_songs.rs::edit_user_songs`. The query compiler reads it: a song here
  is one of the user's own, which a query always returns in full when it matches. Tag reads still
  work off `user_tags_applied` and do not check it. This table was called `song_meta` before.
- `listening_events` - the append only log of what a user did while listening. `event_id`
  (bigserial pk), `user_id` (uuid, references `auth.users`, cascades), `event_type` (text),
  nullable `song_id` (text), `occurred_at` (timestamptz, the client's clock), `created_at`
  (timestamptz, defaults to `now()`, ours), `client_tz` (text, an IANA name, defaults to `UTC`),
  nullable `session_id` (uuid), `client_event_id` (text), and `payload` (jsonb, defaults to
  `{}`). A unique index on `(user_id, client_event_id)` is what makes ingest idempotent. Three
  more indexes cover the reads: `(user_id, occurred_at desc)`, `(user_id, event_type,
  occurred_at desc)`, and a partial `(user_id, song_id, occurred_at desc)` where `song_id` is
  not null, plus a partial `(user_id, session_id)` for the replay rollup. Rows are never updated
  or deleted outside of deleting the user. The DDL is `backend-api/sql/listening_events.sql`.
  See Listening events below.
- `posts` - a social feed post. `post_id` (identity pk), `user_id` (uuid, references
  `auth.users`, cascades), `content`, `embedding` / `embedding_w_bday` (pgvector), `likes`,
  `created_at`, `hot_score`, and nullable `topic_mk_id` (text), an Apple Music catalog id of
  the song or artist the post is about. Kind is not stored: the client asks MusicKit.
- `profile` - one public profile per auth user. `uid` (uuid pk, references `auth.users`, cascades),
  `username` (text, unique), and `bio` (text, defaults to `''`). A trigger on `auth.users` insert
  creates the row with username equal to the email local part (everything before `@`), appending
  a number when that name is taken. `POST /profile` does the same for a missing row. See Profiles
  below.
- `metadata_song_tags_applied` - a copy of each song's Apple Music metadata, one row
  per song, keyed by `song_id`. `source` is 'catalog' for what Apple's catalog said and
  'library' for what a phone said about a song only its library knows (an upload, or one Apple
  never matched); DDL in `sql/sort_group.sql`. A 'library' row is only ever one user's own song,
  so queries never discover it. `found` is false for an id Apple has no catalog entry for, which
  leaves every other column empty. `name`, `artist_name`, `album_name`, `album_id`,
  `duration_in_millis`, `genre_names` (`text[]`, never null, without Apple's catch-all "Music"),
  `release_date` (a year-only date is stored as January 1), `content_rating` (`explicit`, `clean`,
  or null for unrated), `fetched_at`, and `total_plays` (bigint, every user's counted plays of
  the song). Not user scoped and not authoritative. Read by the query compiler, where it is the
  set of songs from outside the user's own a query can return, what metadata filters look at, and
  what a sorted query sorts by, and by `GET /songs/metadata-tags`. Written only through
  `metadata_tags.rs`. DDL in `sql/metadata_tags.sql`.
- `metadata_albums` - the album crawl's state and work queue. `album_id` pk, `status`
  (`metadata_crawl_status` enum: `pending`, `in_flight`, `done`, `failed`), `attempts`,
  `queued_at`, and `crawled_at`. A partial index on `queued_at` where `status = 'pending'` is what
  the crawl claims from. See [../services/README.md](../services/README.md).

## Default tags, applies, and removes

Default tags remain separate from user tags. They are never copied into `tags` or
`user_tags_applied`, and user tag reads do not include them. A query includes them only when the
caller passes `consider_default_tags`. Either way, a default tag the reading user removed is left
out for them.

`search_default_tags` searches the default tag pool itself rather than what is applied to a song:
it matches `tags` rows with a null `user_id` by name, capped by the caller. Results come back by
popularity, meaning how many `default_tags_applied` rows the tag has, most first, with name then
tag id breaking ties. That is a left join and a `GROUP BY tags.tag_id`, so a default tag applied to
no songs still comes back, last. It uses `strpos` rather than `LIKE`, so `%` and `_` typed into a
search box stay literal, same as the query compiler.

`get_default_tags_on_songs` is user scoped: it left joins `default_tags_removed` on this user and
keeps the rows that found none, so a default tag they removed does not come back. Songs left with
no default tags drop out of the map.

`get_songs_without_generated_default_tags` returns requested song ids with no row in
`default_tags_generation` at all. The default tag read endpoints use it to pick which songs to
generate for, through `services::default_tags::ensure_default_tags_generated`.

The status does not change that answer: an `in_flight` row is skipped the same as a `done` one,
so a song something is already generating for is left to that attempt rather than generated
twice.

It deliberately asks `default_tags_generation` rather than `default_tags_applied`. Those two answer
different questions: a song the generator legitimately produced no tags for has no
`default_tags_applied` rows but must not be generated again, and neither must a song whose only
default tag was taken off later.

The three writes settle a generation attempt. `start_default_tag_generation` inserts the
`in_flight` rows before the generator call, upserting with `DO NOTHING` so a song claimed twice is
harmless and a row another attempt already moved to `done` is not dragged back.
`finish_default_tag_generation` sets `status` to `done` by song id.
`clear_default_tag_generation` deletes by song id, which is how a failed attempt gets retried on
the next read instead of sitting behind an `in_flight` row forever.

Applying a user tag counts an apply for its name on the song, and taking the tag off counts that
apply back off. Removing one of the song's suggested tags counts a remove. Every count comes from a
request that really wrote its row, the application row for an apply and the `default_tags_removed`
row for a remove, so nobody is counted twice. A name becomes a default tag on the song once it has
10 counts, applies and removes together, with more than 1.5 times as many applies as removes.

`count_tag_applied` upserts the row and adds 1 to `apply_count`, `count_tag_removed` does the same
for `remove_count`, and `count_tag_unapplied` takes 1 off `apply_count` with an update filtered on
`apply_count > 0`, so a count never goes negative and a missing row is a no-op. Activity rows are
never deleted, so `apply_promotes_tag` promotes only on the apply that first makes the counts
qualify. Only applies promote: an unapply lowers `apply_count`, and a remove is only possible on a
name that is already a default tag there.

Multi-song edits keep the same rules without issuing one statement per relation. `tags.rs` inserts
with `ON CONFLICT DO NOTHING` or deletes with `RETURNING`, so concurrent requests count only rows
they actually changed. `count_tags_applied` folds those rows by song and tag name into one bulk
upsert; `count_tags_unapplied` uses a `VALUES` CTE and one update. Inputs are deduplicated and sorted
before either relation write, keeping SQL and lock acquisition deterministic.

## Listening events

`listening_events` is the source of truth for everything in `analytics.rs`. Activity tags are a
derived view of it: a `play_counted` event is what moves My Plays, First Played, and Last Played,
a `song_favorited` or `song_unfavorited` event is what moves Favorited, and `routes::events` does
both in one transaction so the two cannot drift.

Event types live in `services::analytics::EventType`, not in the database. The column is plain
text and nothing constrains it, so adding a type is a Rust variant rather than an `ALTER TYPE`.
The tradeoff is that a typo in a hand-written insert will be stored; everything that goes through
the api is validated first.

Every listen ends in exactly one of `play_complete` or `skip`, and only those two carry
`payload.listened_ms`. That is what lets listening time be a plain `sum` with no double counting,
even though a single listen also emits `play_start` and `play_counted`.

`insert_events` returns `inserted` and `accepted` separately. `accepted` is everything now stored,
which is what the client clears from its queue; `inserted` is only the rows this call wrote.
Anything that reacts to an event has to key off `inserted`, or a retried batch counts twice.

Aggregation is SQL. `Metric` in `services::analytics::metrics` pairs a name with one aggregate
expression, and both the summary and the trends interpolate it into their own query, so adding a
metric needs no change in `analytics.rs` and no new handler. `Dimension` does the same one level
up: `get_top_entities` serves every ranking from one query, grouping by the
key that dimension supplies. Those expressions are interpolated
rather than bound, so they have to stay literals written in that file and must come back as
`bigint`: postgres sums a bigint into numeric, so any `sum` needs a `::bigint`. Reads that group
by something other than the window (top songs, replays, top tags, the heatmap) are each their own
function. Every read of "tags the user listened to" starts from `tagged_plays`, one shared join, so
the tag ranking, the tag count, and each heatmap cell's tag cannot disagree on what counts.
Tag listening time (`get_tag_shares`) is the exception: it counts the events that carry
`listened_ms`, not `play_counted`, so it builds on `LISTENED_MS` and `LISTEN_EVENTS` from
`metrics.rs`, the same pieces the `listening_ms` metric is made of. Its total and the summary's
cannot disagree, and each listen counts once per tag on its song, never split.

## Activity tags

An activity tag is one shared row in `tags` whose values the api writes per user as they listen.
There are six, the variants of `activity_tags.rs::ActivityTag`: My Plays (number), First Played
and Last Played (datetime), and In My Library, Favorited and Tagged (checkbox). The values of the
first four are ordinary `user_tags_applied` rows keyed on the listening user, so every reader of
that table, the query compiler included, sees them the same way as any other tag value.

In My Library and Tagged are derived (`ActivityTag::is_derived`) and never have a row. In My
Library is whether the song is in the user's `user_songs`. Tagged is whether the user has applied
any tag they own to the song: a suggested tag the user taps becomes their own tag first, so it
counts, while a suggested tag merely shown on the song and activity tags themselves do not. Both
are always current, with nothing to write or backfill.

Favorited is stored, as `"true"` or no row. `set_favorites_within` sets it for each song from the
user's latest `song_favorited` / `song_unfavorited` event in `listening_events`, by `occurred_at`,
not from the event that just arrived, so an older favorite flushed late from an offline queue
cannot undo a newer unfavorite. Apple Music owns favorites, and only changes made in Cadenza are
logged, so a song favorited elsewhere reads false.

Nothing hardcodes their ids. `get_activity_tags` selects by `is_activity` and name, and inserts any
that are missing with `ON CONFLICT (name) WHERE is_activity DO NOTHING`, so two requests racing to
create one both end up with the same row, and a wiped table heals on the next request. That
conflict target is the partial unique index in `sql/activity_tags.sql`; without it Postgres refuses
the insert, and every activity tag read and `POST /events` fails once a new tag is added.

They all share one color, `ACTIVITY_TAG_COLOR`. `get_activity_tags` also recolors any row whose
color differs, so changing the constant recolors existing rows on the next request with no SQL.

`record_play` upserts all three in one transaction: My Plays adds 1 to what is there, First
Played keeps the earlier of the stored and new time, and Last Played keeps the later. Values use
the same canonical forms `services::tag_values` writes: a plain integer, and RFC 3339 in UTC.

The same transaction adds the plays to the song's `total_plays` in `metadata_song_tags_applied`
(`metadata_tags::add_total_plays`), every user's plays together, so Total Plays moves with My
Plays and a retried event batch moves neither. A song with no metadata row is skipped, and loses
nothing: when its row is created, `store_song_metadata` counts its `play_counted` events from
`listening_events` in the same transaction, using `listening_events_play_counted_song_idx`.

`get_activity_tags_on_songs` returns every activity tag for every requested song, filling a
missing row with `ActivityTag::default_value`: `"0"` for My Plays, `"false"` for the checkboxes,
`None` for the dates. The derived two are computed per song. Those defaults are also what the
query compiler uses for a missing row, below.

Activity tags have a null `user_id`, the same as default tags, so every default tag read and write
in `tags.rs` also filters `is_activity = false`. User tag reads filter `tags.user_id` to the user,
which leaves them out on its own, so they never show on the Tags pages. `unapply_user_tag` refuses
them with `ActivityTagReadOnly`, and `apply_user_tag` / `set_user_tag_value` already refuse them
through `get_owned_tag`.


## Profiles

`username_from_email` takes everything before the first `@`, or `"user"` when that is empty.
`create_profile` uses that default when no username is passed, trims and checks length, and
refuses a username that still contains `@`. `update_profile` needs at least one of `username` or
`bio`. Duplicate `uid` maps to `ProfileAlreadyExists`, duplicate `username` to
`UsernameAlreadyTaken`, both through `err.rs` on the unique constraints.

## The query compiler

`queries.rs::run_query` is the interesting part. It takes the typed `Query` from
`routes/json/query.rs` (see [../routes/README.md](../routes/README.md) for the JSON), a
`consider_default_tags` flag, and an `Arrangement` (an optional sort and group, see Sorting and
grouping below), and returns the matching songs in order, each marked `certain` or not, plus
whether the list was `capped`, the groups, and the songs with no stored metadata. There is one compiler;
the drag and drop builder just sends a query built only from `is_applied` and `is_not_applied` tag
filters.

A query runs over every song Cadenza knows, in two groups. The caller does not supply them.

- The user's own songs, `certain`: their `user_songs` rows and every song carrying one of their
  `user_tags_applied` rows, activity tags included. Every match among these comes back.
- Every other `metadata_song_tags_applied` row with `found` set and `source` 'catalog': songs
  Cadenza stored from another library or an album crawl. A 'library' row is some user's own
  song that only their phone could describe, never one to discover.

Unsorted and ungrouped, every match among the user's own comes back, first, and only the first
`MAX_DISCOVERED_SONGS` (1000) of the rest. Sorted or grouped, the user asked for an order, so only
the first `MAX_ARRANGED_SONGS` (1000) songs in that order come back, theirs or not. Either way
`capped` says when more matched.

Default tags do not make a song the user's own. They sit on songs from every user's library, so
counting them would let "not pop" with suggested tags on return thousands of other people's songs
uncapped.

With `library_only` (the app's Show songs only in your library setting) the user's own songs are
just their `user_songs` rows, `LIBRARY_SONGS`, and the statement drops the second half, so nothing
is capped.

Before compiling it checks the tree size (`MAX_NODES` 200, `MAX_DEPTH` 20), then looks up the type
of every tag id the query mentions. `get_queryable_tags` is user scoped, so another user's tag
or a deleted one is a `QueryFormatError`. Activity tags are always queryable. With
`consider_default_tags` a shared default tag is queryable as well, removed or not. A query naming
a default tag the user removed is valid and simply matches nothing of theirs.

`applied_tags_source` is the single definition of what counts as a tag on a song, and every part
of the statement reads through it: the ranking join and each filter subquery. Without the flag it is the user's own applied tags. With it, those `UNION ALL` the rows
in `default_tags_applied` that the user has no `default_tags_removed` row for, whose `value` comes
through as `NULL::text` because that table has no value column. So a default tag behaves exactly like an attribute tag applied without a value, and
`is_empty` matches a song that carries only the default. It is a subquery rather than a CTE so
postgres can push the correlated song id down into both branches and keep using the song id
indexes.

`compile_query` is pure and emits rows already in their final order. The same where clause runs
over each group in its own half of a `UNION ALL`, and the second half has a `LIMIT`, so postgres
keeps the first 1001 songs from outside the user's own while it sorts rather than sorting every
stored song. Sorted or grouped, the first half and the whole list are limited the same way. That is also why ranking happens in SQL. Each half starts
from songs rather than tags, which is what lets a song with no tag rows satisfy a negative filter:

```sql
WITH own_songs AS (<user_songs UNION the user's tagged songs>)
SELECT song_id, certain FROM (
    (SELECT ... FROM <own_songs with their stored metadata> AS query_songs
        <score join> WHERE <compiled where clause>)
    UNION ALL
    (SELECT * FROM (SELECT ... FROM <stored songs not in own_songs> AS query_songs
        <score join> WHERE <compiled where clause>) AS discovered
     ORDER BY <order> LIMIT 1001)
) AS ranked
ORDER BY <order>
```

`query_songs` is the row every filter correlates against. Both halves bind the same placeholders.
`run_query` drops the 1001st song from outside the user's own, if there is one, and sets
`capped`.

- `and` / `or` join children, and an empty one is `TRUE` / `FALSE`. `not` wraps `NOT (...)`
  directly; there is no De Morgan pass here.
- Every filter is one correlated `EXISTS` or `NOT EXISTS` over the applied tags source. A tag
  filter looks at that tag's application on the song; `tag_name`, `tag_value` and `tag_type` look
  at every applied tag, joined to `tags`. The user id lives inside the source, not in each
  subquery's `WHERE`.
- A missing tag counts as empty, except for a number tag in `TagDefaults::numbers` (My Plays), where a
  missing row counts as its default, 0. The compiler works out whether the default passes the
  comparison and, when that differs from how a missing row would fare, adds `OR NOT EXISTS <tag on
  the song>` or `AND EXISTS <tag on the song>`. So "My Plays < 2" and "My Plays = 0" match songs
  never played, and "My Plays != 0" does not. `is_empty` / `is_not_empty` still look at the row.
  A checkbox in `TagDefaults::false_checkboxes` (Favorited) works the same way: a missing row is false, so
  `is_false` matches it.
- A derived activity tag (`TagDefaults::derived`: In My Library, Tagged) has no rows, so
  `derived_filter` compiles it straight to `EXISTS` on `user_songs`, or on the user's own tags in
  `user_tags_applied`. `is_true` / `is_applied` are that `EXISTS`, `is_false` / `is_not_applied`
  its `NOT`, `is_null` is `FALSE`, and any other operator is a `QueryFormatError`.
- Otherwise a missing tag counts as empty. So positive operators (`is`, `contains`, `before`, `gt`,
  `is_true`, `is_not_empty`, ...) are `EXISTS` a matching value, and negative ones (`is_not`,
  `not_on`, `ne`, `is_empty`, `is_null`, `is_not_applied`) are `NOT EXISTS` of the positive
  condition.
- `is_applied` / `is_not_applied` work on every tag type and skip the value check below, so they
  are the way to tell "applied with no value" from "not applied", which `is_empty` lumps together.
- A `metadata` filter is one correlated `EXISTS` or `NOT EXISTS` over the song's
  `metadata_song_tags_applied` row, with `found` required. So a song with no row, or one Apple has
  no entry for, counts as having every field empty, the same as a missing tag. `title`, `artist`
  and `album` take the text operators, and an empty string counts as empty. `genre` compares one
  genre at a time over `unnest(genre_names)`, so `is rock` is any genre being rock and
  `is_not rock` is none being rock. `release_date` takes the date operators against a real
  `date` column. `duration` takes the number operators in milliseconds. `explicit` takes `is_true`
  (rated explicit) and `is_false` (anything else, unrated included). `total_plays` takes the number
  operators without `is_empty` / `is_not_empty`, since a count is never null. Metadata filters
  name no tag ids, so they do not move a song's ranking score.
- Values are text in the db. Numbers compare as `value::double precision`. Datetimes compare to
  the minute: `date_trunc('minute', value::timestamptz AT TIME ZONE 'UTC')` against the same
  truncation of an RFC 3339 value, so seconds never matter and there is no time zone input.
  Dates compare as `value::date` against a `YYYY-MM-DD` day. Those casts sit inside
  `CASE WHEN tag_id = $n AND value IS NOT NULL`, because postgres does not promise to evaluate
  the other `WHERE` terms first and another tag's text would fail the cast.
- Text comparisons are case-insensitive, using `lower()`, `starts_with`, `right`, and `strpos`
  rather than `LIKE`, so `%` and `_` in user input are literal.
- Every value is bound, never interpolated. `Compiler::bind` pushes a value and returns its
  placeholder. `$1` is always the user id, so the first filter binds at `$2`.

Operator / type mismatches, missing or extra values, bad numbers, and bad dates are all
`CadenzaError::QueryFormatError` (422) with a message saying which.

## Ranking

Left unarranged, the user's own songs come first, then the rest. Inside each, songs come back
most relevant first: a song's score is how many of the tag ids the query names it carries, counted
in one grouped join over the applied tags source. Then songs with more `total_plays` (every user's
plays), then song id.

A query built only from `tag_name`, `tag_value`, `tag_type` or metadata filters names no tag ids
at all, so every song scores zero.

## Sorting and grouping

A sort or a group names one field: any tag the user can see on a song (their own, an activity tag,
or a shared default tag, whether or not the query considers default tags), or a metadata key. To
the user every one of these is a tag. `arrange_context` looks the tags up, user scoped, and checks
the time zone a datetime group counts days in against `pg_timezone_names`.

`field_sql` compiles a field to a state and a typed value, read for each song. The state is where
the song goes whichever way the sort runs: 0 for a value, 1 for the tag applied with no value, 2
for no tag at all. The value orders within state 0.

| field | value | ascending |
| --- | --- | --- |
| basic or default tag | none, only applied or not | applied first, either direction |
| checkbox | `value = 'true'` | true, then false |
| text, and title, artist, album, genre | the text, in `natural_sort` | A to Z |
| number, and duration, total plays | `value::double precision` | low to high |
| date, datetime, and release date | `value::date`, `value::timestamptz` | oldest first |

- The user's own tags and the stored activity tags are one `LEFT JOIN` on the `user_tags_applied`
  primary key. A song from outside the user's own carries none of their rows, so that half reads
  state 2 with nothing joined.
- My Plays reads 0 and Favorited false with no row, the same `TagDefaults` the filters use, so
  they are never empty. In My Library and Tagged are `EXISTS` on `user_songs` and on the user's
  own tags, and false for a song from outside.
- A default tag is a `LEFT JOIN` on `default_tags_applied`, less the user's
  `default_tags_removed`, in both halves, since default tags are on other people's songs too.
- Metadata reads the song's own row, carried on `query_songs`: genre as one text value joined with
  ", ", explicit as `explicit` true, `clean` false, unrated empty. A song with no row, or one
  Apple has no entry for, has every metadata value empty, state 1.

A group orders first, by the same state and its own value, then the sort orders inside it. Text
groups ignore case (`lower`), a datetime groups by its day in the request's time zone, and
everything else by its value. `groups_of` reads the groups back off the ordered rows as runs, each
named by its first song's value, so the counts always add up to the list.

Sorted, ties go by title, then `total_plays`, then song id. Grouped but unsorted, a query keeps its
ranking inside each group, and a list of ids keeps its given order.

Song id breaks every tie, compared byte by byte (`COLLATE "C"`), so the order is total and the
same request over the same data comes back in the same order every time. Each half's cap and the
final sort use one `order_by` string, so they always agree.

`arrange_song_ids` runs the same fields over a list of ids the caller sent, for a list only the
phone knows (a playlist, an album, a tag's songs). The ids come in as one JSON array read with
`json_array_elements_text ... WITH ORDINALITY`, every one is `certain`, none is capped, and
unsorted they keep their order.

Every arranged statement also returns whether each song had a stored row Apple knew, and the ids
without one come back as `missing_metadata`. See `store_library_song_metadata` below.

## Connects to

- Called by `src/routes/tags.rs`, `src/routes/songs.rs`, `src/routes/queries.rs`,
  `src/routes/profile.rs`.
- `queries.rs` reads its input types from `src/routes/json/query.rs`, and `QueryMatches`
  converts to `routes::json::query::QueryResults` for the response.
- Models convert to wire types through `From<tags::Model> for routes::json::tag::Tag`, and a
  model paired with its applied value through `From<(tags::Model, Option<String>)> for
  routes::json::tag::AppliedTag`.
- `set_default_tags_on_songs` accepts `services::tag_generation::TagSpecs` from the generator.
- Client side the same JSON comes from either
  `client-app/src/features/query-builder/QueryUtils.ts::queryToJSON` or
  `client-app/src/features/advanced-query-builder/AdvancedQueryUtils.ts::buildAdvancedQuery`.

## Gotchas

- **The error mapping uses old table names.** `src/err.rs` matches on `applied_tags` and
  `applied_tags_user_id_song_id_fkey`, but the table is `user_tags_applied`. So
  `TagAlreadyApplied` and `SongNotInLibrary` never fire; those cases fall through to a generic
  `DatabaseError`.
- `get_tag` does **not** filter by user, so `GET /tags?tag_id=N` will happily return another
  user's tag. The `song_ids` beside it are correctly user-scoped, so the leak is the tag name and
  color only. Worth fixing.
- Local tag reads ignore default tags. `get_user_tags_on_song` and `get_user_tags_on_songs`
  filter both the application and its joined tag by `user_id`; `get_songs_with_user_tag`,
  `get_all_user_tags`, and `get_user_tags_metadata` are user-scoped as well. None join
  `default_tags_applied`.
- `get_user_tags_on_songs` seeds its map from the requested ids first, so every song asked for
  has an entry whether or not it has tags. Same idea as `get_user_tags_metadata`.
- `get_user_tags_on_song` and `get_user_tags_on_songs` both return `(tags::Model, Option<String>)`
  pairs, not bare models, because the value lives on the application row rather than on the tag.
- `delete_user_tag` and `unapply_user_tag` silently no-op when nothing matches, rather than
  returning `NotFound`.
- `new_user_tag` and `update_user_tag` reject a name that normalizes to another tag the same user
  owns. Both take the same per-user PostgreSQL transaction advisory lock; renames also lock the
  user's current tag rows in tag-id order. Concurrent creates and renames therefore re-check after
  the first commit, including for a user with no existing tags. Shared default and activity tags do
  not participate. This remains an application convention until normalized names have a database
  uniqueness constraint.
- `get_user_tag` scopes a single-tag read by both tag id and user id; the detail endpoint never
  returns another user's tag metadata.
- `get_user_tags_metadata` returns a `HashMap<i64, TagMetadata>` keyed by tag id. Tags with no
  applications still get an entry, with `count: 0`.
- `apply_user_tag` and `set_user_tag_value` both go through `get_owned_tag` first, which filters
  on `tags.user_id = user_id` to look up the tag's `type` for value validation. As a side effect
  this also closes off applying or setting a value on another user's tag id (previously
  unchecked). It also means a default tag (`user_id IS NULL`) can never be applied this way,
  even though the generation and voting paths can create defaults.
- Existing default tags copied into user tables by older code are not removed by this change.
- Promotion does not demote. A default tag stays on the song however far its counts fall after
  that, and a later apply that makes them qualify again promotes a name that is already there,
  which `add_default_tag_to_song` treats as a no-op.
- Counts that already qualify without the name being a default tag, which old data can leave
  behind, promote on the next apply that crosses the line, not before.
- Counts are per tag name, not per user. A user with two tags of the same name on one song counts
  twice.
- A removal hides the default tag from that user's reads and queries, but never takes it off
  `default_tags_applied`. Other users still see it, and it never causes the song to be generated
  again, because generation is gated on `default_tags_generation` instead.
- `edit_user_songs` removes before it adds, so a song id sent in both lists ends up in the
  library. Neither half reports what it changed, so a caller cannot tell a real add from a song
  that was already there.
- A removal deletes only the library row. The user's tags on the song stay in
  `user_tags_applied`, so re-adding the song brings its tags back.
- A `done` row is never deleted, and there is no way to ask for a song to be generated again.
  Clearing the row by hand is the only retry.
- Nothing recovers a stuck `in_flight` row. The process that claimed it deletes it on failure,
  but a crash or a kill between the claim and the settle leaves the row behind, and every later
  read then skips that song. Nothing sweeps them, so clearing by hand is the only way out.
- The claim narrows the race but does not close it. Two reads can both pass
  `get_songs_without_generated_default_tags` before either inserts, and then both generate; the
  second `set_default_tags_on_songs` replaces the first one's tags. Wasted tokens, not corruption.
- `finish_default_tag_generation` writes its status through `col_expr`, which does not apply the
  column's `save_as`, so the value goes through `ActiveEnum::as_enum` to get the
  `CAST(... AS tag_gen_status)` postgres needs. `sea_query::ExprTrait::as_enum` shadows it in
  `tags.rs`, which is why the call is written out as `ActiveEnum::as_enum(&...)`.
- Nothing deletes a user's `user_songs` rows when their tags go, or vice versa. The two tables
  are independent. A tagged song missing from `user_songs` is still one of the user's own to a
  query, because it carries their tag.
- A query needs `sql/query_sort.sql` and `sql/sort_group.sql` applied. Without the
  `natural_sort` collation every sorted query fails, and without `sql/metadata_tags.sql` or the
  `source` column from `sql/sort_group.sql` every query does.
- `db/entity/metadata_song_tags_applied.rs` predates `source`. Nothing reads the column through
  the entity: catalog rows are inserted through it and take the column default, and library rows
  and the query compiler use raw SQL. Regenerating the entities adds the field.
- `store_library_song_metadata` writes only for a song the user has (library or tagged) or a
  library id (`i.`), and only over no row, a `found` false row, or an earlier library row, so a
  phone can never rename a catalog song or a song in someone else's list.
- A song stored under its library id in `user_songs` and under its catalog id in
  `metadata_song_tags_applied` can come back twice, once as the user's own and once not. The
  client shows one track for both. It is rare: `user_songs` and tags use the catalog id whenever
  Apple Music gives one.
- The `user_songs` pk leads with `song_id`, so the query compiler's `WHERE user_id=$1` cannot use
  it. `user_songs_user_id_idx` exists for that read. A lookup of one `(song_id, user_id)` pair
  still goes through the pk.
- `user_songs` was renamed from `song_meta`, and its pk and fk kept the old names,
  `song_meta_pkey` and `song_meta_user_id_fkey`. Anything matching on a constraint name, such as
  the mapping in `../err.rs`, has to use those.
- The removal join sits in two places, `default_tags_on_songs_query` and the default branch of
  `queries.rs::applied_tags_source`. A new read of `default_tags_applied` has to exclude removals
  itself.
- Activity tag rows live in `user_tags_applied`, so they count as tags on a song everywhere that
  table is read: `tag_name`, `tag_value` and `tag_type` filters see activity tags too, and a song's
  My Plays row counts toward ranking when the query names My Plays.
- The trigger stops `DELETE` on an activity tag, not `TRUNCATE`. After a truncate the next request
  recreates the rows with new ids, and the old values are gone with the cascade.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).

### Listening calendar and sessions

`analytics/listening.rs` adds duration buckets and recorded session/song reads. All use the existing
`LISTENED_MS` and `LISTEN_EVENTS` rules and attribute duration to the completion/skip event timestamp.
Tag membership uses a user-scoped `EXISTS`, so duplicate associations or many tags cannot multiply
an event. The listening read returns unfiltered total time and filtered metrics in one SQL snapshot.
Session groups and song durations are clipped to the requested window and tag filter. Tags are
collected after song aggregation. Missing session ids form an unassigned group and are excluded
from the recorded session count. Pagination fetches one extra row for continuation.

The new database integration test uses transaction-local temporary tables and rolls back; it does
not modify real user data. Run it explicitly with `cargo test listening_filters_and_sessions -- --ignored`.
