# lib

The data layer and the app-wide providers. Anything that fetches, caches, or holds global state
lives here. Screens and components should import from here rather than calling `fetch` or the
native module directly.

## Files

| file | role |
| --- | --- |
| `backend.ts` | `BACKEND_URL`. One constant, currently hardcoded. |
| `api-actions.ts` | The generic SWR wrappers: `useAPIData`, `useAPIPostDataPages`, `useAPIFetch`, `useAPIMutation`. |
| `api-endpoints.ts` | `matchesEndpoint`, the cache-key matcher behind invalidation. Import-free so it can be unit tested. |
| `swr-utils.ts` | `clearCache` and `useSimpleMutation`, for things that are not plain backend calls. |
| `routes/tags.ts` | Hooks for `/tags`: `useUserTags`, `useTag`, `useCreateTag`, `useDeleteTag`, `useSuggestTags`. |
| `routes/songs.ts` | Hooks for `/songs/tags`: `useTagsOnSong`, `useTagsOnSongs`, `useApplyTag`, `useUnapplyTag`. |
| `routes/queries.ts` | Hook for `/queries/results`: `useQueryResults`. |
| `musickit-hooks.ts` | SWR over the native module: song info, catalog search, library, playlists, favorites. |
| `account.tsx` | `AccountProvider` / `useAccount`. Supabase session and the JWT. |
| `apple-music-auth.tsx` | `AppleMusicProvider` / `useAppleMusic`. Apple Music tokens, persisted in secure store. |
| `playback.tsx` | `PlaybackProvider` / `usePlayback`. Queue and the native playback snapshot. |
| `supabase.ts` | The Supabase client, backed by AsyncStorage. |
| `tag-generation.ts` | A standalone tag suggestion fetch. Does not use the wrappers. See gotchas. |
| `theme.ts` | `NAV_THEME`, light and dark palettes for react-navigation. |
| `error-utils.ts` | `getErrorDetails` / `getErrorMessage`, for unwrapping native and backend errors. |
| `screen-overlay.ts` | `useScreenOverlayInsets`. How much bottom padding a screen owes the compact player and the floating button. |
| `types.ts` | Shared wire types: `Tag` and `TagMetadata`. |
| `utils.ts` | `cn()`, the clsx + tailwind-merge helper. |

## The SWR wrappers

Four, in `api-actions.ts`, and picking the right one is most of the work:

| wrapper | for | key |
| --- | --- | --- |
| `useAPIData<Output>(path, params?)` | idempotent reads, fetch on mount | `{ keyType: "api-data", path, params, accountId }` |
| `useAPIPostDataPages<In, Out>(path, bodies)` | an idempotent read whose payload is a list, split one page per batch | `{ keyType: "api-data", path, body, accountId }` per page |
| `useAPIFetch<In, Out>(path)` | a GET you only want on demand (search, suggestions) | `path` string |
| `useAPIMutation<Body, Res>(method, path, invalidates?)` | user-triggered writes | `[method, path, accountId]` |

All four pull the JWT from `useAccount()` and send `Authorization: Bearer <jwt>`. All four
tolerate an empty response body, and all four throw the parsed error body on a non-2xx, so a
caught error is the backend's `{ error_type, message }` object, not an `Error`.

The `accountId` in every key means a cached read can never be served to a different user, on
top of the `clearCache()` that already runs on every account change.

`useAPIData` disables itself (passes a `null` key) if there is no account, or if **any** param
value is null or undefined. That is how `useTag(undefined)` and `useTagsOnSong(undefined)` stay
dormant until an id arrives.

`useAPIPostDataPages` exists for reads whose request is a list too long for a query string. The
caller chunks its ids into one body per page and the hook keeps `useSWRInfinite`'s size pinned
to the number of batches, so each chunk is cached separately and a growing list only fetches the
new tail. `useTagsOnSongs` is the one caller.

Invalidation is the part to get right, and it is entirely manual. `useAPIMutation` takes a list
of `{ path, params? }` endpoints, or a function from the request body to that list when the key
depends on what was just written. After a successful request it matches every `api-data` key
whose `path` is equal and whose `params` are a **superset** of the listed ones. So a bare
`{ path: "/songs/tags" }` invalidates the tags of every song, while
`{ path: "/songs/tags", params: { song_id } }` invalidates just the one that changed.

```ts
// invalidate only this song's tag list, plus the tag counts
useAPIMutation<ApplyTagPayload, void>("POST", "/songs/tags",
    ({ song_id }) => [
        { path: "/songs/tags", params: { song_id } },
        { path: "/tags" },
    ]);
```

`invalidatedEndpoints` defaults to `[]`. A mutation that lists nothing leaves every cached
`useAPIData` entry alone and the UI showing stale data, including caches in other route files.

## `routes/` mirrors `backend-api/src/routes/`

One file per backend router, and every backend endpoint has at least one hook.

| backend | endpoint | hook |
| --- | --- | --- |
| `routes/tags.rs` | `GET /tags` | `tags.ts` -> `useUserTags()`, `useTag(tagId)` |
| | `POST /tags` | `tags.ts` -> `useCreateTag()` |
| | `DELETE /tags` | `tags.ts` -> `useDeleteTag()` |
| | `GET /tags/suggest` | `tags.ts` -> `useSuggestTags()` |
| `routes/songs.rs` | `GET /songs/tags` | `songs.ts` -> `useTagsOnSong(songId)` |
| | `POST /songs/tags/batch` | `songs.ts` -> `useTagsOnSongs(songIds)` |
| | `POST /songs/tags` | `songs.ts` -> `useApplyTag()` |
| | `DELETE /songs/tags` | `songs.ts` -> `useUnapplyTag()` |
| `routes/queries.rs` | `GET /queries/results` | `queries.ts` -> `useQueryResults()` |

`GET /tags` has two hooks because the handler returns a tagged union: without `tag_id` it
responds with `All { tags, metadata }`, with one it responds with `One { tag, song_ids }`.
`useUserTags` and `useTag` each unwrap one variant.

Adding an endpoint: add the route in `backend-api/src/routes/*.rs`, then add a hook in the
matching `routes/*.ts` built on one of the three wrappers. For writes, list the endpoints the
change invalidates. Rename the returned fields to something readable (`tagsOnSong`,
`tagsOnSongLoading`, `tagsOnSongErr`) rather than re-exporting SWR's `data` / `error` /
`isLoading`.

`musickit-hooks.ts` does the same job for the native module, using plain `useSWR` with tuple
keys like `["MusicKit.getSongInfo", ids]`. `useSongFavoriteStatus` is the one optimistic update
in the codebase, with `rollbackOnError`.

## The providers

- `AccountProvider` owns the Supabase session. `signIn`, `signUp`, `signOut`, and
  `tryRestoreSession`. Every account change calls `clearCache()`, so switching users cannot leak
  cached data. It has no loading state on purpose: the splash screen calls `tryRestoreSession`
  before anything else renders.
- `AppleMusicProvider` owns the Apple Music developer and user tokens, restores them from
  `expo-secure-store` on mount, and pushes them into the native module. `isConnected` means
  authorized **and** holding a user token. `ensureConnected()` before any playback call.
- `PlaybackProvider` wraps the native playback snapshot and layers the queue on top, since the
  native side does not report queue position. It polls `refreshPlaybackSnapshot()` every 750ms
  while the app is foregrounded. This is deliberately not SWR: it is a subscription to
  continuously changing native state, not a cached read.

## Connects to

- `backend-api`, through `BACKEND_URL`.
- Supabase auth, through `supabase.ts`.
- `@apple-musickit`, from `musickit-hooks.ts`, `apple-music-auth.tsx`, and `playback.tsx`.
- Consumed by everything in `src/app`, `src/features`, and `src/components/custom`.

## Gotchas

- **`BACKEND_URL` is hardcoded to `http://localhost:3000`.** On a physical device that is the
  phone, so every hook fails silently against a real backend. Change it to your machine's LAN
  ip while developing on device. This contradicts `EXPO_PUBLIC_BACKEND_API_URL`, which only
  `tag-generation.ts` reads.
- **`tag-generation.ts` is a second, parallel path.** It resolves its own base url (env var, then
  the Expo host, then a platform default) and posts to `POST /tag-generation`. The backend has no
  such route; the real one is `GET /tags/suggest`, which `routes/tags.ts::useSuggestTags` already
  wraps correctly. Treat `tag-generation.ts` as dead or stale until proven otherwise.
- `useAPIFetch` uses the bare `path` as its SWR key, so two `useAPIFetch` hooks on the same path
  share a mutation key. `useAPIMutation` keys on `[method, path, accountId]`, so it does not.
- Tags key on `catalogId ?? id`, not the library id, everywhere a song id crosses into the
  backend. Library ids differ per user for the same song; catalog ids do not.
- `api-actions.ts` reads `account?.jwt` at hook call time. A component rendered before the
  session is restored sends `Bearer undefined`.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
