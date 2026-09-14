# db

The data access layer. Everything that touches postgres lives here, so handlers in
`src/routes/` never build a query themselves.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `entity`, `queries`, `tags`. |
| `tags.rs` | All tag reads and writes: list, look up, usage counts, tags on many songs, untagged songs, songs with a tag, create, delete, apply, unapply, reading and replacing default tags, and initializing a user's songs. |
| `queries.rs` | Compiles a boolean tag query from JSON to SQL and runs it. |
| `entity/` | sea-orm-codegen output in the compact format. `tags`, `user_tags_applied`, `default_tags_applied`, `song_meta`, `sea_orm_active_enums` (the `TagType` enum), plus `prelude` and `mod`. Do not hand edit. |

## Schema

Four tables, keyed on song ids that come from Apple Music.

- `tags` - `tag_id` (bigserial pk), `name`, `color`, `type`, nullable `user_id`. A null `user_id`
  means the tag is a default, not owned by any user. `type` is the `tag_type` enum (`basic`,
  `text`, `datetime`, `number`, `checkbox`) and defaults to `basic`. The api never sets it, except
  that a copied default tag keeps the default's type.
- `user_tags_applied` - tags a user put on a song, plus the user's copies of a song's default
  tags. Composite pk of `(song_id, user_id, tag_id)`, and a nullable `value` nothing uses yet.
  Cascades on delete from `tags`. The query compiler reads only this table.
- `default_tags_applied` - default tags on a song, composite pk of `(song_id, tag_id)`, no user,
  so every user sees the same ones. `get_default_tags_on_songs` reads it, and
  `set_default_tags_on_songs` replaces a song's rows, creating any default tag it names that does
  not exist yet.
- `song_meta` - one row per song a user has been initialized on. Composite pk of
  `(song_id, user_id)`, with a cascading fk to `auth.users`. Also `times_listened`, which defaults
  to 0 and nothing writes yet.

## Default tags

A user gets a song's default tags once, when the song is initialized for them, meaning it gets a
`song_meta` row. After that the song's tags are only ever what the user leaves on it.

`get_user_tags_on_songs` is the one read behind every song tag endpoint. It calls
`init_user_songs` first, then reads the user's tags, so any copies are in what it returns.
`find_songs_to_init` looks at the requested songs with no `song_meta` row:

- a song the user already has tags on gets its row, and its default tags are not copied.
- a song with default tags gets the user's copies of them, then its row.
- a song with no tags of either kind is left alone, so default tags generated for it later still
  get copied on a later read.

`copy_default_tags_to_user` gives the user their own `tags` row for each default tag and applies
that row in `user_tags_applied`. A default tag reuses the user's tag with the same name if they
have one, and otherwise becomes a new tag of theirs with the default's name, color, and type.

`apply_user_tag` adds the song's `song_meta` row too, in the same transaction as the tag.
Without it, a song tagged before it had default tags would pick them up once that tag came off.

`get_untagged_songs` keeps the songs `get_user_tags_on_songs` returned empty, minus any that have
default tags. An initialized song can be empty and still have default tags, once the user removes
all of its tags.

Nothing in this directory generates tags. `routes/songs.rs` does that for
`POST /songs/default-tags`, using `get_default_tags_on_songs` to skip songs that already have
defaults and `set_default_tags_on_songs` to store the rest.

## The query compiler

`queries.rs::run_json_query` is the interesting part. Input is a recursive JSON tree where a
number is a tag id:

```json
{ "and": [ 12, { "or": [ 7, 9 ] }, { "not": 3 } ] }
```

`decode_query` wraps it in:

```sql
SELECT song_id, tag_id FROM user_tags_applied
WHERE user_tags_applied.user_id = $1 AND <compiled where clause>
```

`decode_query_json_node` walks the tree and emits one correlated `EXISTS (...)` subquery per tag
id, joined with `AND` / `OR`. `not` is not emitted as a wrapping `NOT (...)`. Instead it flips an
`inverted` flag that is threaded down the recursion, and De Morgan is applied on the way: an
inverted `and` joins with `OR`, an inverted `or` joins with `AND`, and an inverted tag id becomes
`NOT EXISTS`. Double negation cancels, since `not` just flips the flag again.

Tag ids are bound as parameters, never interpolated. `param_counter` starts at 2 because `$1` is
the user id, and each recursive call returns the next free index.

The return value is `song id -> the set of that song's tag ids`, which is what lets
`routes/queries.rs` rank results by how many of the queried tags each song has. Malformed input
becomes `CadenzaError::QueryFormatError` (422).

## Connects to

- Called by `src/routes/tags.rs`, `src/routes/songs.rs`, `src/routes/queries.rs`.
- Models convert to wire types through `From<tags::Model> for routes::json::tag::Tag`.
- `set_default_tags_on_songs` takes `services::tag_generation::TagSpecs` straight from the
  generator.
- Client side, the JSON tree is produced by
  `client-app/src/features/query-builder/QueryUtils.ts::queryNodeToJSON`.

## Gotchas

- **The error mapping uses old table names.** `src/err.rs` matches on `applied_tags` and
  `applied_tags_user_id_song_id_fkey`, but the table is `user_tags_applied`. So
  `TagAlreadyApplied` and `SongNotInLibrary` never fire; those cases fall through to a generic
  `DatabaseError`.
- `get_tag` does **not** filter by user, so `GET /tags?tag_id=N` will happily return another
  user's tag. The `song_ids` beside it are correctly user-scoped, so the leak is the tag name and
  color only. Worth fixing.
- `get_user_tags_on_songs` writes. Initializing songs creates tags, applications, and `song_meta`
  rows for the user, in a transaction holding a per-user `pg_advisory_xact_lock`, so two racing
  reads do not initialize the same song or create the same tag twice. `find_songs_to_init` runs
  once before the lock, so a read with nothing to initialize never takes it, and again under it.
- A song with no tags of either kind never gets a `song_meta` row from a read, so every read that
  includes it runs the three `find_songs_to_init` queries again. A song the model gave no tags
  stays that way.
- Default tags set on a song after it is initialized never reach that user.
- `song_meta` started out empty, after users already had tags. Songs they have tags on get a row
  on their next read, with no defaults copied. A song whose tags were all removed before
  `song_meta` existed gets its default tags copied once more.
- Copies match the user's existing tags by exact name, so a user tag `Rock` and a default `rock`
  stay two tags.
- `user_tags_applied` rows copied before copies got their own `tags` row still point at the shared
  default tag, with `user_id IS NULL`. The query compiler sees those, but `get_all_user_tags` and
  `get_user_tags_metadata` filter on `tags.user_id`, so they never list or count them.
- `get_user_tags_on_songs` seeds its map from the requested ids first, so every song asked for
  has an entry whether or not it has tags. Same idea as `get_user_tags_metadata`.
- `delete_user_tag` and `unapply_user_tag` silently no-op when nothing matches, rather than
  returning `NotFound`.
- `set_default_tags_on_songs` matches existing default tags by name, and deletes a song's old rows
  before inserting the new ones without a transaction.
- `get_user_tags_metadata` returns a `HashMap<i64, TagMetadata>` keyed by tag id. Tags with no
  applications still get an entry, with `count: 0`.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
