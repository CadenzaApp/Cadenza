# lib

The data layer and the app-wide providers. Anything that fetches, caches, or holds global state
lives here. Screens and components should import from here rather than calling `fetch` or the
native module directly.

## Files

| file | role |
| --- | --- |
| `backend.ts` | `BACKEND_URL`. One constant, currently hardcoded. |
| `api-actions.ts` | The generic SWR wrappers: `useAPIData`, `useAPIPostDataBatched`, `useAPIFetch`, `useAPIMutation`. |
| `api-endpoints.ts` | `matchesEndpoint`, the cache-key matcher behind invalidation. Import-free so it can be unit tested. |
| `swr-utils.ts` | `clearCache` and `useSimpleMutation`, for things that are not plain backend calls. |
| `routes/tags.ts` | Hooks for `/tags`: `useUserTags`, `useTag`, `useCreateTag`, `useDeleteTag`, `useSuggestTags`. |
| `routes/songs.ts` | Hooks for `/songs/tags`: `useTagsOnSong`, `useTagsOnSongs`, `useApplyTag`, `useUnapplyTag`. |
| `routes/queries.ts` | Hook for `/queries/results`: `useQueryResults`. |
| `musickit-hooks.ts` | SWR over the native module: song info, catalog search, library songs, albums, playlists, collection contents, favorites, artists, playlist writes. |
| `account.tsx` | `AccountProvider` / `useAccount`. Supabase session and the JWT. |
| `apple-music-auth.tsx` | `AppleMusicProvider` / `useAppleMusic`. Apple Music tokens, persisted in secure store. |
| `playback.tsx` | `PlaybackProvider`, `usePlayback` (state) and `usePlaybackCommands` (actions). Queue and the native playback snapshot. |
| `queue-order.ts` | Pure index math for the queue mirror. Tested in `queue-order.test.ts`. |
| `supabase.ts` | The Supabase client, backed by AsyncStorage. |
| `tag-generation.ts` | A standalone tag suggestion fetch. Does not use the wrappers. See gotchas. |
| `theme.ts` | `NAV_THEME`, light and dark palettes for react-navigation, and `sheetScreenOptions` for sheet routes. |
| `error-utils.ts` | `getErrorDetails` / `getErrorMessage`, for unwrapping native and backend errors. |
| `screen-overlay.ts` | `useScreenOverlayInsets`, plus the geometry constants for both floating bottom bars. Also `useBaseRouteSegment`, the root segment ignoring any sheet presented on top. |
| `player-dock.tsx` | `PlayerDockProvider` / `usePlayerDock`. Whether the mini player floats above the tab bar or sits docked inside it. |
| `screen-scroll.ts` | `useScreenScroll`, the props a tab screen's top-level scroller spreads to get tab-press-scrolls-to-top and scroll-docks-the-player. |
| `types.ts` | Shared wire types: `Tag` and `TagMetadata`. |
| `utils.ts` | `cn()`, the clsx + tailwind-merge helper. |

## The SWR wrappers

Four, in `api-actions.ts`, and picking the right one is most of the work:

| wrapper | for | key |
| --- | --- | --- |
| `useAPIData<Output>(path, params?)` | idempotent reads, fetch on mount | `{ keyType: "api-data", path, params, accountId }` |
| `useAPIPostDataBatched<Item, Body, Out>(path, items, opts)` | an idempotent read whose payload is a list too long for a query string | `{ keyType: "api-data", path, items, accountId }` |
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

`useAPIPostDataBatched` exists for reads whose request is a list too long for a query string. It
splits the list into parallel requests and merges the responses, but stays **one** `api-data`
key so invalidation works like every other read. `useTagsOnSongs` is the one caller.

Do not reach for `useSWRInfinite` here. `mutate(filterFn)` skips `$inf$` keys outright, and the
per-page keys it does visit have no subscribed revalidator, so a filtered `mutate` silently
does nothing and the data goes stale forever. That is why this wrapper batches inside a single
`useSWR` instead of paging.

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
in the codebase, with `rollbackOnError`. `usePlaylistMutations` is the exception to the wrapper
rule: playlist writes are not backend calls, so they are plain async functions that invalidate
every cached playlist key by predicate afterwards.

Every paged library read goes through one internal hook, `usePagedLibraryResult`. It owns the
offset loop (request a page, read `nextOffset`, stop when the native side says there is no next
page), so `useTracksFromLibrary`, `useLibraryAlbums`, `useUserPlaylists`,
`useRecentlyAdded`, and `useCollectionSongs` are each only a key builder and a fetch. Adding
another paged library read means writing those two things and nothing else.

`useCollectionSongs(kind, id)` takes `"album" | "playlist"` rather than splitting into two
hooks, so a screen that renders either does not branch. Pass the collection's `libraryId`.

## Bottom overlay geometry

`screen-overlay.ts` owns where the two floating bottom bars sit, because both the bars and the
padding screens leave for them have to come from the same numbers.

Neither bar is in the layout: the tab bar is `position: "absolute"` and the compact player is
positioned by `compactPlayerBottom`. **Nothing reserves space for them**, so every scrolling
surface owes itself `contentBottomInset` (or `listBottomInset` when a floating button is also
over it), or its last row hides under a bar.

Sheet content is the exception. `SheetScreen` puts `InsideSheetContext` around its body, and the
hook then returns sheet-local numbers: no tab bar, no compact player, just the safe area. A
`MusicList` inside a sheet would otherwise leave a tab bar's worth of dead space at the bottom.

`TAB_BAR_HEIGHT` and `TAB_BAR_MARGIN` are also what `(tabs)/_layout.tsx` styles the bar with.
Change one and the other has to match. `TAB_BAR_ITEM_INSET` and `DOCKED_PLAYER_HEIGHT` are the
box *inside* the bar, shared by the selection bubble and the docked player so they line up.

## Docking the player

`player-dock.tsx` holds one animated `progress`: 0 floating above the bar, 1 docked inside it
over the middle tab slots, fractional while a finger is dragging it. Three things move it.

- `screen-scroll.ts`, when the focused screen scrolls away from the top, and back at the top.
- The drag on the player itself, in `media-player.tsx`.
- Leaving a screen, which floats it again.

It also carries the tab bar's measured width and tab count, which `TabBarGlass` reports and the
player uses to size itself to three slots. Docking changes nothing about the insets screens pad
with: it is an overlay on the bar, so a page cannot reflow underneath a scroll that caused it.

`useScreenScroll()` is what a tab screen's top-level scroller spreads:

```tsx
const scroll = useScreenScroll();
<Animated.FlatList {...scroll} ... />
```

It has to be an `Animated.FlatList` / `Animated.ScrollView`, because the offset is read on the UI
thread. Tab-press-scrolls-to-top comes free with it, through react-navigation's `useScrollToTop`.
A surface that skips the hook keeps the player floating and ignores tab presses.

## The providers

- `AccountProvider` owns the Supabase session. `signIn`, `signUp`, `signOut`, and
  `tryRestoreSession`. Every account change calls `clearCache()`, so switching users cannot leak
  cached data. It does not log session tokens or account details. It has no loading state on
  purpose: the splash screen calls `tryRestoreSession` before anything else renders.
- `AppleMusicProvider` owns the Apple Music developer and user tokens, restores them from
  `expo-secure-store` on mount, and pushes them into the native module. `isConnected` means
  authorized **and** holding a user token. `ensureConnected()` before any playback call.
- `PlaybackProvider` hands the queue to the native player (`playSongQueue`, `appendSongQueue`)
  and mirrors it, since the snapshot reports the current track but not its position in the
  queue. It finds the index by matching the snapshot track against the mirrored list, searching
  outward from the index it already believes in, and falls back to the last index it set.
  Searching outward is what makes a queue holding the same song twice work. It polls
  `refreshPlaybackSnapshot()` every 750ms while the app is foregrounded. This is deliberately
  not SWR: it is a subscription to continuously changing native state, not a cached read.
- Queue edits (`moveQueueItem`, `removeQueueItem`, `playQueueItem`, `playNext`) go through one
  internal `mutateQueue`, which moves the mirror first so the list does not lag the drag, then
  applies the native command and rolls the mirror back if it throws. A mirror that disagrees
  with native would send every later index-addressed command to the wrong song, so it must never
  be allowed to drift. The math itself is in `queue-order.ts`, which the mock native module
  mirrors, so the two cannot diverge silently.
- Positions in `usePlayback()` address the whole queue, counting the song that is playing. That
  is the index space the native module takes. `upcoming` is a convenience slice, and a caller
  working in its positions owes itself the conversion.
- The provider exposes two contexts on purpose. `usePlayback()` is the state, and re-renders
  every 750ms as progress ticks. `usePlaybackCommands()` is the actions, and its identity never
  changes, so a list row can hold a play handler without re-rendering on every tick. Reach for
  `usePlaybackCommands` unless you actually need to read playback state.

## Connects to

- `backend-api`, through `BACKEND_URL`.
- Supabase auth, through `supabase.ts`.
- `@apple-musickit`, from `musickit-hooks.ts`, `apple-music-auth.tsx`, and `playback.tsx`.
- Consumed by everything in `src/app`, `src/features`, and `src/components/custom`.

## Gotchas

- **`BACKEND_URL` comes from `EXPO_PUBLIC_BACKEND_API_URL`**, falling back to
  `http://localhost:3000`. On a physical device localhost is the phone, so that fallback only
  works in a simulator. Metro inlines `EXPO_PUBLIC_*` at bundle time, so editing `.env` needs a
  metro restart with `--clear`, not just a refresh.
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
