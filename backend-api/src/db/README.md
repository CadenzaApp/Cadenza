# db

The data access layer. Everything that touches postgres lives here, so handlers in
`src/routes/` never build a query themselves.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `entity`, `queries`, `tags`. |
| `tags.rs` | All tag reads and writes: list, look up, usage counts, tags on many songs, untagged songs, songs with a tag, create, delete, apply, unapply, and reading and replacing default tags. |
| `queries.rs` | Compiles a boolean tag query from JSON to SQL and runs it. |
| `entity/` | sea-orm-codegen output. `tags`, `user_tags_applied`, `default_tags_applied`, plus `prelude` and `mod`. Do not hand edit. |

## Schema

Three tables, keyed on song ids that come from Apple Music.

- `tags` - `tag_id` (bigserial pk), `name`, `color`, nullable `user_id`. A null `user_id` means
  the tag is a default, not owned by any user.
- `user_tags_applied` - tags a user put on a song. Composite pk of `(song_id, user_id, tag_id)`.
  Cascades on delete from `tags`. The query compiler reads only this table.
- `default_tags_applied` - default tags on a song, composite pk of `(song_id, tag_id)`, no user,
  so every user sees the same ones. `get_default_tags_on_songs` reads it, and
  `set_default_tags_on_songs` replaces a song's rows, creating any default tag it names that does
  not exist yet.

## Default tags

`get_user_tags_on_songs` is the one read behind every song tag endpoint. It seeds an empty list
for each requested song, fills in the user's tags, then calls `get_default_tags_on_songs` for the
songs still empty. `get_untagged_songs` calls it and keeps the songs that came back empty.

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
- `set_default_tags_on_songs` takes `services::tag_generation::GeneratedTag` straight from the
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
- The default tag fallback is all or nothing per song. A song with even one of the user's tags
  gets only the user's tags. So "untagged" in `get_untagged_songs` means no tags of either kind.
- Default tags are only read through `get_user_tags_on_songs`. `get_songs_with_user_tag`,
  `get_all_user_tags`, `get_user_tags_metadata`, and the query compiler are user scoped and ignore
  them, so a song showing only default tags will not match a query or add to a tag's count.
- `get_user_tags_on_songs` seeds its map from the requested ids first, so every song asked for
  has an entry whether or not it has tags. Same idea as `get_user_tags_metadata`.
- `delete_user_tag` and `unapply_user_tag` silently no-op when nothing matches, rather than
  returning `NotFound`. That includes being asked to unapply a default tag.
- `set_default_tags_on_songs` matches existing default tags by name, and deletes a song's old rows
  before inserting the new ones without a transaction.
- `get_user_tags_metadata` returns a `HashMap<i64, TagMetadata>` keyed by tag id. Tags with no
  applications still get an entry, with `count: 0`.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
