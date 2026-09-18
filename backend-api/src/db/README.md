# db

The data access layer. Everything that touches postgres lives here, so handlers in
`src/routes/` never build a query themselves.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `comment_votes`, `comments`, `entity`, `queries`, `tag_votes`, `tags`. |
| `tags.rs` | User tag CRUD and applied values, plus searching, reading, generating, and applying default tags. User tag reads never copy or return defaults. |
| `tag_votes.rs` | Counts user apply/unapply votes in `default_tag_activity` and promotes popular names to default tags. Holds the in-memory recent-vote cache. |
| `queries.rs` | Compiles a tag query to SQL, runs it, and ranks the matches. Unit tested. |
| `comments.rs` | Comment reads and writes: every comment on a song paired into threads, leaving a comment or a reply, and deleting the user's own comment. |
| `comment_votes.rs` | `CommentVote` and `VoteTally`. `set_comment_vote`, which casts, switches, or takes back the user's vote on a comment, and `get_song_vote_tallies`, the votes on each comment of a song as the reading user sees them. |
| `entity/` | sea-orm-codegen output. Includes tag, default-tag, and comment tables, plus `prelude` and `mod`. Do not hand edit. |

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
- `default_tag_activity` - `apply_count` and `remove_count` for a tag name on a song, composite pk
  of `(song_id, tag_name)`. A yes vote adds to `apply_count` and a no vote to `remove_count`. A
  qualifying vote promotes the name to `default_tags_applied` and removes the row.
- `default_tags_removed` - a default tag a user took off a song. Composite pk of
  `(user_id, tag_id, song_id)`, with an fk on `(tag_id, song_id)` to `default_tags_applied` that
  cascades. The api does not read or write it yet.
- `song_meta` - retained in the database but unused by the api. It has no generated entity now.
- `comment` - a comment a user left on a song. `id` (identity pk), `content`, `song_id`, `user_id`,
  and `created_at`, a `timestamp` with no time zone that defaults to `now()`. A reply sets `parent`
  to the comment it answers, a self fk that cascades, so deleting a comment deletes its replies.
  `song_id` is nullable, but the api fills it on every comment, replies included. `user_id`
  references `auth.users` with no cascade. See Comments below.
- `comment_votes` - a user's vote on a comment. Composite pk of `(user_id, comment_id)`, so one
  vote per user per comment, and `is_upvote`. Both fks cascade, to `comment` and to `auth.users`,
  so deleting a comment or a user deletes its votes.

## Default tags and votes

Default tags remain separate from user tags. They are never copied into `tags` or
`user_tags_applied`, and user tag reads do not include them. A query includes them only when the
caller passes `consider_default_tags`.

`search_default_tags` searches the default tag pool itself rather than what is applied to a song:
it matches `tags` rows with a null `user_id` by name, capped by the caller. Results come back by
popularity, meaning how many `default_tags_applied` rows the tag has, most first, with name then
tag id breaking ties. That is a left join and a `GROUP BY tags.tag_id`, so a default tag applied to
no songs still comes back, last. It uses `strpos` rather than `LIKE`, so `%` and `_` typed into a
search box stay literal, same as the query compiler.

`get_songs_without_default_tags` returns requested song ids with no row in
`default_tags_applied`. `/songs/no-default-tags` uses it to tell the client which songs need
generated defaults. `GET /songs/default-tags` reads them, while `POST /songs/default-tags`
generates and stores them.

Applying a user tag votes yes on its name for the song, and removing it votes no. Once a name has
at least 10 votes and more than 1.5 times as many yes votes as no votes, it becomes a default tag
on that song. `TagVoteCache` remembers the latest vote per user, song, and tag name so a changed
vote moves a count rather than adding another one. The cache is process-local and best effort.

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
`routes/json/query.rs` (see [../routes/README.md](../routes/README.md) for the JSON), an optional
list of candidate song ids, and a `consider_default_tags` flag, and returns matching song ids most
relevant first. There is one compiler; the drag and drop builder just sends a query built only
from `is_applied` and `is_not_applied` tag filters.

Before compiling it checks the tree size (`MAX_NODES` 200, `MAX_DEPTH` 20), then looks up the type
of every tag id the query mentions. `get_queryable_tag_types` is user scoped, so another user's tag
or a deleted one is a `QueryFormatError`; with `consider_default_tags` a shared default tag is
queryable as well.

`applied_tags_source` is the single definition of what counts as a tag on a song, and every part
of the statement reads through it: the outer row source, the candidate left join, and each filter
subquery. Without the flag it is the user's own applied tags. With it, those `UNION ALL` the rows
in `default_tags_applied`, whose `value` comes through as `NULL::text` because that table has no
value column. So a default tag behaves exactly like an attribute tag applied without a value, and
`is_empty` matches a song that carries only the default. It is a subquery rather than a CTE so
postgres can push the correlated song id down into both branches and keep using the song id
indexes.

`compile_query` is pure and emits `(song id, tag id)` pairs in one of two shapes. Without
candidates it evaluates over songs that already have user tag rows:

```sql
SELECT query_songs.song_id, query_songs.tag_id
FROM <applied tags source> AS query_songs
WHERE <compiled where clause>
```

With candidates it starts from `unnest($2::text[])` and left joins the user's tag rows for
scoring, which is what lets a library song with no tag rows satisfy a negative filter:

```sql
SELECT query_songs.song_id, applied_tags.tag_id
FROM unnest($2::text[]) AS query_songs(song_id)
LEFT JOIN <applied tags source> AS applied_tags
    ON applied_tags.song_id=query_songs.song_id
WHERE <compiled where clause>
```

Either way `query_songs` is the row every filter correlates against, so the compiled clause is
the same in both.

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
  placeholder. `$1` is always the user id, and `$2` the candidate song ids when there are any, so
  the first filter binds at `$2` or `$3`.

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
- `TagVoteCache` is per process. Restarts, evictions, and multiple instances can overcount votes.
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
