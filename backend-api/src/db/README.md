# db

The data access layer. Everything that touches postgres lives here, so handlers in
`src/routes/` never build a query themselves.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `entity`, `queries`, `tags`. |
| `tags.rs` | All tag reads and writes: list, look up, usage counts, tags on a song, songs with a tag, create, delete, apply, unapply. |
| `queries.rs` | Compiles a boolean tag query from JSON to SQL and runs it. |
| `entity/` | sea-orm-codegen output. `songs`, `tags`, `tags_applied`, plus `prelude` and `mod`. Do not hand edit. |

## Schema

Three tables, all keyed on ids that come from Apple Music.

- `songs` - `song_id` (text, pk) and an ignored pgvector `embedding` column. Nothing writes it
  yet.
- `tags` - `tag_id` (bigserial pk), `name`, `color`, nullable `user_id`, ignored `embedding`.
  `(name, user_id)` is unique. **A null `user_id` means the tag is global**, shared by every
  user. That is what `is_global_tag` checks.
- `tags_applied` - the join. Composite pk of `(song_id, user_id, tag_id)`. Cascades on delete
  from both `songs` and `tags`.

## The query compiler

`queries.rs::run_json_query` is the interesting part. Input is a recursive JSON tree where a
number is a tag id:

```json
{ "and": [ 12, { "or": [ 7, 9 ] }, { "not": 3 } ] }
```

`decode_query` wraps it in:

```sql
SELECT song_id, tag_id FROM local_tags_applied
WHERE local_tags_applied.user_id = $1 AND <compiled where clause>
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
- Client side, the JSON tree is produced by
  `client-app/src/features/query-builder/QueryUtils.ts::queryNodeToJSON`.

## Gotchas

- **Three names for one table.** The entity declares `tags_applied`, the raw SQL in `queries.rs`
  reads `local_tags_applied`, and the unique-violation mapping in `src/err.rs` matches on
  `applied_tags` and `applied_tags_user_id_song_id_fkey`. At most two of these can be right.
  Check the live schema before trusting any of them, and expect the `err.rs` mapping to be dead.
- `get_tag` does **not** filter by user, so `GET /tags?tag_id=N` will happily return another
  user's tag. The `song_ids` beside it are correctly user-scoped, so the leak is the tag name and
  color only. Worth fixing.
- `get_tags_on_song` and `get_songs_with_tag` include global tags (`user_id IS NULL`).
  `get_all_local_tags` and `get_local_tag_usage_counts` do not. So the tags tab and the tags on a
  song can disagree, by design.
- `delete_local_tag` and `unapply_local_tag` silently no-op when nothing matches, rather than
  returning `NotFound`.
- `embedding` is `#[sea_orm(ignore)]` on both `songs` and `tags`, so it never round trips. It is
  reserved for future similarity work.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
