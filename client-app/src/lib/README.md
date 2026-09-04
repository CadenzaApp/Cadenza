# lib

The data layer and the app-wide providers. Anything that fetches, caches, or holds global state
lives here. Screens and components should import from here rather than calling `fetch` or the
native module directly.

## Files

| file | role |
| --- | --- |
| `backend.ts` | `BACKEND_URL`. One constant, currently hardcoded. |
| `swr-utils.ts` | The three generic SWR wrappers plus `clearCache` and `useSimpleMutation`. |
| `routes/tags.ts` | Hooks for `/tags`: `useTags`, `useTag`, `useCreateTag`, `useDeleteTag`, `useSuggestTags`. |
| `routes/songs.ts` | Hooks for `/songs/tags`: `useTagsOnSong`, `useApplyTag`, `useUnapplyTag`. |
| `routes/queries.ts` | Empty except for one import. Query submission lives in the feature instead. |
| `musickit-hooks.ts` | SWR over the native module: song info, catalog search, library, playlists, favorites. |
| `account.tsx` | `AccountProvider` / `useAccount`. Supabase session and the JWT. |
| `apple-music-auth.tsx` | `AppleMusicProvider` / `useAppleMusic`. Apple Music tokens, persisted in secure store. |
| `playback.tsx` | `PlaybackProvider` / `usePlayback`. Queue and the native playback snapshot. |
| `supabase.ts` | The Supabase client, backed by AsyncStorage. |
| `tag-generation.ts` | A standalone tag suggestion fetch. Does not use the wrappers. See gotchas. |
| `theme.ts` | `NAV_THEME`, light and dark palettes for react-navigation. |
| `types.ts` | Shared wire types. Just `Tag` today. |
| `utils.ts` | `cn()`, the clsx + tailwind-merge helper. |

## The SWR wrappers

Three, and picking the right one is most of the work:

| wrapper | for | key |
| --- | --- | --- |
| `useAPIData<Output>(path, params?)` | idempotent reads, fetch on mount | `{ path, params }` object |
| `useAPIMutation<Body, Res>(method, path, invalidates?)` | user-triggered writes | `path` string |
| `useAPIFetch<In, Out>(path, method?)` | a read you only want on demand | `path` string |

All three pull the JWT from `useAccount()` and send `Authorization: Bearer <jwt>`. All three
throw the parsed error body on a non-2xx, so a caught error is the backend's
`{ error_type, message }` object, not an `Error`.

`useAPIData` disables itself (passes a `null` key) if **any** param value is null or undefined.
That is how `useTag(undefined)` and `useTagsOnSong(undefined)` stay dormant until an id arrives.

Invalidation is the part to get right. `useAPIMutation` takes a list of `{ path, params }`
endpoints to invalidate, or a function from the request body to that list, and always adds its
own `path`. Matching is by `key.path`, with `params: "*"` meaning any params on that path. So:

```ts
// invalidate only this song's tag list
useAPIMutation<ApplyTagPayload, void>("POST", "/songs/tags",
    ({ song_id }) => [{ path: "/songs/tags", params: { song_id } }]);

// deleting a tag can affect every song, so wildcard
useAPIMutation<{ tag_id: number }, void>("DELETE", "/tags",
    [{ path: "/songs/tags", params: "*" }]);
```

Endpoint hooks in `routes/` wrap these and rename the returned fields to something readable
(`tagsLoading`, `createTagErr`, and so on). Add a new endpoint there, not inline in a component.

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
  phone, so every SWR hook fails silently against a real backend. Change it to your machine's LAN
  ip while developing on device. This contradicts `EXPO_PUBLIC_BACKEND_API_URL`, which only
  `tag-generation.ts` reads.
- **`tag-generation.ts` is a second, parallel path.** It resolves its own base url (env var, then
  the Expo host, then a platform default) and posts to `POST /tag-generation`. The backend has no
  such route; the real one is `GET /tags/suggest`, which `routes/tags.ts::useSuggestTags` already
  wraps correctly. Treat `tag-generation.ts` as dead or stale until proven otherwise.
- `routes/queries.ts` is effectively empty. Query submission is in
  `@/features/query-builder/QueryUtils.ts::getSongsFromQuery`, which calls `fetch` directly and
  therefore has no SWR cache and no invalidation. If you touch it, consider moving it here.
- The wildcard in `params: "*"` only checks the path. Its per-key comparison loop `continue`s
  without ever returning false, so a non-wildcard `params` match is looser than it reads.
- `useAPIMutation` uses the bare `path` as its SWR key, so two hooks on the same path share a
  mutation key.
- `swr-utils.ts` reads `account?.jwt` at hook call time. A component rendered before the session
  is restored sends `Bearer undefined`.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
