# db

The data access layer. Everything that touches postgres lives here, so handlers in
`src/routes/` never build a query themselves.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `comment_votes`, `comments`, `entity`, `queries`, `tag_activity`, `tag_scores`, `tags`, `user_songs`. |
| `tags.rs` | User tag CRUD and applied values, plus searching, reading, and applying default tags, and claiming, finishing, and dropping a song's default tag generation. User tag reads never copy or return defaults. |
| `tag_activity.rs` | Counts applies and removes of a tag name on a song in `default_tag_activity`, and promotes popular names to default tags. |
| `tag_scores.rs` | `add_to_tag_scores`: moves the user's score for each named tag by a delta, in one upsert. Unit tested. |
| `queries.rs` | Compiles a tag query to SQL, runs it, and ranks the matches. Unit tested. |
| `comments.rs` | Comment reads and writes: every comment on a song paired into threads, leaving a comment or a reply, and deleting the user's own comment. |
| `comment_votes.rs` | `CommentVote` and `VoteTally`. `set_comment_vote`, which casts, switches, or takes back the user's vote on a comment, and `get_song_vote_tallies`, the votes on each comment of a song as the reading user sees them. |
| `user_songs.rs` | `edit_user_songs`: adds and removes the user's songs in one transaction. `get_recent_songs_without_generated_default_tags`: the newest songs nothing has generated default tags for, which the backfill job walks. |
| `entity/` | sea-orm-codegen output. Includes tag, tag score, default-tag, and comment tables, plus `prelude` and `mod`. Do not hand edit. |

## Schema

The tables below are keyed on song ids that come from Apple Music.

- `tags` - `tag_id` (bigserial pk), `name`, `color`, nullable `user_id`, `type` (`tag_type` enum:
  `basic`, `text`, `datetime`, `number`, `checkbox`, `date`; defaults to `basic`). A null `user_id` means
  the tag is a default, not owned by any user.
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
- `tag_scores` - how interested a user is in a tag name. Composite pk of `(tag_name, user_id)`,
  plus `score`, a bigint defaulting to 0. Keyed by name rather than tag id, so one score covers
  the user's own tags, default tags, and names they have no tag of at all. `user_id` references
  `auth.users` and cascades, and carries a `gen_random_uuid()` column default that the api never
  leans on because it always sets the column. `PATCH /tags/scores` is the only thing that writes
  it, through `tag_scores.rs::add_to_tag_scores`. Nothing reads it yet.
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
  writes it, through `user_songs.rs::edit_user_songs`. The query compiler reads it: it is the set
  of songs a query runs over. Tag reads still work off `user_tags_applied` and do not check it, so a song can
  carry tags without a row here, and then no query will return it. This table was called
  `song_meta` before.
- `comment` - a comment a user left on a song. `id` (identity pk), `content`, `song_id`, `user_id`,
  and `created_at`, a `timestamp` with no time zone that defaults to `now()`. A reply sets `parent`
  to the comment it answers, a self fk that cascades, so deleting a comment deletes its replies.
  `song_id` is nullable, but the api fills it on every comment, replies included. `user_id`
  references `auth.users` with no cascade. See Comments below.
- `comment_votes` - a user's vote on a comment. Composite pk of `(user_id, comment_id)`, so one
  vote per user per comment, and `is_upvote`. Both fks cascade, to `comment` and to `auth.users`,
  so deleting a comment or a user deletes its votes.

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

## Tag scores

`tag_scores.rs::add_to_tag_scores` takes a map of tag name to delta and adds each delta to that
name's score for the user, in one multi-row upsert:
`ON CONFLICT (tag_name, user_id) DO UPDATE SET score = tag_scores.score + excluded.score`. A name
with no row yet starts at its delta, and a negative delta takes a score down, below zero included.

Names go through `services::tag_normalizer::normalize_tag_name` first, so a score belongs to a
lowercased name and `"Pop"` and `" pop "` are one row. `normalize_deltas` does that, rejects a name
that normalizes to nothing, caps a request at `MAX_SCORED_TAG_NAMES` (200) names, and adds up the
deltas of names that collapsed into one rather than letting one of them win.

It hands back a `BTreeMap`, so the statement writes rows in name order however the request listed
them. Two concurrent requests naming the same tags then lock those rows in the same order instead
of deadlocking each other.

The scores every named tag is left at come straight off the upsert's `RETURNING`, so the caller
does not read the rows back.

## Comments

`get_song_comments` reads every comment with the song's id in one query, oldest first, and
`into_threads` pairs them up: top level comments newest first, each with its replies oldest first.
One query is enough because a reply stores its parent's `song_id` too.

`new_comment` trims the content, which then has to be 1 to `MAX_COMMENT_CHARS` (2000) characters.
With a `parent_id` it looks the parent up first. A missing parent is `NotFound`. A parent that is a
reply, or is on another song, is `QueryFormatError`, so replies stay one level deep. A parent
deleted between that check and the insert trips `comment_parent_fkey`, which `err.rs` maps to
`NotFound`.

`delete_user_comment` deletes by comment id and user id in one statement, and returns `NotFound`
when nothing matched. The cascade takes the replies with it, whoever left them, and every vote on
them.

`comment_votes.rs::set_comment_vote` upserts the user's row on `(user_id, comment_id)` for an up or
down vote, so voting again switches the vote instead of adding one, and deletes the row for `None`.
An up or down vote on a comment that does not exist trips `comment_votes_comment_id_fkey`, which
`err.rs` maps to `NotFound`. Taking back a vote that was never cast does nothing.

`get_song_vote_tallies` is one grouped query over the votes on the song's comments. Each up vote
counts 1 and each down vote -1. Their sum is the comment's `votes`, and the max of that value over
the reader's rows alone, null when they did not vote, is `my_vote`. Comments with no votes are left
out, and `routes::json::comment` gives them 0 votes and no vote of the reader's.

## The query compiler

`queries.rs::run_query` is the interesting part. It takes the typed `Query` from
`routes/json/query.rs` (see [../routes/README.md](../routes/README.md) for the JSON) and a
`consider_default_tags` flag, and returns matching song ids most relevant first. There is one
compiler; the drag and drop builder just sends a query built only from `is_applied` and
`is_not_applied` tag filters.

The songs a query runs over are the user's `user_songs` rows, always. The caller does not supply
them: it used to send its Apple Music library as `song_ids` on the request, and that is gone.

Before compiling it checks the tree size (`MAX_NODES` 200, `MAX_DEPTH` 20), then looks up the type
of every tag id the query mentions. `get_queryable_tag_types` is user scoped, so another user's tag
or a deleted one is a `QueryFormatError`; with `consider_default_tags` a shared default tag is
queryable as well, removed or not. A query naming a default tag the user removed is valid and
simply matches nothing of theirs.

`applied_tags_source` is the single definition of what counts as a tag on a song, and every part
of the statement reads through it: the ranking left join and each filter subquery. Without the flag it is the user's own applied tags. With it, those `UNION ALL` the rows
in `default_tags_applied` that the user has no `default_tags_removed` row for, whose `value` comes
through as `NULL::text` because that table has no value column. So a default tag behaves exactly like an attribute tag applied without a value, and
`is_empty` matches a song that carries only the default. It is a subquery rather than a CTE so
postgres can push the correlated song id down into both branches and keep using the song id
indexes.

`compile_query` is pure and emits `(song id, tag id)` pairs in one shape. It starts from
`LIBRARY_SONGS_SOURCE`, the user's `user_songs` rows, and left joins their tag rows for scoring,
which is what lets a library song with no tag rows satisfy a negative filter:

```sql
SELECT query_songs.song_id, applied_tags.tag_id
FROM (SELECT song_id FROM user_songs WHERE user_id=$1) AS query_songs
LEFT JOIN <applied tags source> AS applied_tags
    ON applied_tags.song_id=query_songs.song_id
WHERE <compiled where clause>
```

`query_songs` is the row every filter correlates against.

- `and` / `or` join children, and an empty one is `TRUE` / `FALSE`. `not` wraps `NOT (...)`
  directly; there is no De Morgan pass here.
- Every filter is one correlated `EXISTS` or `NOT EXISTS` over the applied tags source. A tag
  filter looks at that tag's application on the song; `tag_name`, `tag_value` and `tag_type` look
  at every applied tag, joined to `tags`. The user id lives inside the source, not in each
  subquery's `WHERE`.
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
  placeholder. `$1` is always the user id, so the first filter binds at `$2`.

Operator / type mismatches, missing or extra values, bad numbers, and bad dates are all
`CadenzaError::QueryFormatError` (422) with a message saying which.

## Ranking

The statement returns pairs rather than bare song ids so `rank_songs` can score each song by how
many of the tag ids the query names it actually carries, most first. Equal scores fall back to
song id, so the same query comes back in the same order every time.

A query built only from `tag_name`, `tag_value` or `tag_type` filters names no tag ids at all, so
every song scores zero and the whole list is ordered by song id.

## Connects to

- Called by `src/routes/tags.rs`, `src/routes/songs.rs`, `src/routes/queries.rs`,
  `src/routes/comments.rs`.
- `queries.rs` reads its input types from `src/routes/json/query.rs`.
- Models convert to wire types through `From<tags::Model> for routes::json::tag::Tag`, and a
  model paired with its applied value through `From<(tags::Model, Option<String>)> for
  routes::json::tag::AppliedTag`. Comments convert through `routes::json::comment`, which also
  takes the reading user's id to fill in `mine`, and the tallies from `comment_votes.rs`.
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
  are independent, so a tagged song missing from `user_songs` still comes back from the tag
  reads while no query returns it. A user with no `user_songs` rows matches nothing at all.
- The `user_songs` pk leads with `song_id`, so the query compiler's `WHERE user_id=$1` cannot use
  it. `user_songs_user_id_idx` exists for that read. A lookup of one `(song_id, user_id)` pair
  still goes through the pk.
- `user_songs` was renamed from `song_meta`, and its pk and fk kept the old names,
  `song_meta_pkey` and `song_meta_user_id_fkey`. Anything matching on a constraint name, such as
  the mapping in `../err.rs`, has to use those.
- The removal join sits in two places, `default_tags_on_songs_query` and the default branch of
  `queries.rs::applied_tags_source`. A new read of `default_tags_applied` has to exclude removals
  itself.
- Tag scores are per tag name, not per tag id. Nothing ties a score to a `tags` row, so a score
  can name a tag the user deleted, a default tag, or a name they never had a tag of.
- A delta of 0 still writes the row, which creates it at 0 for a name that had no score.
- Nothing clamps a delta. Deltas that collapse into one name are summed saturating, but a delta
  big enough to overflow the bigint `score` comes back from postgres as a generic `DatabaseError`.
- Nothing reads `tag_scores` yet, so there is no endpoint or query that reflects a score.
- `comment` has no index on `song_id` or `parent`, so `get_song_comments` scans the table, and so
  does `get_song_vote_tallies`, whose join to `comment` filters on `song_id`. The `comment_votes` pk
  leads with `user_id`, so that join's `comment_id` side cannot use it either.
- `comment.user_id` references `auth.users` with no cascade, so deleting a Supabase user who has
  comments fails until those comments are gone.
- `comment.created_at` has no time zone. sqlx sessions and the database default both run in UTC, so
  `routes::json::comment` labels it UTC. A session in another time zone would write shifted times.
- Rows written outside the api that break the thread rules never come back from
  `get_song_comments`: a comment with no `song_id`, or a reply to a reply.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
