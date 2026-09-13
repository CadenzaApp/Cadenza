# routes

HTTP handlers. One module per resource, each exposing a `get_*_router() -> Router<AppState>`
that `main.rs` nests under a path prefix. Handlers stay thin: they pull state, check auth,
call into `src/db/` or `src/services/`, and shape the response.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `json`, `queries`, `tags`, `songs`. |
| `tags.rs` | Tag CRUD for the signed-in user, plus LLM tag suggestion. Mounted at `/tags`. |
| `songs.rs` | Reading and changing which tags are on a song, finding untagged songs, and generating default tags. Mounted at `/songs`. |
| `queries.rs` | Runs a boolean tag query and returns song ids by relevance. Mounted at `/queries`. |
| `json/mod.rs` | `vec_into`, a small `Vec<A> -> Vec<B>` helper. |
| `json/tag.rs` | `Tag`, the wire shape of a tag. `From<tags::Model>` drops `user_id`. |

## Endpoints

Every route below requires `Authorization: Bearer <supabase jwt>`.

| method | path | input | output |
| --- | --- | --- | --- |
| GET | `/tags` | none | `{"All": {tags: [Tag], metadata: {tag_id: {count}}}}` |
| GET | `/tags?tag_id=N` | query param | `{"One": {tag, song_ids}}`, 404 if the tag does not exist |
| POST | `/tags` | `{name, color}` | the new tag id, as a bare number in the body |
| DELETE | `/tags` | `{tag_id}` | empty. Silently no-ops if the tag is not yours |
| GET | `/tags/suggest` | `?song_desc=...&requested_tag_count=N` | `[{name, color}, ...]` |
| GET | `/songs/tags` | `?song_id=...` | `[Tag]`, the user's tags on that song. With none, its default tags, which get copied into the user's tags |
| POST | `/songs/tags/batch` | `{song_ids: [...]}` | `{song_id: [Tag]}`, an entry per requested song, with the same fallback |
| POST | `/songs/untagged` | `{song_ids: [...]}` | `["songid", ...]`, the requested songs with no user tags and no default tags, in request order |
| POST | `/songs/default-tags` | `[{song_id, desc}]` | empty. Generates and stores default tags for the songs that have none |
| POST | `/songs/tags` | `{song_id, tag_id}` | empty |
| DELETE | `/songs/tags` | `{song_id, tag_id}` | empty |
| GET | `/queries/results` | `?q=<query json>` | `["songid", ...]`, most relevant first |
| GET | `/test` | none | `server is reachable`. Defined inline in `main.rs`, not here |

`GET /tags` returns a serde-tagged enum, so the two shapes come back wrapped in `"One"` or
`"All"`. The client mirrors that in `client-app/src/lib/routes/tags.ts`.

`metadata` is keyed by tag id, separate from the `tags` array, so the client can look up a
count without walking the list.

## How it works

Handlers take what they need out of `AppState` by `FromRef`, so most take
`State(db): State<DatabaseConnection>` and nothing else. `tags.rs::suggest_tags_handler` takes
`State(tag_gen_service)` instead, plus a bare `_: Claims<SupabaseClaims>` purely to force
authentication without using the claims. `songs.rs::set_default_tags_on_songs_handler` does the
same with both `db` and `tag_gen_service`, since default tags belong to no user.

Song tag reads never generate anything, but they can write. `GET /songs/tags`,
`POST /songs/tags/batch`, and `POST /songs/untagged` all go through
`db::tags::get_user_tags_on_songs`, which falls back to default tags that already exist and copies
the ones it uses into `user_tags_applied` for the user. The client creates default tags: on
startup it pages through the user's library, sends each page to `POST /songs/untagged`, and posts
those songs' descriptions to `POST /songs/default-tags`. That handler drops songs that already
have default tags, generates tags for the rest with `TagGenerationService::generate_tags`, and
stores them with `db::tags::set_default_tags_on_songs`.

`set_default_tags_on_songs_handler` and `queries.rs` are the two places with real logic in a
route. The default tags one is the orchestration above. `queries.rs` is ranking, not data access.
The query tree arrives as a `q` query param holding JSON. `QueryResultsParams::into_json_query`
parses it, and a bad parse is `QueryFormatError`. `db::queries::run_json_query` returns
`song id -> its matched tag ids`. The handler walks the original query JSON to collect every tag
id mentioned, scores each song by how many of those it carries, and sorts descending. Ties keep
hashmap order, so equal-score results are unstable between requests.

`json/` exists so the wire format is decoupled from the SeaORM models. Anything that leaves the
api as JSON should have a type here rather than serializing an entity model directly.

## Connects to

- `crate::db::tags` and `crate::db::queries` for all data access.
- `crate::services::tag_generation::TagGenerationService` for `/tags/suggest` and
  `/songs/default-tags`.
- `crate::err::CadenzaError` for every error path.
- Client side: `client-app/src/lib/routes/*.ts` wraps every one of these in an SWR hook, and
  `client-app/src/lib/default-tags.ts` drives `/songs/untagged` and `/songs/default-tags` on
  startup.

## Gotchas

- `queries.rs` also accepts a `query_id` param for a saved query, but that branch is a `todo!()`.
  Sending `query_id` without `q` panics the handler. Only `q` works today.
- `tags.rs::get_songs_with_user_tag_handler` exists but is not routed anywhere. Dead code. The
  same data comes back from `GET /tags?tag_id=N`.
- `GET /tags/suggest` uses `requested_tag_count` as a **required** query param, not optional, so
  a request without it is a 422. The service clamps it to at most 20.
- `POST /tags` returns the id as a bare string body, not JSON.
- `DELETE /tags` and `DELETE /songs/tags` take a JSON body. Some HTTP clients will not send one
  on a DELETE.
- The default tag fallback is per song and all or nothing. A song with even one of the user's
  tags shows only those. The read that falls back copies the default tags into the user's tags,
  so `DELETE /songs/tags` removes them like any other tag. Removing a song's last tag brings all
  its defaults back on the next read.
- `POST /songs/tags/batch` and `POST /songs/untagged` are POSTs only because the id list does not
  belong in a query string. Like `GET /songs/tags`, they can write when they fall back to default
  tags. Both, plus `POST /songs/default-tags`, cap out at 200 songs and answer `QueryFormatError`
  past that. The batch returns songs with no tags as an empty list, never missing.
- `POST /songs/default-tags` can be slow, since one request becomes one or more OpenAI calls in
  a row. A song the model returns no tags for gets no default tags, so it stays untagged and the
  client retries it on its next startup.
- `POST /songs/tags` inserts without checking first, so re-applying a tag relies on the unique
  violation mapping in `err.rs`. That mapping keys off the table name `applied_tags`, but the
  entity declares `user_tags_applied`, so it falls through to a generic `DatabaseError` instead
  of `TagAlreadyApplied`. See the table naming note in `../db/README.md`.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
