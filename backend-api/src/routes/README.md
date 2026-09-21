# routes

HTTP handlers. One module per resource, each exposing a `get_*_router() -> Router<AppState>`
that `main.rs` nests under a path prefix. Handlers stay thin: they pull state, check auth,
call into `src/db/` or `src/services/`, and shape the response.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `json`, `comments`, `queries`, `tags`, `songs`. |
| `tags.rs` | Tag CRUD for the signed-in user, default tag search, plus LLM tag suggestion. Mounted at `/tags`. |
| `songs.rs` | Reading and changing user tags, reading default tags, checking for missing defaults, and generating default tags. Mounted at `/songs`. |
| `queries.rs` | Runs a tag query and returns song ids by relevance. Mounted at `/queries`. |
| `comments.rs` | Reading, leaving, deleting, and voting on comments on songs. Mounted at `/comments`. |
| `json/mod.rs` | `vec_into`, a small `Vec<A> -> Vec<B>` helper. Declares `comment`, `query`, and `tag`. |
| `json/tag.rs` | `TagType`, `Tag`, and `AppliedTag`, the wire shapes of a tag. `From<tags::Model>` drops `user_id`. |
| `json/comment.rs` | `Comment` and `CommentThread`, the wire shapes of a comment and of a top level comment with its replies. Both take the reading user's id, to turn `user_id` into `mine`, and each comment's vote tally. |
| `json/query.rs` | `Query`, `QueryNode`, `Filter`, `FilterOp`: the input schema of a tag query. Both client builders produce it. |

## Endpoints

Every route below requires `Authorization: Bearer <supabase jwt>`.

| method | path | input | output |
| --- | --- | --- | --- |
| GET | `/tags` | none | `{"All": {tags: [Tag], metadata: {tag_id: {count}}}}` |
| GET | `/tags?tag_id=N` | query param | `{"One": {tag, song_ids}}`, 404 if the tag does not exist |
| POST | `/tags` | `{name, color, type?}` | the new tag id, as a bare number in the body |
| DELETE | `/tags` | `{tag_id}` | empty. Silently no-ops if the tag is not yours |
| GET | `/tags/default-tags` | `?search=...` | `[Tag]`, at most 5 default tags matching the search, most used first |
| GET | `/tags/suggest` | `?song_desc=...&requested_tag_count=N` | `[{name, color}, ...]` |
| GET | `/songs/local-tags` | `?song_id=...` | `[AppliedTag]`, the user's tags on that song |
| POST | `/songs/local-tags/batch` | `{song_ids: [...]}` | `{song_id: [AppliedTag]}`, an entry per requested song |
| POST | `/songs/no-default-tags` | `{song_ids: [...]}` | requested song ids with no default tags, in input order |
| GET | `/songs/default-tags` | `?song_id=...` | `[Tag]`, the shared default tags on that song, minus the ones this user removed |
| POST | `/songs/default-tags/batch` | `{song_ids: [...]}` | `{song_id: [Tag]}`, the same read for a list of songs, an entry per requested song |
| POST | `/songs/default-tags` | `[{song_id, desc}]` | empty. Generates defaults for songs that have none |
| DELETE | `/songs/default-tags` | `{song_id, tag_id}` | empty. Records that this user removed the suggested tag and counts it. 404 if the tag is not a default tag on the song |
| POST | `/songs/local-tags` | `{song_id, tag_id, value?}` | empty. Also votes for the tag name |
| PATCH | `/songs/local-tags` | `{song_id, tag_id, value}` | empty. A null value clears it |
| DELETE | `/songs/local-tags` | `{song_id, tag_id}` | empty. Takes that vote back when it removes the tag |
| POST | `/queries/results` | `{query, song_ids?, consider_default_tags?}` | `["songid", ...]`, most relevant first |
| GET | `/comments` | `?song_id=...` | `[CommentThread]`, every user's comments on the song, newest first, each with its `replies` oldest first |
| POST | `/comments` | `{song_id, content, parent_id?}` | the new `Comment`. `parent_id` makes it a reply to a top level comment on that song. `content` is trimmed and must then be 1 to 2000 characters |
| DELETE | `/comments` | `{comment_id}` | empty. Also deletes every reply to it. 404 if the user has no comment with that id |
| POST | `/comments/votes` | `{comment_id, vote}` | empty. `vote` is `"up"` or `"down"`, replacing the user's earlier vote, or `null` to take it back. 404 if an up or down vote names no comment |
| GET | `/test` | none | `server is reachable`. Defined inline in `main.rs`, not here |

`GET /tags` returns a serde-tagged enum, so the two shapes come back wrapped in `"One"` or
`"All"`. The client mirrors that in `client-app/src/lib/routes/tags.ts`.

`metadata` is keyed by tag id, separate from the `tags` array, so the client can look up a
count without walking the list.

`AppliedTag` is a `Tag` with the applied value flattened in, so it serializes as the tag's own
fields plus `value`. Both local-tag reads use it. `value` is always null for a basic tag, and null
for an attribute tag applied without one. Default tags have no values, so their read returns
`Tag` instead.

`type` on `POST /tags` and `POST` / `PATCH /songs/local-tags` is one of `basic`, `text`, `datetime`,
`date`, `number`, `checkbox` (see `sea_orm_active_enums::TagType`), and defaults to `basic` when omitted.
A `value` that does not fit the tag's type (not a number, not RFC 3339, not a
`YYYY-MM-DD` date, not `true`/`false`, or
any non-blank value on a `basic` tag) is rejected with `CadenzaError::InvalidTagValue` (422). See
[../services/README.md](../services/README.md) for the exact per-type rules.

A `Comment` is `{id, content, created_at, mine, votes, my_vote}`, and a `CommentThread` is a top
level `Comment` with a `replies` array of `Comment`s beside those fields. `mine` is true on the
signed in user's comments and stands in for the author, whose user id never leaves the api.
`created_at` is RFC 3339 in UTC, like `2026-09-15T18:03:11.482913Z`. `votes` is up votes minus down
votes, and `my_vote` is the signed in user's vote: `"up"`, `"down"`, or `null`.

### Query JSON

`query` on `/queries/results` is a `Query`. There is one query format; the drag
and drop builder is the subset of it that only uses `is_applied` and
`is_not_applied` tag filters:

```json
{
  "where": { "and": [
    { "filter": { "field": "tag", "tag_id": 4, "op": "on_or_after", "value": "1950-01-01" } },
    { "filter": { "field": "tag", "tag_id": 7, "op": "before", "value": "2024-06-01T18:30:00Z" } },
    { "not": { "or": [
      { "filter": { "field": "tag_name", "op": "contains", "value": "live" } },
      { "filter": { "field": "tag_type", "op": "is", "value": "checkbox" } }
    ] } }
  ] }
}
```

- `where` is the only top-level key. Anything else, including the old `timezone`, is rejected.
- A node is exactly one of `{"and": [node]}`, `{"or": [node]}`, `{"not": node}`,
  `{"filter": filter}`. The advanced builder's "none of the following" group is
  `{"not": {"or": [...]}}`.
- A filter is tagged by `field`: `tag` (with `tag_id`), `tag_name`, `tag_value`, or `tag_type`.
  `value` is always a string, and is omitted (or null) for operators that take none.

| field | ops | value |
| --- | --- | --- |
| `tag`, any tag type | `is_applied`, `is_not_applied` | none |
| `tag`, text tag; `tag_name`; `tag_value` | `is`, `is_not`, `starts_with`, `ends_with`, `contains` / `is_empty` | text / none |
| `tag`, datetime tag | `on`, `not_on`, `before`, `after`, `on_or_before`, `on_or_after` / `is_empty`, `is_not_empty` | RFC 3339, compared to the minute / none |
| `tag`, date tag | same as datetime | `YYYY-MM-DD` / none |
| `tag`, number tag | `eq`, `ne`, `lt`, `le`, `gt`, `ge` / `is_empty`, `is_not_empty` | a number as a string / none |
| `tag`, checkbox tag | `is_true`, `is_false`, `is_null` | none |
| `tag_type` | `is`, `is_not` | a tag type |

Basic tags only take `is_applied` / `is_not_applied`. Every other type takes them too, on top of
its own operators, and they ignore the value: an attribute tag applied without one still counts
as applied. `tag_name`, `tag_value` and `tag_type` do not take them.

Semantics and limits are in [../db/README.md](../db/README.md). Anything malformed is a
`QueryFormatError` (422) with a message.

## How it works

Handlers take what they need out of `AppState` by `FromRef`, so most take
`State(db): State<DatabaseConnection>` and nothing else. Tag suggestion and default generation
take `State(tag_gen_service)`. Routes that operate only on shared defaults still require credentials
with a bare `_: Claims<SupabaseClaims>`.

`GET /tags/default-tags` searches the shared default tag pool by name and is not song scoped.
It is the odd one out next to `/songs/default-tags`, which reads the defaults applied to one song.
Its results are ordered by how many songs carry the tag, most first.

`GET /songs/default-tags` reads `default_tags_applied` and returns only tags whose `user_id` is
null, leaving out the ones the signed in user removed. `POST /songs/default-tags/batch` is the
same read for a list of songs, and fills in an empty list for the songs
`db::tags::get_default_tags_on_songs` leaves out.
`POST /songs/no-default-tags` checks the same application table without creating user
state. `POST /songs/default-tags` skips songs that already have defaults, generates tags for the
rest, and stores them through `db::tags::set_default_tags_on_songs`.

`DELETE /songs/default-tags` remembers in `default_tags_removed` that this user removed the song's
suggested tag and counts a remove against that tag name, which makes the name harder to promote
elsewhere. It does not take the default tag off the song: it stays there for everyone else, and
the generation path still treats the song as having defaults. The two reads above and a query run
with `consider_default_tags` all leave out this user's removals, so the tag stops coming back for
them.

`queries.rs` is one handler. The query arrives already typed, because serde parses the body
straight into `Query`, so a bad shape is a `QueryFormatError` carrying serde's message. The
handler checks the `song_ids` cap and hands everything to `db::queries::run_query`, which does
the compiling, running, and ranking.

`song_ids` is the client's current Apple Music library, capped at 50,000. Sending it evaluates
the query over exactly those songs, which is what lets `is_not_applied` and other negative
filters match songs with no Cadenza tag rows. Omitting it evaluates over the previously
tagged-song universe instead.

`consider_default_tags` defaults to false. True widens what counts as a tag on a song to include
the shared default tags, for matching and for ranking, and lets the query name a default tag id.
Default tags the caller removed do not count, same as the reads. The client sets it from the
`Include suggested tags` toggle.

`comments.rs` handlers convert models with `json::comment`, passing `claims.user_id` so each
comment can say whether it is `mine`. `GET /comments` makes two reads, `db::comments::get_song_comments`
for the threads and `db::comment_votes::get_song_vote_tallies` for the votes, and `json::comment`
pairs them up by comment id. Grouping replies under their comments, the reply and content checks,
and storing votes live in `db::comments` and `db::comment_votes`. See `../db/README.md`.

`json/` exists so the wire format is decoupled from the SeaORM models. Anything that leaves the
api as JSON should have a type here rather than serializing an entity model directly.

## Connects to

- `crate::db::tags`, `crate::db::queries`, `crate::db::comments`, and `crate::db::comment_votes` for
  all data access.
- `crate::services::tag_generation::TagGenerationService` for `/tags/suggest` and
  `POST /songs/default-tags`.
- `crate::err::CadenzaError` for every error path.
- Client side: `client-app/src/lib/routes/*.ts` wraps every one of these in an SWR hook,
  including `client-app/src/lib/routes/comments.ts` for the `/comments` routes behind the
  player sheet's `CommentsPage`.

## Gotchas

- Saved queries are gone from the route. It used to take a `query_id` param whose branch was a
  `todo!()` that panicked the handler.
- `tags.rs::get_songs_with_user_tag_handler` exists but is not routed anywhere. Dead code. The
  same data comes back from `GET /tags?tag_id=N`.
- `GET /tags/suggest` uses `requested_tag_count` as a **required** query param, not optional, so
  a request without it is a 422. The service clamps it to at most 20.
- `GET /tags/default-tags` treats a missing `search` the same as a blank one, and a blank search
  returns 5 tags rather than none. The cap of 5 is `DEFAULT_TAG_SEARCH_LIMIT` and is not a
  client-settable param.
- `POST /tags` returns the id as a bare string body, not JSON.
- `DELETE /tags`, `DELETE /songs/local-tags`, and `DELETE /comments` take a JSON body. Some HTTP
  clients will not send one on a DELETE.
- `GET /songs/local-tags` returns only the user's own tags. Default tags (`user_id IS NULL`) are
  available separately from `GET /songs/default-tags`.
- `POST /songs/local-tags/batch`, `POST /songs/default-tags/batch`, and `POST /songs/no-default-tags`
  are reads. They are POSTs because their id lists do not belong in a query string. All three cap
  out at 200 ids. Songs with no tags come back as an empty list from the two tag batches, never
  missing.
- A user tag name becomes a default tag on a song once it has 10 counts in `default_tag_activity`,
  applies and removes together, with more than 1.5 times as many applies as removes. Applying a
  tag counts an apply, unapplying takes that apply back off, and `DELETE /songs/default-tags`
  counts a remove. This never copies the default into user tags, and nothing takes a default tag
  back off a song when the counts stop qualifying.
- `POST /songs/local-tags` inserts without checking first, so re-applying a tag relies on the unique
  violation mapping in `err.rs`. That mapping keys off the table name `applied_tags`, but the
  entity declares `user_tags_applied`, so it falls through to a generic `DatabaseError` instead
  of `TagAlreadyApplied`. See the table naming note in `../db/README.md`.
- `GET /comments` returns every comment on the song in one response. There is no paging.
- Replies go one level deep. `POST /comments` answers `QueryFormatError` when `parent_id` names a
  reply or a comment on another song, and `NotFound` when it names no comment.
- Deleting a comment deletes every reply to it, other users' replies included.
- A comment's author never leaves the api, only `mine`. There is no profile table, so the client
  signs the user's own comments with their email and everyone else's with a placeholder.
- `POST /comments/votes` treats a missing `vote` field like `null`, so it takes the vote back.
- `GET /comments` reads comments and votes in two queries, so a comment or vote written between
  them can come back with a stale tally until the next read.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
