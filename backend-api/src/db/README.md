# db

The data access layer. Everything that touches postgres lives here, so handlers in
`src/routes/` never build a query themselves.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `advanced_queries`, `entity`, `queries`, `tag_votes`, `tags`. |
| `tags.rs` | User tag CRUD and applied values, plus reading, generating, and applying default tags. User tag reads never copy or return defaults. |
| `tag_votes.rs` | Counts user apply/unapply votes in `default_tag_votes` and promotes popular names to default tags. Holds the in-memory recent-vote cache. |
| `queries.rs` | Compiles a boolean tag query from JSON to SQL and runs it. |
| `advanced_queries.rs` | Compiles an advanced (filter based) query to SQL and runs it. Unit tested. |
| `entity/` | sea-orm-codegen output. Includes tag, default-tag, and comment tables, plus `prelude` and `mod`. Do not hand edit. |

## Schema

The tag tables are keyed on song ids that come from Apple Music.

- `tags` - `tag_id` (bigserial pk), `name`, `color`, nullable `user_id`, `type` (`tag_type` enum:
  `basic`, `text`, `datetime`, `number`, `checkbox`, `date`; defaults to `basic`). A null `user_id` means
  the tag is a default, not owned by any user.
- `user_tags_applied` - tags a user put on a song, plus a nullable `value` (text column, always
  the tag's canonical string form regardless of `type`; see
  [../services/README.md](../services/README.md)). Composite pk of `(song_id, user_id, tag_id)`.
  Cascades on delete from `tags`. Local tag reads and queries use this table.
- `default_tags_applied` - default tags on a song, composite pk of `(song_id, tag_id)`, no user.
  `get_default_tags_on_songs` reads it, and `set_default_tags_on_songs` replaces a song's rows.
- `default_tag_votes` - yes/no counts for a tag name on a song. A qualifying vote promotes the
  name to `default_tags_applied` and removes the vote row.
- `song_meta` - retained in the database but unused by the api. It has no generated entity now.

## Default tags and votes

Default tags remain separate from user tags. They are never copied into `tags` or
`user_tags_applied`, and user tag reads and boolean queries do not include them.

`get_songs_without_default_tags` returns requested song ids with no row in
`default_tags_applied`. `/songs/no-default-tags` uses it to tell the client which songs need
generated defaults. `GET /songs/default-tags` reads them, while `POST /songs/default-tags`
generates and stores them.

Applying a user tag votes yes on its name for the song, and removing it votes no. Once a name has
at least 10 votes and more than 1.5 times as many yes votes as no votes, it becomes a default tag
on that song. `TagVoteCache` remembers the latest vote per user, song, and tag name so a changed
vote moves a count rather than adding another one. The cache is process-local and best effort.

## The query compiler

`queries.rs::run_json_query` is the interesting part. Input is a recursive JSON tree where a
number is a tag id, plus an optional list of candidate song ids:

```json
{ "and": [ 12, { "or": [ 7, 9 ] }, { "not": 3 } ] }
```

Without candidates, `decode_query` evaluates the expression over songs that already have user
tag rows. With candidates, it starts from `unnest($2::text[])`, left joins user tag rows for
scoring, and evaluates the same correlated `EXISTS` clauses. This lets a library song with no
tag rows satisfy a negative condition.

The non-candidate form wraps the expression in:

```sql
SELECT song_id, tag_id FROM user_tags_applied AS query_songs
WHERE query_songs.user_id = $1 AND <compiled where clause>
```

`decode_query_json_node` walks the tree and emits one correlated `EXISTS (...)` subquery per tag
id, joined with `AND` / `OR`. `not` wraps its child expression in `NOT (...)`.

Tag ids are bound as parameters, never interpolated. `param_counter` starts at 2 when `$1` is
the user id, or 3 when `$2` contains candidate ids. Each recursive call returns the next index.

The return value is `song id -> the set of that song's tag ids`, which is what lets
`routes/queries.rs` rank results by how many of the queried tags each song has. Malformed input
becomes `CadenzaError::QueryFormatError` (422).

## The advanced query compiler

`advanced_queries.rs::run_advanced_query` takes the typed `AdvancedQuery` from
`routes/json/advanced_query.rs` (see [../routes/README.md](../routes/README.md) for the JSON). It
is a separate compiler; `queries.rs` is untouched and still serves the simple builder.

Before compiling it checks the tree size (`MAX_NODES` 200, `MAX_DEPTH` 20), looks up the type of
every tag id the query mentions (user scoped, so another user's tag or a deleted one is a
`QueryFormatError`).

`compile_advanced_query` is pure and emits:

```sql
SELECT DISTINCT song_id FROM user_tags_applied
WHERE user_tags_applied.user_id = $1 AND <compiled where clause>
ORDER BY song_id
```

- `and` / `or` join children, and an empty one is `TRUE` / `FALSE`. `not` wraps `NOT (...)`
  directly; there is no De Morgan pass here.
- Every filter is one correlated `EXISTS` or `NOT EXISTS`. A tag filter looks at that tag's
  application on the song; `tag_name`, `tag_value` and `tag_type` look at every applied tag,
  joined to `tags`.
- A missing tag counts as empty. So positive operators (`is`, `contains`, `before`, `gt`,
  `is_true`, `is_not_empty`, ...) are `EXISTS` a matching value, and negative ones (`is_not`,
  `not_on`, `ne`, `is_empty`, `is_null`, `is_not_applied`) are `NOT EXISTS` of the positive
  condition.
- `is_applied` / `is_not_applied` work on every tag type and skip the value check below, so they
  are the way to tell "applied with no value" from "not applied", which `is_empty` lumps together.
- Values are text in the db. Numbers compare as `value::double precision`. Datetimes compare to
  the minute: `date_trunc('minute', value::timestamptz AT TIME ZONE 'UTC')` against the same
  truncation of an RFC 3339 value, so seconds never matter and there is no time zone input.
  Dates compare as `value::date` against a `YYYY-MM-DD` day. Those casts sit inside
  `CASE WHEN tag_id = $n AND value IS NOT NULL`, because postgres does not promise to evaluate
  the other `WHERE` terms first and another tag's text would fail the cast.
- Text comparisons are case-insensitive, using `lower()`, `starts_with`, `right`, and `strpos`
  rather than `LIKE`, so `%` and `_` in user input are literal.
- Every value is bound, never interpolated. `Compiler::bind` pushes a value and returns its
  placeholder, and `$1` is always the user id.

Operator / type mismatches, missing or extra values, bad numbers, and bad dates are all
`CadenzaError::QueryFormatError` (422) with a message saying which.

## Connects to

- Called by `src/routes/tags.rs`, `src/routes/songs.rs`, `src/routes/queries.rs`.
- `advanced_queries.rs` reads its input types from `src/routes/json/advanced_query.rs`.
- Models convert to wire types through `From<tags::Model> for routes::json::tag::Tag`, and a
  model paired with its applied value through `From<(tags::Model, Option<String>)> for
  routes::json::tag::AppliedTag`.
- `set_default_tags_on_songs` accepts `services::tag_generation::TagSpecs` from the generator.
- Client side, the simple JSON tree is produced by
  `client-app/src/features/query-builder/QueryUtils.ts::queryToJSON`, and the advanced one by
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
- `get_user_tags_metadata` returns a `HashMap<i64, TagMetadata>` keyed by tag id. Tags with no
  applications still get an entry, with `count: 0`.
- `apply_user_tag` and `set_user_tag_value` both go through `get_owned_tag` first, which filters
  on `tags.user_id = user_id` to look up the tag's `type` for value validation. As a side effect
  this also closes off applying or setting a value on another user's tag id (previously
  unchecked). It also means a default tag (`user_id IS NULL`) can never be applied this way,
  even though the generation and voting paths can create defaults.
- Existing default tags copied into user tables by older code are not removed by this change.
- `TagVoteCache` is per process. Restarts, evictions, and multiple instances can overcount votes.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
