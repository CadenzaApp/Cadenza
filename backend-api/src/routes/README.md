# routes

HTTP handlers. One module per resource, each exposing a `get_*_router() -> Router<AppState>`
that `main.rs` nests under a path prefix. Handlers stay thin: they pull state, check auth,
call into `src/db/` or `src/services/`, and shape the response.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `json`, `queries`, `tags`, `songs`. |
| `tags.rs` | Tag CRUD for the signed-in user, plus LLM tag suggestion. Mounted at `/tags`. |
| `songs.rs` | Reading and changing user tags, checking for missing defaults, and generating default tags. Mounted at `/songs`. |
| `queries.rs` | Runs a boolean tag query and returns song ids by relevance, and runs an advanced query. Mounted at `/queries`. |
| `json/mod.rs` | `vec_into`, a small `Vec<A> -> Vec<B>` helper. Declares `advanced_query` and `tag`. |
| `json/tag.rs` | `TagType`, `Tag`, and `AppliedTag`, the wire shapes of a tag. `From<tags::Model>` drops `user_id`. |
| `json/advanced_query.rs` | `AdvancedQuery`, `AdvancedQueryNode`, `AdvancedFilter`, `FilterOp`: the input schema of an advanced query. |

## Endpoints

Every route below requires `Authorization: Bearer <supabase jwt>`.

| method | path | input | output |
| --- | --- | --- | --- |
| GET | `/tags` | none | `{"All": {tags: [Tag], metadata: {tag_id: {count}}}}` |
| GET | `/tags?tag_id=N` | query param | `{"One": {tag, song_ids}}`, 404 if the tag does not exist |
| POST | `/tags` | `{name, color, type?}` | the new tag id, as a bare number in the body |
| DELETE | `/tags` | `{tag_id}` | empty. Silently no-ops if the tag is not yours |
| GET | `/tags/suggest` | `?song_desc=...&requested_tag_count=N` | `[{name, color}, ...]` |
| GET | `/songs/local-tags` | `?song_id=...` | `[AppliedTag]`, the user's tags on that song |
| POST | `/songs/local-tags/batch` | `{song_ids: [...]}` | `{song_id: [AppliedTag]}`, an entry per requested song |
| POST | `/songs/no-default-tags` | `{song_ids: [...]}` | requested song ids with no default tags, in input order |
| GET | `/songs/default-tags` | `?song_id=...` | `[Tag]`, the shared default tags on that song |
| POST | `/songs/default-tags` | `[{song_id, desc}]` | empty. Generates defaults for songs that have none |
| POST | `/songs/local-tags` | `{song_id, tag_id, value?}` | empty. Also votes yes on the tag name |
| PATCH | `/songs/local-tags` | `{song_id, tag_id, value}` | empty. A null value clears it |
| DELETE | `/songs/local-tags` | `{song_id, tag_id}` | empty. Votes no when it removes the tag |
| GET | `/queries/results` | `?q=<query json>` | `["songid", ...]`, most relevant first |
| POST | `/queries/results` | `{query, song_ids}` | Matching candidate song ids, most relevant first |
| GET | `/queries/advanced/results` | `?q=<advanced query json>` | `["songid", ...]`, sorted by song id |
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

### Advanced query JSON

`q` on `/queries/advanced/results` is an `AdvancedQuery`:

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
  `{"filter": filter}`. The client's "none of the following" group is `{"not": {"or": [...]}}`.
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
`State(db): State<DatabaseConnection>` and nothing else. Song apply/unapply handlers also take
`State(tag_votes): State<TagVoteCache>`. Tag suggestion and default generation take
`State(tag_gen_service)`. Routes that operate only on shared defaults still require credentials
with a bare `_: Claims<SupabaseClaims>`.

`GET /songs/default-tags` reads `default_tags_applied` and returns only tags whose `user_id` is
null. `POST /songs/no-default-tags` checks the same application table without creating user
state. `POST /songs/default-tags` skips songs that already have defaults, generates tags for the
rest, and stores them through `db::tags::set_default_tags_on_songs`.

`queries.rs` is the only one with real logic in the route, and it is ranking, not data access.
The query tree arrives as a `q` query param holding JSON. `QueryResultsParams::into_json_query`
parses it, and a bad parse is `QueryFormatError`. `db::queries::run_json_query` returns
`song id -> its matched tag ids`. The handler walks the original query JSON to collect every tag
id mentioned, scores each song by how many of those it carries, and sorts descending. Ties keep
hashmap order, so equal-score results are unstable between requests.

The POST form receives current Apple Music library ids from the client and caps the list at
50,000. Candidate-based evaluation lets a negated tag match songs with no Cadenza tag rows. The
GET form remains available for callers that only need the previously tagged-song universe.

`advanced_query_results_handler` parses `q` straight into `AdvancedQuery` with serde, so a bad
shape is a `QueryFormatError` carrying serde's message, then hands it to
`db::advanced_queries::run_advanced_query`. There is no ranking; the db sorts by song id.

`json/` exists so the wire format is decoupled from the SeaORM models. Anything that leaves the
api as JSON should have a type here rather than serializing an entity model directly.

## Connects to

- `crate::db::tags`, `crate::db::queries`, and `crate::db::advanced_queries` for all data access.
- `crate::services::tag_generation::TagGenerationService` for `/tags/suggest` and
  `POST /songs/default-tags`.
- `crate::err::CadenzaError` for every error path.
- Client side: `client-app/src/lib/routes/*.ts` wraps every one of these in an SWR hook.

## Gotchas

- `queries.rs` also accepts a `query_id` param for a saved query, but that branch is a `todo!()`.
  Sending `query_id` without `q` panics the handler. Only `q` works today.
- `tags.rs::get_songs_with_user_tag_handler` exists but is not routed anywhere. Dead code. The
  same data comes back from `GET /tags?tag_id=N`.
- `GET /tags/suggest` uses `requested_tag_count` as a **required** query param, not optional, so
  a request without it is a 422. The service clamps it to at most 20.
- `POST /tags` returns the id as a bare string body, not JSON.
- `DELETE /tags` and `DELETE /songs/local-tags` take a JSON body. Some HTTP clients will not send
  one on a DELETE.
- `GET /songs/local-tags` returns only the user's own tags. Default tags (`user_id IS NULL`) are
  available separately from `GET /songs/default-tags`.
- `POST /songs/local-tags/batch` and `POST /songs/no-default-tags` are reads. They are POSTs because
  their id lists do not belong in a query string. Both cap out at 200 ids; the tag batch client
  chunks at 25. Songs with no user tags come back as an empty list, never missing.
- A vote can promote a user tag name to a default tag once it has at least 10 votes and more than
  1.5 times as many yes votes as no votes. This never copies the default into user tags.
- `POST /songs/local-tags` inserts without checking first, so re-applying a tag relies on the unique
  violation mapping in `err.rs`. That mapping keys off the table name `applied_tags`, but the
  entity declares `user_tags_applied`, so it falls through to a generic `DatabaseError` instead
  of `TagAlreadyApplied`. See the table naming note in `../db/README.md`.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
