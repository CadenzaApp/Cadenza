# routes

HTTP handlers. One module per resource, each exposing a `get_*_router() -> Router<AppState>`
that `main.rs` nests under a path prefix. Handlers stay thin: they pull state, check auth,
call into `src/db/` or `src/services/`, and shape the response.

## Files

| file | role |
| --- | --- |
| `mod.rs` | Declares `json`, `queries`, `tags`, `songs`. |
| `tags.rs` | Tag CRUD for the signed-in user, plus LLM tag suggestion. Mounted at `/tags`. |
| `songs.rs` | Reading and changing which tags are on a song. Mounted at `/songs`. |
| `queries.rs` | Runs a boolean tag query and returns song ids by relevance. Mounted at `/queries`. |
| `json/mod.rs` | `vec_into`, a small `Vec<A> -> Vec<B>` helper. |
| `json/tag.rs` | `Tag`, the wire shape of a tag. `From<tags::Model>` drops `user_id` and `embedding`. |

## Endpoints

Every route below requires `Authorization: Bearer <supabase jwt>`.

| method | path | input | output |
| --- | --- | --- | --- |
| GET | `/tags` | none | `{"All": [{tag, count}, ...]}`, the user's tags with usage counts |
| GET | `/tags?tag_id=N` | query param | `{"One": {tag, song_ids}}`, 404 if the tag does not exist |
| POST | `/tags` | `{name, color}` | the new tag id, as a bare number in the body |
| DELETE | `/tags` | `{tag_id}` | empty. Silently no-ops if the tag is not yours |
| GET | `/tags/suggest` | `?song_desc=...&requested_tag_count=N` | `["vocaloid", "japanese", ...]` |
| GET | `/songs/tags` | `?song_id=...` | `{global: [Tag], local: [Tag]}` |
| POST | `/songs/tags` | `{song_id, tag_id}` | empty |
| DELETE | `/songs/tags` | `{song_id, tag_id}` | empty |
| POST | `/queries` | a query JSON tree | `["songid", ...]`, most relevant first |
| GET | `/test` | none | `server is reachable`. Defined inline in `main.rs`, not here |

`GET /tags` returns a serde-tagged enum, so the two shapes come back wrapped in `"One"` or
`"All"`. The client mirrors that in `client-app/src/lib/routes/tags.ts`.

## How it works

Handlers take what they need out of `AppState` by `FromRef`, so most take
`State(db): State<DatabaseConnection>` and nothing else. `tags.rs::suggest_tags_handler` takes
`State(tag_gen_service)` instead, plus a bare `_: Claims<SupabaseClaims>` purely to force
authentication without using the claims.

`queries.rs` is the only one with real logic in the route, and it is ranking, not data access.
`db::queries::run_json_query` returns `song id -> its matched tag ids`. The handler walks the
original query JSON to collect every tag id mentioned, scores each song by how many of those it
carries, and sorts descending. Ties keep hashmap order, so equal-score results are unstable
between requests.

`json/` exists so the wire format is decoupled from the SeaORM models. Anything that leaves the
api as JSON should have a type here rather than serializing an entity model directly.

## Connects to

- `crate::db::tags` and `crate::db::queries` for all data access.
- `crate::services::tag_generation::TagGenerationService` for `/tags/suggest`.
- `crate::err::CadenzaError` for every error path.
- Client side: `client-app/src/lib/routes/*.ts` wraps these in SWR hooks, and
  `client-app/src/features/query-builder/QueryUtils.ts` calls `/queries` directly.

## Gotchas

- `tags.rs::get_songs_with_tag_handler` exists but is not routed anywhere. Dead code. The same
  data comes back from `GET /tags?tag_id=N`.
- `GET /tags/suggest` uses `requested_tag_count` as a **required** query param, not optional, so
  a request without it is a 422. The service clamps it to at most 20.
- `POST /tags` returns the id as a bare string body, not JSON.
- `DELETE /tags` and `DELETE /songs/tags` take a JSON body. Some HTTP clients will not send one
  on a DELETE.
- `GET /songs/tags` splits by `is_global_tag` (a tag with a null `user_id`), so the `global`
  bucket is shared across all users.
- `POST /songs/tags` inserts without checking first, so re-applying a tag relies on the unique
  violation mapping in `err.rs`. That mapping keys off the table name `applied_tags`, but the
  entity declares `tags_applied`, so it likely falls through to a generic `DatabaseError`
  instead of `TagAlreadyApplied`. See the table naming note in `../db/README.md`.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
