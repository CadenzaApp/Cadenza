# cadenza client-app

Expo/React Native client for the Cadenza backend.

## Data fetching with SWR

All server communication goes through [SWR](https://swr.vercel.app/). Nothing in
the UI calls `fetch` directly — components only ever call a hook out of
`src/lib/routes/`.

### The three primitives (`src/lib/api-actions.ts`)

| Primitive | Wraps | Use for |
| --- | --- | --- |
| `useAPIData<Output>(path, params?)` | `useSWR` | GET endpoints whose data should be cached and kept fresh. Runs automatically on mount. |
| `useAPIFetch<Input, Output>(path)` | `useSWRMutation` | GET endpoints that should only run when the user asks (search, AI suggestions). Not cached. |
| `useAPIMutation<Body, Response>(method, path, invalidatedEndpoints)` | `useSWRMutation` | POST/DELETE/etc. Sends a JSON body and invalidates affected caches on success. |

All three attach `Authorization: Bearer <jwt>` from `useAccount()`, prefix the
path with `BACKEND_URL`, tolerate empty response bodies, and `throw` the parsed
error body when the response is not ok.

### Cache keys and invalidation

`useAPIData` keys its cache entry with a structured object rather than a string:

```ts
{ keyType: "api-data", path, params }
```

That is what makes targeted invalidation possible. `useAPIMutation` takes a list
of `{ path, params? }` endpoints (or a function from the request body to that
list, when the affected key depends on what was just written) and, after a
successful request, calls `mutate` with a filter that matches every `api-data`
key whose `path` is equal and whose `params` are a **superset** of the listed
ones. So `{ path: "/songs/tags" }` with no params invalidates the tags of every
song, while `{ path: "/songs/tags", params: { song_id } }` invalidates just the
one that changed.

There is no automatic invalidation. `invalidatedEndpoints` defaults to `[]`, so
a mutation that doesn't list anything will leave every cached `useAPIData` entry
untouched and the UI showing stale data. You must enumerate every affected path
yourself — including ones in other route files, e.g. applying a tag invalidates
both `/songs/tags` and `/tags`.

`useAPIData` also disables itself (passes a `null` key to SWR) when any param is
`null`/`undefined`, so hooks can be called unconditionally with an id that isn't
loaded yet.

### Helpers (`src/lib/swr-utils.ts`)

- `clearCache()` — invalidates every SWR entry; used on sign-out/account switch.
- `useSimpleMutation(key, action)` — typed `useSWRMutation` wrapper for mutations
  that are not plain HTTP calls to the backend.

## `src/lib/routes/` mirrors `backend-api/src/routes/`

The file layout on the client is a one-to-one mirror of the Axum routers on the
server. Each backend module nested under a prefix in `backend-api/src/main.rs`
has a same-named file in `src/lib/routes/`, and **every backend endpoint has at
least one frontend hook**.

| Backend | Prefix | Endpoint | Frontend hook (`src/lib/routes/…`) |
| --- | --- | --- | --- |
| `routes/tags.rs` | `/tags` | `GET /` | `tags.ts` → `useUserTags()`, `useTag(tagId)` |
| | | `POST /` | `tags.ts` → `useCreateTag()` |
| | | `DELETE /` | `tags.ts` → `useDeleteTag()` |
| | | `GET /suggest` | `tags.ts` → `useSuggestTags()` |
| `routes/songs.rs` | `/songs` | `GET /tags` | `songs.ts` → `useTagsOnSong(songId)` |
| | | `POST /tags` | `songs.ts` → `useApplyTag()` |
| | | `DELETE /tags` | `songs.ts` → `useUnapplyTag()` |
| `routes/queries.rs` | `/queries` | `GET /results` | `queries.ts` → `useQueryResults()` |

`GET /tags` has two hooks because the handler returns a tagged union: without
`tag_id` it responds with `All { tags, metadata }`, with one it responds with
`One { tag, song_ids }`. `useUserTags` and `useTag` each unwrap one variant.

### Adding an endpoint

1. Add the route to the appropriate `backend-api/src/routes/*.rs` router.
2. In the matching `src/lib/routes/*.ts`, add a hook built on `useAPIData`,
   `useAPIFetch`, or `useAPIMutation` — a new file only if you added a new
   backend module (and then nest it in `main.rs` under the same name).
3. For writes, list the `{ path, params }` endpoints the change invalidates.
4. Rename the returned fields to be caller-friendly and unambiguous
   (`tagsOnSong`, `tagsOnSongLoading`, `tagsOnSongErr`) rather than re-exporting
   SWR's generic `data`/`error`/`isLoading`.
