# lib

The data layer and the app-wide providers. Anything that fetches, caches, or holds global state
lives here. Screens and components should import from here rather than calling `fetch` or the
native module directly.

## Files

| file                         | role                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend.ts`                 | `BACKEND_URL`. One constant, currently hardcoded.                                                                                                                                        |
| `api-actions.ts`             | The generic SWR wrappers: `useAPIData`, `useAPIPostDataBatched`, `useAPIFetch`, `useAPIMutation`.                                                                                        |
| `api-endpoints.ts`           | `matchesEndpoint`, the cache-key matcher behind invalidation. Import-free so it can be unit tested.                                                                                      |
| `swr-utils.ts`               | `clearCache` and `useSimpleMutation`, for things that are not plain backend calls.                                                                                                       |
| `routes/tags.ts`             | Hooks for `/tags`: `useUserTags`, `useTag`, `useCreateTag`, `useDeleteTag`, `useSuggestTags`.                                                                                            |
| `routes/songs.ts`            | Hooks for `/songs/tags`: `useTagsOnSong`, `useTagsOnSongs`, `useApplyTag`, `useSetTagValue`, `useUnapplyTag`.                                                                            |
| `routes/queries.ts`          | Cached hooks for `/queries/results` and `/queries/advanced/results`: `useQueryResults`, `useAdvancedQueryResults`.                                                                       |
| `musickit-hooks.ts`          | SWR over the native module: song info, catalog search, paged and complete-library songs, albums, artists, playlists, collection metadata, favorites, artist search, and playlist writes. |
| `account.tsx`                | `AccountProvider` / `useAccount`. Supabase session and the JWT.                                                                                                                          |
| `apple-music-auth.tsx`       | `AppleMusicProvider` / `useAppleMusic`. Apple Music tokens, persisted in secure store.                                                                                                   |
| `playback.tsx`               | `PlaybackProvider`, broad `usePlayback`, lightweight `usePlaybackTrackState`, and stable `usePlaybackCommands`. Queue, native playback snapshot, and compact-player dismissal state.     |
| `queue-order.ts`             | Pure index math for the queue mirror. Tested in `queue-order.test.ts`.                                                                                                                   |
| `supabase.ts`                | The Supabase client, backed by AsyncStorage.                                                                                                                                             |
| `tag-generation.ts`          | A standalone tag suggestion fetch. Does not use the wrappers. See gotchas.                                                                                                               |
| `theme.ts`                   | `NAV_THEME`, light and dark palettes for react-navigation, `sheetScreenOptions` for sheet routes, and `pushedScreenOptions` for the pushed detail routes.                                |
| `error-utils.ts`             | `getErrorDetails` / `getErrorMessage`, for unwrapping native and backend errors.                                                                                                         |
| `artwork-color.ts`           | `useArtworkTint`, the color a surface paints itself with, plus alpha, darkening, and multi-artwork averaging helpers.                                                                    |
| `artwork-color-utils.ts`     | Native-free channel averaging for multi-artwork tints.                                                                                                                                   |
| `music-routes.ts`            | `collectionRoute` / `albumRouteForTrack`. Hrefs into the resource screens, params and all.                                                                                               |
| `share-track.ts`             | `shareTrack` / `shareCollection`. Builds and fires the native share sheet for a song, album, or playlist's canonical Apple Music link.                                                   |
| `screen-overlay.ts`          | `useScreenOverlayInsets`, native tab/accessory visibility, extra overlay clearance, focused-screen and keyboard suppression, and pushed-screen detection.                                |
| `screen-overlay-geometry.ts` | Pure, tested bottom-inset arithmetic shared by tab-hosted and pushed-screen compact players.                                                                                             |
| `playable-item.ts`           | Pure identity and collection-membership helpers for library/catalog forms of a playable item.                                                                                            |
| `screen-scroll.ts`           | `useScreenScroll`, the props a screen's top-level scroller spreads to get tab-press-scrolls-to-top and pull-down-to-close.                                                               |
| `screen-scroll-marker.*`     | iOS registration wrapper for native-tab inset and scroll-to-top integration with nested and virtualized scrollers; a fragment elsewhere.                                                 |
| `zoom-dismiss.tsx`           | `ZoomOriginProvider`, `useZoomSource`, `ZoomDismissScreen`, `useCloseScreen`. Closing a pushed screen by shrinking it back into the artwork that opened it.                              |
| `zoom-dismiss-geometry.ts`   | Pure pull, transform, timing, and corner math for `zoom-dismiss`, tested without React Native.                                                                                           |
| `types.ts`                   | Shared wire types: `TagType`, `Tag`, `AppliedTag` and `TagMetadata`.                                                                                                                     |
| `tag-values.ts`              | Per-type tag helpers: `TAG_TYPES`, labels, descriptions, `TAG_TYPE_ICONS`, value validation, canonicalization, formatting, and the date-only helpers.                                    |
| `utils.ts`                   | `cn()`, the clsx + tailwind-merge helper.                                                                                                                                                |

## The SWR wrappers

Five, in `api-actions.ts`, and picking the right one is most of the work:

| wrapper                                                     | for                                                                    | key                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `useAPIData<Output>(path, params?)`                         | idempotent reads, fetch on mount                                       | `{ keyType: "api-data", path, params, accountId }`       |
| `useAPIPostData<Body, Output>(path, body)`                  | one cached idempotent read with a large body                           | `{ keyType: "api-data", method, path, body, accountId }` |
| `useAPIPostDataBatched<Item, Body, Out>(path, items, opts)` | an idempotent read whose payload is a list too long for a query string | `{ keyType: "api-data", path, items, accountId }`        |
| `useAPIFetch<In, Out>(path)`                                | a GET you only want on demand (search, suggestions)                    | `path` string                                            |
| `useAPIMutation<Body, Res>(method, path, invalidates?)`     | user-triggered writes                                                  | `[method, path, accountId]`                              |

All five pull the JWT from `useAccount()` and send `Authorization: Bearer <jwt>`. All five
tolerate an empty response body, and all five throw the parsed error body on a non-2xx, so a
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
useAPIMutation<ApplyTagPayload, void>("POST", "/songs/tags", ({ song_id }) => [
    { path: "/songs/tags", params: { song_id } },
    { path: "/tags" },
]);
```

`invalidatedEndpoints` defaults to `[]`. A mutation that lists nothing leaves every cached
`useAPIData` entry alone and the UI showing stale data, including caches in other route files.

## `routes/` mirrors `backend-api/src/routes/`

One file per backend router, and every backend endpoint has at least one hook.

| backend             | endpoint                        | hook                                          |
| ------------------- | ------------------------------- | --------------------------------------------- |
| `routes/tags.rs`    | `GET /tags`                     | `tags.ts` -> `useUserTags()`, `useTag(tagId)` |
|                     | `POST /tags`                    | `tags.ts` -> `useCreateTag()`                 |
|                     | `DELETE /tags`                  | `tags.ts` -> `useDeleteTag()`                 |
|                     | `GET /tags/suggest`             | `tags.ts` -> `useSuggestTags()`               |
| `routes/songs.rs`   | `GET /songs/tags`               | `songs.ts` -> `useTagsOnSong(songId)`         |
|                     | `POST /songs/tags/batch`        | `songs.ts` -> `useTagsOnSongs(songIds)`       |
|                     | `POST /songs/tags`              | `songs.ts` -> `useApplyTag()`                 |
|                     | `PATCH /songs/tags`             | `songs.ts` -> `useSetTagValue()`              |
|                     | `DELETE /songs/tags`            | `songs.ts` -> `useUnapplyTag()`               |
| `routes/queries.rs` | `POST /queries/results`         | `queries.ts` -> `useQueryResults()`           |
|                     | `GET /queries/advanced/results` | `queries.ts` -> `useAdvancedQueryResults()`   |

`GET /tags` has two hooks because the handler returns a tagged union: without `tag_id` it
responds with `All { tags, metadata }`, with one it responds with `One { tag, song_ids }`.
`useUserTags` and `useTag` each unwrap one variant.

Adding an endpoint: add the route in `backend-api/src/routes/*.rs`, then add a hook in the
matching `routes/*.ts` built on the shared wrappers. For writes, list the endpoints the
change invalidates. Rename the returned fields to something readable (`tagsOnSong`,
`tagsOnSongLoading`, `tagsOnSongErr`) rather than re-exporting SWR's `data` / `error` /
`isLoading`.

`musickit-hooks.ts` does the same job for the native module, using plain `useSWR` with tuple
keys like `["MusicKit.getSongInfo", ids]`. `useSongFavoriteStatus` and `useCollectionFavoriteStatus`
are the optimistic updates in the codebase, both with `rollbackOnError`. `useCollectionInfo`
fetches an album/playlist's own metadata (title, artwork, `shareUrl`). `useCollectionSongs`
pages a detail screen, while `useAllTracksFromLibrary` walks every song page into one cached
candidate set for live query evaluation. `usePlaylistMutations` is the exception to the wrapper
rule: playlist writes are not backend calls, so they are plain async functions that invalidate
every cached playlist key by predicate afterwards.

Every paged library read goes through one internal hook, `usePagedLibraryResult`. It owns the
offset loop (request a page, read `nextOffset`, stop when the native side says there is no next
page), so `useTracksFromLibrary`, `useLibraryAlbums`, `useUserPlaylists`, `useLibraryArtists`,
`useRecentlyAdded`, `useLibrarySongSearch`, and `useCollectionSongs` are each only a key
builder and a fetch. Adding
another paged library read means writing those two things and nothing else. It is generic over
the item type, so it pages `ArtistItem`s as happily as `MusicItem`s; both results have the same
`items` / `hasNextPage` / `nextOffset` shape.

`useCatalogSongSearch` and `useLibrarySongSearch` are the two search scopes and present the
same surface: each holds its own term and takes a submitted one, so a screen switching between
Apple Music and the user's library does not change shape.

`useCatalogArtistSearch` and `useLibraryArtistSearch` are the artist half of those two scopes.
They break the pattern on purpose: the term is an argument, not internal state. The caller
already owns the submitted term, and a third and fourth copy in here would be two more things
to keep in sync. They fetch one page, because the results render as a rail rather than a
scrolling list.

`useCollectionSongs(kind, id)` takes `"album" | "playlist"` rather than splitting into two
hooks, so a screen that renders either does not branch. Pass the collection's `libraryId`.

## Native tab and overlay geometry

Expo Router's `NativeTabs` owns the tab bar and the iOS 26 player accessory. Native scrolling
content receives its tab/accessory inset from the navigator. `screen-overlay.ts` returns app
spacing for scroll content and conservative clearance for absolute controls. On iOS with the
native player accessory, UIKit has already shortened the usable overlay area, so floating actions
add only the safe-area gap instead of counting the tab bar and player twice. Pushed screens and
compatibility players still reserve their full explicit height.

Expo does not expose the native tab bar's measured height because the bar can move to another
edge on other device classes. The absolute-control clearance uses the standard platform bar
height and the player's maximum regular height. It stays conservative while UIKit transitions
the accessory to its inline placement.

Root detail screens are above the native tab controller rather than inside it. One app-level
compact-player overlay is mounted above the root stack and shown for every pushed route, which is
`PLAYER_OVERLAY_SEGMENTS`: the pushed detail segments plus `query-results`, which is pushed with
its own options rather than `pushedScreenOptions`.
The same `useShowsPushedPlayerOverlay` predicate tells `useScreenOverlayInsets` to reserve its
height. Other root screens reserve nothing. Sheets reserve nothing because they cover every
player surface.

`DetailScreen` puts `InsideSheetContext` around sheet bodies, where only the device safe area is
relevant. Native sheets cover the primary bar and player without unmounting or hiding them, so
they are ready on the first dismissal frame. `useBottomBarsHidden` handles temporary suppression;
focused Search is the current token caller. Suppression uses a token set, so overlapping callers
cannot reveal the native bar or accessory until all of them release their token.

A raised keyboard suppresses the bars too, but it is not a token. `BottomBarVisibilityProvider`
watches it directly, because it applies to every screen at once rather than to one caller's
condition, and bars left over a keyboard either cover it or shove the focused field around. iOS
subscribes to the `Will` events so the bars start leaving on the frame the keyboard starts
arriving; Android only fires the `Did` pair.

## Artwork color

`artwork-color.ts::useArtworkTint` gives a surface the color it paints itself with, from its own
artwork. Two sources, in order:

1. `artworkColor` off the item, which is Apple's own and is what Music tints with. Free, and
   synchronous.
2. Failing that, the average of the image, through `@image-color`. A download and a decode, so
   it goes through SWR keyed on the artwork URL.

Library artwork usually has no color of its own, which is the only reason the second path
exists. Expo Go has no native module for it and returns null, and a null tint renders untinted.

`@/components/ui/tint-backdrop::TintBackdrop` is what actually paints it: the color at the top,
darkening down the page and bottoming out at `depth` of its brightness rather than at black.
The player sheet, collection screen, artist screen, and query-results mosaic all go through those
two. Query results average the four displayed mosaic-cell colors before painting the gradient.

Hand `useArtworkTint` the **small** artwork. Averaging only needs a thumbnail, and a hero-sized
one costs a megabyte to reach the same answer. `ArtworkSource.artworkUrlSmall` wins over
`artworkUrl` for that reason, and `music-routes.ts` passes the small URL as `artworkUrl` and the
hero-sized one separately as `artworkUrlLarge`, which the collection screen draws its cover from.

## Screen scrolling and the player accessory

The primary `NativeTabs` uses `minimizeBehavior="onScrollDown"`. On iOS 26 UIKit minimizes the bar
and moves its `BottomAccessory` between regular and inline placement. UIKit exposes no public
imperative placement API, so the compact player does not add a separate vertical docking gesture.
Its horizontal swipe-away gesture calls `dismissPlayer`, which pauses deterministically and hides
all compact-player hosts. The iOS tab host maps that state to its animated
`bottomAccessoryHidden` prop so UIKit removes the complete native accessory. The provider restores
the player when a new queue starts or when a paused, dismissed track resumes through a system
transport.

Expo documents limited `FlatList` integration with native tabs. On iOS, every primary scroller is
therefore placed directly inside `ScreenScrollMarker` from the underlying `react-native-screens`
package. That marker registers the real native scroll view through the nested tab stack for native
insets, scroll-to-top, and tab-bar minimization. The wrapper is a fragment elsewhere.

`useScreenScroll()` is what a screen's top-level scroller spreads:

```tsx
const scroll = useScreenScroll();
<ScreenScrollMarker>
    <Animated.FlatList {...scroll} ... />
</ScreenScrollMarker>
```

It has to be an `Animated.FlatList` / `Animated.ScrollView`, because the pull-dismiss offset is
read on the UI thread. `ScreenScrollMarker` must have that scroller as its single direct child;
otherwise the native registration cannot resolve the underlying `UIScrollView`. The explicit
react-navigation `useScrollToTop` subscription remains as a cross-platform fallback.

It also drives the close of a pushed detail screen. Overscroll at the top feeds the minimize
continuously, and letting go past the shared threshold finishes it; short of that it springs
back. While a zoom card is active, the hook counters iOS's downward rubber band so the hero stays
anchored inside the shrinking card. Gated on `useIsPushedDetailScreen` from `screen-overlay`: a
sheet already drags down natively and a tab has nowhere to go, so only the pushed routes wire it
up. Android does not overscroll past the top by default, so the pull is an iOS gesture and the X
is the way out on both.

## The minimize

`zoom-dismiss.tsx` is the two halves of Apple's close-back-into-the-artwork transition, which know
nothing about each other:

- A row measures its artwork just before it navigates, through `useZoomSource`. One rect is stored
  at a time, in `ZoomOriginProvider` at the root, because only the screen on top is ever closing.
  The rect is a shared value rather than a snapshot, since `measureInWindow` is asynchronous and
  can land after the push.
- `ZoomDismissScreen` wraps a pushed screen's content in the card that shrinks toward that rect.
  `DetailScreen` does it for every route that uses it; `/artist/:id` and `/collection/:kind/:id`
  render it themselves, since they draw their own header.

The card runs both directions of the transition: it starts minimized and grows on mount, and
shrinks back on close. That is why those routes carry `pushedScreenOptions()`, which presents them
as transparent modals with no native animation. The screen that opened this one is still on
display underneath. The card's top-left corner follows the artwork's top-left corner, while its
width sets a uniform scale. Its native continuous corners compensate for that scale, so they stay
visibly rounded instead of tightening as the card gets smaller.

Every close goes through `useCloseScreen`, so the X and the pull play the same animation, and a
screen with no card falls back to a plain `router.back()`. With no recorded rect the card shrinks
toward the bottom of the window rather than doing nothing, which is what a deep link gets. A rect
older than `ORIGIN_MAX_AGE` at mount counts as none: a screen opened by something that records
nothing must not grow out of whatever row was tapped a minute ago.

The pull owns progress continuously instead of stopping at the close threshold. Releasing past
it claims the animation on the UI thread before the scroll view rebounds, then finishes only the
remaining distance. A short pull still springs back to full size.

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
- `@image-color`, from `artwork-color.ts` and nowhere else.
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
