# routes

HTTP handlers. One module per resource, each exposing a `get_*_router() -> Router<AppState>`
that `main.rs` nests under a path prefix. Handlers stay thin: they pull state, check auth,
call into `src/db/` or `src/services/`, and shape the response.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `json`, `comments`, `queries`, `tags`, `songs`. |
| `tags.rs` | Tag CRUD for the signed-in user, tag score edits, default tag search, listing the activity tags, plus LLM tag suggestion. Mounted at `/tags`. |
| `songs.rs` | Adding and removing the user's songs, reading and changing user tags, reading default tags, reading activity tags, and recording plays. Mounted at `/songs`. |
| `queries.rs` | Runs a tag query and returns song ids by relevance. Mounted at `/queries`. |
| `comments.rs` | Reading, leaving, deleting, and voting on comments on songs. Mounted at `/comments`. |
| `json/mod.rs` | `vec_into`, a small `Vec<A> -> Vec<B>` helper. Declares `comment`, `query`, `tag`, and `tag_score`. |
| `json/tag.rs` | `TagType`, `Tag`, and `AppliedTag`, the wire shapes of a tag. `From<tags::Model>` drops `user_id` and keeps `is_activity`. |
| `json/tag_score.rs` | `ScoredTag`, one top tag as a `[score, color, source]` array, and `TagSource`, `"local"` or `"global"`. |
| `json/comment.rs` | `Comment` and `CommentThread`, the wire shapes of a comment and of a top level comment with its replies. Both take the reading user's id, to turn `user_id` into `mine`, and each comment's vote tally. |
| `json/query.rs` | `Query`, `QueryNode`, `Filter`, `FilterOp`: the input schema of a tag query. Both client builders produce it. |

## Endpoints

Every route below requires `Authorization: Bearer <supabase jwt>`.

| method | path | input | output |
| --- | --- | --- | --- |
| GET | `/tags` | none | `{"All": {tags: [Tag], metadata: {tag_id: {count}}}}` |
| GET | `/tags?tag_id=N` | query param | `{"One": {tag, song_ids}}`, 404 if the tag does not belong to the signed-in user |
| POST | `/tags` | `{name, color, type?}` | the new tag id, as a bare number in the body; 409 when the user already owns that normalized name |
| PATCH | `/tags` | `{tag_id, name?, color?}` | the updated tag. 404 if the tag is not yours; 409 when its new name matches another tag you own |
| DELETE | `/tags` | `{tag_id}` | empty. Silently no-ops if the tag is not yours |
| GET | `/tags/scores` | `?k=N` | `{tag_name: [score, color, "local" \| "global"]}`, the user's `k` highest scores, 0 and below and names with no tag left out. `k` is at most 200 |
| PATCH | `/tags/scores` | `{"pop": 5, "rock": 10, "jazz": -2}` | `{tag_name: score}`, the score every named tag is left at |
| GET | `/tags/default-tags` | `?search=...` | `[Tag]`, at most 5 default tags matching the search, most used first |
| GET | `/tags/activity` | none | `[Tag]`, every activity tag in display order. The same for every user |
| GET | `/tags/suggest` | `?song_desc=...&requested_tag_count=N` | `[{name, color}, ...]` |
| PATCH | `/songs` | `{add: [...], remove: [...]}` | empty. Adds and removes the user's songs |
| GET | `/songs/local-tags` | `?song_id=...` | `[AppliedTag]`, the user's tags on that song |
| POST | `/songs/local-tags/batch` | `{song_ids: [...]}` | `{song_id: [AppliedTag]}`, an entry per requested song |
| PATCH | `/songs/local-tags/batch` | `{song_ids: [...], tag_ids: [...]}` | empty. Applies every tag to every song, preserving existing applications and values |
| DELETE | `/songs/local-tags/batch` | `{song_ids: [...], tag_ids: [...]}` | empty. Removes every tag from every song; missing applications are ignored |
| GET | `/songs/default-tags` | `?song_id=...` | `[Tag]`, the shared default tags on that song, minus the ones this user removed. Generates them first if the song has never had them |
| POST | `/songs/default-tags/batch` | `{song_ids: [...]}` | `{song_id: [Tag]}`, the same read for a list of songs, an entry per requested song. Generates for any that have never had defaults |
| DELETE | `/songs/default-tags` | `{song_id, tag_id}` | empty. Records that this user removed the suggested tag and counts it. 404 if the tag is not a default tag on the song |
| POST | `/songs/local-tags` | `{song_id, tag_id, value?}` | empty. Also votes for the tag name |
| PATCH | `/songs/local-tags` | `{song_id, tag_id, value}` | empty. A null value clears it |
| DELETE | `/songs/local-tags` | `{song_id, tag_id}` | empty. Takes that vote back when it removes the tag |
| GET | `/songs/activity-tags` | `?song_id=...` | `[AppliedTag]`, every activity tag with this user's value on that song. Never played: My Plays is `"0"`, the dates `null` |
| POST | `/songs/activity-tags/batch` | `{song_ids: [...]}` | `{song_id: [AppliedTag]}`, the same read for a list of songs, an entry per requested song |
| POST | `/songs/plays` | `{song_id}` | empty. Counts one play at the server's clock: My Plays +1, First Played and Last Played moved as needed |
| POST | `/queries/results` | `{query, consider_default_tags?}` | `["songid", ...]`, most relevant first |
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

`PATCH /tags/scores` tracks which tag names the signed in user is interested in. The body is a map
of tag name to how far to move that name's score, so one interaction sends one request however many
tags it touched. A name the user has no score for starts at its delta, a negative delta lowers the
score, and the response is the score every named tag is left at.

Scores go by tag name, not tag id, so they cover the user's own tags, default tags, and names they
have no tag of at all. Names are lowercased, whitespace collapsed, and cut to 50 bytes by
`services::tag_normalizer::normalize_tag_name` first, so `"Pop"` and `" pop "` are one score, and
two names in one body that collapse into one have their deltas added together. See
[../db/README.md](../db/README.md) for the upsert.

`GET /tags/scores?k=N` reads them back: the signed in user's `k` highest scores, keyed by the same
normalized tag name `PATCH` uses. Each value is a three element array, `[score, color, source]`,
so the client can draw the name as a tag. `color` is the user's own tag's when they have a tag of
that name, and `source` is then `"local"`. Otherwise it is the default tag's, and `source` is
`"global"`. A map has no order, so the client sorts it.

Scores of 0 and below are left out, and so are names with no tag at all, like one the user deleted.
A user with fewer than `k` names left gets all of those. Where the `k`th place is a tie, the names
that sort first make the cut, so the same scores always pick the same names.

`GET /tags/default-tags` searches the shared default tag pool by name and is not song scoped.
It is the odd one out next to `/songs/default-tags`, which reads the defaults applied to one song.
Its results are ordered by how many songs carry the tag, most first.

`GET /songs/default-tags` reads `default_tags_applied` and returns only tags whose `user_id` is
null, leaving out the ones the signed in user removed. `POST /songs/default-tags/batch` is the
same read for a list of songs, and fills in an empty list for the songs
`db::tags::get_default_tags_on_songs` leaves out.
`PATCH /songs` is the only writer of `user_songs`. It removes before it adds, so a song id sent
in both lists ends up in the library, and adding a song already there or removing one already
gone does nothing. It does not touch default tags, and a removal leaves the user's own tags on
the song alone.

Default tags are generated lazily, by the endpoints that read them. Both `GET /songs/default-tags`
and `POST /songs/default-tags/batch` call `services::default_tags::ensure_default_tags_generated`
before the read: it asks `db::tags::get_songs_without_generated_default_tags` which of the
requested songs have no row in `default_tags_generation`, reads their titles from Apple Music
through `SongMetadataService`, claims them with an `in_flight` row, generates with
`TagGenerationService`, stores through `db::tags::set_default_tags_on_songs`, and moves the rows
to `done`. A generator or write failure deletes the rows instead, so the next read tries again.

A song with a row already, `in_flight` or `done`, is skipped, so two readers of the same new song
do not both pay for generation.

The client never sends song descriptions. The backend resolves each id to a title itself, so a
song Apple Music has no catalog entry for is marked `done` with no tags rather than being
retried on every read. This replaced `POST /songs/no-default-tags` and `POST /songs/default-tags`,
which took `[{song_id, desc}]` and are both gone.

`DELETE /songs/default-tags` remembers in `default_tags_removed` that this user removed the song's
suggested tag and counts a remove against that tag name, which makes the name harder to promote
elsewhere. It does not take the default tag off the song: it stays there for everyone else, and
the generation path still treats the song as having defaults. The two reads above and a query run
with `consider_default_tags` all leave out this user's removals, so the tag stops coming back for
them.

Activity tags (My Plays, First Played, Last Played) are shared tag rows with `is_activity` set.
`GET /tags` leaves them out, since they belong to no user, and so do the default tag routes.
`GET /tags/activity` lists them for the query builders, and `GET /songs/activity-tags` and its
batch read their values per song. The only write is `POST /songs/plays`, which goes to
`db::activity_tags::record_play`. Writing one by hand through `/songs/local-tags` fails:
`POST` and `PATCH` are `NotFound` because the tag is not the user's, and `DELETE` is
`ActivityTagReadOnly` (403). The client decides what counts as a play; see
`client-app/src/lib/play-tracker.ts`.

`queries.rs` is one handler. The query arrives already typed, because serde parses the body
straight into `Query`, so a bad shape is a `QueryFormatError` carrying serde's message. The
handler hands it straight to `db::queries::run_query`, which does the compiling, running, and
ranking.

The query runs over the caller's `user_songs` rows, which is what lets `is_not_applied` and other
negative filters match songs with no Cadenza tag rows. The client used to send its Apple Music
library as `song_ids`, capped at 50,000; that field is gone, and `PATCH /songs` is now how the
backend learns what is in the library.

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

- `crate::db::tags`, `crate::db::activity_tags`, `crate::db::tag_scores`, `crate::db::queries`, `crate::db::comments`, `crate::db::comment_votes`, and
  `crate::db::user_songs` for all data access.
- `crate::services::tag_generation::TagGenerationService` for `/tags/suggest`, and through
  `crate::services::default_tags` for the default tag reads.
- `crate::services::song_metadata::SongMetadataService` for the titles those reads generate
  default tags from.
- `crate::err::CadenzaError` for every error path.
- Client side: `client-app/src/lib/routes/*.ts` wraps every one of these in an SWR hook,
  including `client-app/src/lib/routes/comments.ts` for the `/comments` routes behind the
  player sheet's `CommentsPage`.

## Gotchas

- Saved queries are gone from the route. It used to take a `query_id` param whose branch was a
  `todo!()` that panicked the handler.
- `POST /queries/results` ignores an unknown field, so a client still sending `song_ids` gets no
  error, just results over whatever `PATCH /songs` last put in `user_songs`. A user who has never
  synced their library matches nothing.
- `tags.rs::get_songs_with_user_tag_handler` exists but is not routed anywhere. Dead code. The
  same data comes back from `GET /tags?tag_id=N`.
- `GET /tags/suggest` uses `requested_tag_count` as a **required** query param, not optional, so
  a request without it is a 422. The service clamps it to at most 20.
- Anything that reaches the tag generator can come back 429 `TagGenerationRateLimited` when
  OpenAI turns the request away: `GET /tags/suggest`, and the two default tag reads that generate
  on a miss. Nothing retries for the caller, so the client has to.
- `GET /tags/default-tags` treats a missing `search` the same as a blank one, and a blank search
  returns 5 tags rather than none. The cap of 5 is `DEFAULT_TAG_SEARCH_LIMIT` and is not a
  client-settable param.
- `POST /tags` returns the id as a bare string body, not JSON.
- `PATCH /tags/scores` caps a request at 200 tag names, and a name that normalizes to nothing (blank
  or whitespace only) is a `QueryFormatError` (422) rather than being skipped.
- A score delta of 0 still writes the row, which creates it at 0 for a name that had no score.
- `GET /tags/scores` requires `k`. A missing or negative `k` is axum's own 400 with a plain text
  body, not a `CadenzaError`. More than 200 is a `QueryFormatError` (422).
- `GET /tags/scores` keys by the normalized name, so a user tag named `Road Trip` comes back as
  `road trip`.
- `DELETE /tags`, `DELETE /songs/local-tags`, and `DELETE /comments` take a JSON body. Some HTTP
  clients will not send one on a DELETE.
- `GET /songs/local-tags` returns only the user's own tags. Default tags (`user_id IS NULL`) are
  available separately from `GET /songs/default-tags`.
- `POST /songs/local-tags/batch`, `POST /songs/default-tags/batch`, and
  `POST /songs/activity-tags/batch` are reads. They are POSTs because their id lists do not belong
  in a query string. All three cap out at 200 ids, as does `PATCH /songs` across its two lists.
  Songs with no tags come back as an empty list from the local and default batches, never
  missing, and every song gets all activity tags.
- `POST /songs/plays` trusts the client to call it once per play. Nothing stops a client from
  calling it in a loop.
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
