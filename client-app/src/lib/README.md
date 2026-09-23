# lib

The data layer and the app-wide providers. Anything that fetches, caches, or holds global state
lives here. Screens and components should import from here rather than calling `fetch` or the
native module directly.

## Files

| file                         | role                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend.ts`                 | `BACKEND_URL`. One constant, currently hardcoded.                                                                                                                                                                                                                                                 |
| `api-actions.ts`             | The generic SWR wrappers: `useAPIData`, `useAPIPostData`, `useAPIPostDataBatched`, `useAPIFetch`, `useAPIMutation`.                                                                                                                                                                               |
| `api-endpoints.ts`           | `matchesEndpoint`, the cache-key matcher behind invalidation. Import-free so it can be unit tested.                                                                                                                                                                                               |
| `swr-utils.ts`               | `clearCache` and `useSimpleMutation`, for things that are not plain backend calls.                                                                                                                                                                                                                |
| `routes/tags.ts`             | Hooks for `/tags`: `useUserTags`, `useTag`, `useCreateTag`, `useDeleteTag`, `useDefaultTags`, `useSuggestTags`, `useEditTagScores`.                                                                                                                                                               |
| `routes/songs.ts`            | Hooks for local and default tag reads (one song and batched), local tag writes, removing a suggested tag, and editing the user's library.                                                                                                                                                                                   |
| `routes/queries.ts`          | `useQueryResults`, the one cached hook for `/queries/results`. Both builders go through it, and it carries the suggested-tag flag. It sends no song ids: the backend queries the library it already has.                                                                          |
| `routes/comments.ts`         | Hooks for `/comments`: `useSongComments`, `useCreateComment`, `useDeleteComment`, `useVoteOnComment`.                                                                                                                                                                                             |
| `comment-votes.ts`           | `applyCommentVote`, the optimistic update `useVoteOnComment` makes to cached comment threads. `sortThreadsByVotes` and `orderThreadsLike`, which `CommentsPage` uses to sort threads by score and then hold that order while it is in view. Only type imports, tested in `comment-votes.test.ts`. |
| `musickit-hooks.ts`          | SWR over the native module: song info, catalog search, paged and complete-library songs, albums, artists, playlists, collection metadata, favorites, artist search, and playlist writes.                                                                                                          |
| `song-init.tsx`              | `SongInitProvider`, which runs the library sync job after account and Apple Music authorization.                                                                                                                                                                                                  |
| `song-init-job.ts`           | Import-free, tested library sync job: walks Apple Music, diffs it against the local record, and sends the difference to `PATCH /songs`.                                                                                                                                                           |
| `initialized-songs-db.ts`    | The expo-sqlite `initialized_songs` table, the device's record of what `user_songs` holds. Opens the database and hands the job an `InitializedSongsStore`.                                                                                                                                       |
| `tag-scores.tsx`             | `TagScoreTracker`, which gives each of the user's own tags on a song 2 points and each default tag 1 point when that song starts playing, and `useScoreQueryTags`, which gives every tag a query uses positively 10 points.                                                                      |
| `tag-score-deltas.ts`        | The `PATCH /tags/scores` body one play of a song, or one run of a query, is worth. Only type imports, tested in `tag-score-deltas.test.ts`.                                                                                                                                                       |
| `account.tsx`                | `AccountProvider` / `useAccount`. Supabase session and the JWT.                                                                                                                                                                                                                                   |
| `apple-music-auth.tsx`       | `AppleMusicProvider` / `useAppleMusic`. Apple Music tokens, persisted in secure store.                                                                                                                                                                                                            |
| `playback.tsx`               | `PlaybackProvider`, broad `usePlayback`, lightweight `usePlaybackTrackState`, and stable `usePlaybackCommands`. Queue, native playback snapshot, and compact-player dismissal state.                                                                                                                                           |
| `queue-order.ts`             | Pure index math for the queue mirror. Tested in `queue-order.test.ts`.                                                                                                                                                                                                                            |
| `supabase.ts`                | The Supabase client, backed by AsyncStorage.                                                                                                                                                                                                                                                      |
| `theme.ts`                   | `NAV_THEME`, light and dark palettes for react-navigation, `sheetScreenOptions` for sheet routes, and `pushedScreenOptions` for the pushed detail routes.                                                                                                                                         |
| `error-utils.ts`             | `getErrorDetails` / `getErrorMessage`, for unwrapping native and backend errors.                                                                                                                                                                                                                  |
| `artwork-color.ts`           | `useArtworkTint`, the color a surface paints itself with, plus alpha, darkening, and multi-artwork averaging helpers.                                                                                                                                                                             |
| `artwork-color-utils.ts`     | Native-free channel averaging for multi-artwork tints.                                                                                                                                                                                                                                            |
| `music-routes.ts`            | `collectionRoute` / `albumRouteForTrack`. Hrefs into the resource screens, params and all.                                                                                                                                                                                                        |
| `share-track.ts`             | `shareTrack` / `shareCollection`. Builds and fires the native share sheet for a song, album, or playlist's canonical Apple Music link.                                                                                                                                                            |
| `screen-overlay.ts`          | `useScreenOverlayInsets`, native tab/accessory visibility, extra overlay clearance, focused-screen suppression, and pushed-screen detection.                                                                                                                                                      |
| `screen-overlay-geometry.ts` | Pure, tested bottom-inset arithmetic shared by tab-hosted and pushed-screen compact players.                                                                                                                                                                                                      |
| `playable-item.ts`           | Pure identity and collection-membership helpers for library/catalog forms of a playable item.                                                                                                                                                                                                     |
| `screen-scroll.ts`           | `useScreenScroll`, the props a screen's top-level scroller spreads to get tab-press-scrolls-to-top and pull-down-to-close.                                                                                                                                                                        |
| `screen-scroll-marker.*`     | iOS registration wrapper for native-tab inset and scroll-to-top integration with nested and virtualized scrollers; a fragment elsewhere.                                                                                                                                                          |
| `zoom-dismiss.tsx`           | `ZoomOriginProvider`, `useZoomSource`, `ZoomDismissScreen`, `useCloseScreen`. Closing a pushed screen by shrinking it back into the artwork that opened it.                                                                                                                                       |
| `zoom-dismiss-geometry.ts`   | Pure pull, transform, timing, and corner math for `zoom-dismiss`, tested without React Native.                                                                                                                                                                                                    |
| `types.ts`                   | Shared wire types: `TagType`, `Tag`, `AppliedTag` and `TagMetadata`.                                                                                                                                                                                                                              |
| `query-json.ts`              | The tag query wire format: `QueryJSON`, `QueryJSONNode`, `FilterJSON`, `FilterOp`. Types only, so the pure builder utils stay testable under `node --test`.                                                                                                                                       |
| `tag-values.ts`              | Per-type tag helpers: `TAG_TYPES`, labels, descriptions, `TAG_TYPE_ICONS`, value validation, canonicalization, formatting, the date-only helpers, and `unownedDefaultTags`.                                                                                                                       |
| `utils.ts`                   | `cn()`, the clsx + tailwind-merge helper.                                                                                                                                                                                                                                                         |

## The SWR wrappers

Five, in `api-actions.ts`, and picking the right one is most of the work:

| wrapper                                                     | for                                                                    | key                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `useAPIData<Output>(path, params?)`                         | idempotent reads, fetch on mount                                       | `{ keyType: "api-data", path, params, accountId }`       |
| `useAPIPostData<Body, Output>(path, body)`                  | one cached idempotent read with a large body                           | `{ keyType: "api-data", method, path, body, accountId }` |
| `useAPIPostDataBatched<Item, Body, Out>(path, items, opts)` | an idempotent read whose payload is a list too long for a query string | `{ keyType: "api-data", path, items, accountId }`        |
| `useAPIFetch<In, Out>(path)`                                | a one-shot GET fired by a user action, never on render                 | `path` string                                            |
| `useAPIMutation<Body, Res>(method, path, invalidates?)`     | user-triggered writes                                                  | `[method, path, accountId]`                              |

All five pull the JWT from `useAccount()` and send `Authorization: Bearer <jwt>`. All five
tolerate an empty response body, and all five throw the parsed error body on a non-2xx, so a
caught error is the backend's `{ error_type, message }` object, not an `Error`.

The `accountId` in every key means a cached read can never be served to a different user, on
top of the `clearCache()` that already runs on every account change.

`useAPIData` disables itself (passes a `null` key) if there is no account, or if **any** param
value is null or undefined. That is how `useTag(undefined)` and `useTagsOnSong(undefined)` stay
dormant until an id arrives. An empty string is a real value, so a blank search still fetches.

`useAPIData` takes an optional third argument passed straight to SWR. `keepPreviousData` is the
one that matters for a search-as-you-type read, where each keystroke is a new key and `data` would
otherwise drop to undefined between responses. `useDefaultTags` is the caller.

`useAPIPostDataBatched` exists for reads whose request is a list too long for a query string. It
splits the list into parallel requests and merges the responses, but stays **one** `api-data`
key so invalidation works like every other read. `useTagsOnSongs` and `useDefaultTagsOnSongs`
are the callers: a list screen reads both, so each row can show the user's tags and the song's
shared defaults.

Do not reach for `useSWRInfinite` here. `mutate(filterFn)` skips `$inf$` keys outright, and the
per-page keys it does visit have no subscribed revalidator, so a filtered `mutate` silently
does nothing and the data goes stale forever. That is why this wrapper batches inside a single
`useSWR` instead of paging.

Invalidation is the part to get right, and it is entirely manual. `useAPIMutation` takes a list
of `{ path, params? }` endpoints, or a function from the request body to that list when the key
depends on what was just written. After a successful request it matches every `api-data` key
whose `path` is equal and whose `params` are a **superset** of the listed ones. So a bare
`{ path: "/songs/local-tags" }` invalidates the local tags of every song, while
`{ path: "/songs/local-tags", params: { song_id } }` invalidates just the one that changed.

```ts
// invalidate only this song's tag list, plus the tag counts
useAPIMutation<ApplyTagPayload, void>(
    "POST",
    "/songs/local-tags",
    ({ song_id }) => [
        { path: "/songs/local-tags", params: { song_id } },
        { path: "/tags" },
    ],
);
```

`invalidatedEndpoints` defaults to `[]`. A mutation that lists nothing leaves every cached
`useAPIData` entry alone and the UI showing stale data, including caches in other route files.

## `routes/` mirrors `backend-api/src/routes/`

One file per backend router, and every backend endpoint has at least one hook.

| backend              | endpoint                         | hook                                           |
| -------------------- | -------------------------------- | ---------------------------------------------- |
| `routes/tags.rs`     | `GET /tags`                      | `tags.ts` -> `useUserTags()`, `useTag(tagId)`  |
|                      | `POST /tags`                     | `tags.ts` -> `useCreateTag()`                  |
|                      | `DELETE /tags`                   | `tags.ts` -> `useDeleteTag()`                  |
|                      | `GET /tags/default-tags`         | `tags.ts` -> `useDefaultTags(search)`          |
|                      | `GET /tags/suggest`              | `tags.ts` -> `useSuggestTags()`                |
|                      | `PATCH /tags/scores`             | `tags.ts` -> `useEditTagScores()`              |
| `routes/songs.rs`    | `GET /songs/local-tags`          | `songs.ts` -> `useTagsOnSong(songId)`          |
|                      | `POST /songs/local-tags/batch`   | `songs.ts` -> `useTagsOnSongs(songIds)`        |
|                      | `GET /songs/default-tags`        | `songs.ts` -> `useDefaultTagsOnSong(songId)`   |
|                      | `POST /songs/default-tags/batch` | `songs.ts` -> `useDefaultTagsOnSongs(songIds)` |
|                      | `DELETE /songs/default-tags`     | `songs.ts` -> `useRemoveDefaultTag()`          |
|                      | `POST /songs/local-tags`         | `songs.ts` -> `useApplyTag()`                  |
|                      | `PATCH /songs/local-tags`        | `songs.ts` -> `useSetTagValue()`               |
|                      | `DELETE /songs/local-tags`       | `songs.ts` -> `useUnapplyTag()`                |
|                      | `PATCH /songs`                   | `songs.ts` -> `useEditUserSongs()`             |
| `routes/queries.rs`  | `POST /queries/results`          | `queries.ts` -> `useQueryResults()`            |
| `routes/comments.rs` | `GET /comments`                  | `comments.ts` -> `useSongComments(songId)`     |
|                      | `POST /comments`                 | `comments.ts` -> `useCreateComment()`          |
|                      | `DELETE /comments`               | `comments.ts` -> `useDeleteComment()`          |
|                      | `POST /comments/votes`           | `comments.ts` -> `useVoteOnComment(songId)`    |

`GET /tags` has two hooks because the handler returns a tagged union: without `tag_id` it
responds with `All { tags, metadata }`, with one it responds with `One { tag, song_ids }`.
`useUserTags` and `useTag` each unwrap one variant.

`useVoteOnComment(songId)` is the one backend write that updates optimistically. It runs the vote
inside the bound `mutate` of that song's `/comments` read, with `comment-votes.ts::applyCommentVote`
as the optimistic data and `rollbackOnError`, then revalidates the read whether the vote saved or
not. So its `useAPIMutation` lists nothing to invalidate. `useDeleteComment` invalidates every
song's comments, because its payload carries no song id.

`useEditTagScores` invalidates nothing either, for the opposite reason: nothing in the client reads
tag scores yet, so there is no cached read to revalidate. The backend has `GET /tags/scores?k=N`;
when a hook for it lands, add its key to this mutation.
Its callers are both in `tag-scores.tsx`, below.

Adding an endpoint: add the route in `backend-api/src/routes/*.rs`, then add a hook in the
matching `routes/*.ts` built on the shared wrappers. For writes, list the endpoints the
change invalidates. Rename the returned fields to something readable (`tagsOnSong`,
`tagsOnSongLoading`, `tagsOnSongErr`) rather than re-exporting SWR's `data` / `error` /
`isLoading`.

A song's default tags are read separately from its user tags, by `useDefaultTagsOnSong` for one
song and `useDefaultTagsOnSongs` for a list. Both surfaces draw them as unfilled pills next to
the user's own tags. `tag-values.ts::unownedDefaultTags` drops the defaults whose name the user
already has on the song, since a name applied by enough users is promoted to a default tag and
would otherwise show twice. Applying a user tag can trigger that promotion, so `useApplyTag`
invalidates both default-tag reads.

`useRemoveDefaultTag` is the other side: it drops one suggestion from one song for this user
only, so it invalidates both default-tag reads plus `/queries/results`, which counts suggested
tags when the caller asks it to. It leaves `/tags` and the local tag reads alone, since the
user's own tags do not change.

`musickit-hooks.ts` does the same job for the native module, using plain `useSWR` with tuple
keys like `["MusicKit.getSongInfo", ids]`. `useSongFavoriteStatus` and `useCollectionFavoriteStatus`
are the optimistic updates in the codebase, both with `rollbackOnError`. `useCollectionInfo`
fetches an album/playlist's own metadata (title, artwork, `shareUrl`). `useCollectionSongs`
pages a detail screen, while `useAllTracksFromLibrary` walks every song page into one cached
copy of the library. `useTracksForSongIds` is what turns backend song ids into tracks: it
resolves what that cached library holds and sends the rest to `getSongInfo`. `usePlaylistMutations` is the exception to the wrapper
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
compact-player overlay is mounted above the root stack and shown for artist, collection, and
query-results routes.
The same `useShowsPushedPlayerOverlay` predicate tells `useScreenOverlayInsets` to reserve its
height. Other root screens reserve nothing. Sheets reserve nothing because they cover every
player surface.

`DetailScreen` puts `InsideSheetContext` around sheet bodies, where only the device safe area is
relevant. Native sheets cover the primary bar and player without unmounting or hiding them, so
they are ready on the first dismissal frame. `useBottomBarsHidden` handles temporary suppression;
focused Search is the current caller. Suppression uses a token set, so overlapping callers cannot
reveal the native bar or accessory until all of them release their token.

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
- `SongInitProvider` runs after account and Apple Music authorization. It walks the library and
  library playlists and syncs what it finds into the backend's `user_songs`, which is what
  queries run over. It no longer generates default tags: the backend does that lazily, the first
  time something reads a song's default tags.
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

## The library sync job

The backend runs queries over `user_songs`, its own copy of the user's library, so that copy has
to follow Apple Music. `song-init-job.ts::syncLibrary` is what moves it, and
`initialized-songs-db.ts` is the device's record of what it has already told the backend.

One run:

1. Take the current timestamp. Everything below is stamped with it.
2. Page through library songs and every library playlist, keyed by `catalogId ?? id`, the
   same id tags and queries use. The library walk and the playlist walk run at the same time,
   and the playlists themselves run `PLAYLIST_CONCURRENCY` at a time. A song already in
   `initialized_songs` has its `initialized_at` moved up to the run's timestamp. A song that is
   not in there has never been sent, so it is an add.
3. Anything still stamped older than the run is a song Apple Music no longer has, so it is a
   remove.
4. Send both through `PATCH /songs`, at most 200 songs a request, removes first. After each
   request the adds are written into `initialized_songs` and the removes are deleted from it.
5. Invalidate `/queries/results` once, at the end, if anything actually changed.

The parallel walks share one seen set and one store. Deduplication is safe because that set is
read and written with no await in between, so two pages cannot both claim the same song. Store
writes are not: `markSeen` reads and then writes inside one transaction on a single SQLite
connection, so each call is queued behind the last. The parallelism is in the Apple Music reads
only, which is where the run actually spends its time.

`initialized_songs` is `(user_id, song_id, initialized_at)`, keyed on `(user_id, song_id)`, with
an index on `song_id` and one on `(user_id, initialized_at)` for the stale scan.

`song-init.tsx::SongInitProvider` wires the job to MusicKit, `useEditUserSongs`, the SQLite
store, cancellation, and the "Syncing with Apple Music" task. The job is imperative rather than
SWR because its reads only decide what to write.

Every Apple Music page it reads and every `PATCH /songs` it sends logs a line tagged
`[library-sync]`, which is also on its failures, so one run greps out of the console whole. A
page line carries its source, offset, item count, and how many of those songs the backend had
never been told about; a send line carries the direction, the batch size, and the batch's place
in the pass. Sends are logged before the request, so a batch that hangs still shows up.

Default tags are not part of this. The backend generates them lazily, the first time a default
tag read touches a song it has never generated for.

## Scoring tags on playback

The tags on a song score the moment that song starts playing, which is how the backend learns
which tags the user listens to rather than which ones they type.
`tag-scores.tsx::TagScoreTracker` is mounted at the root, watches `usePlaybackTrackState()`, and
sends one `PATCH /tags/scores` per play. The body is
`tag-score-deltas.ts::playTagScoreDeltas`: 2 points for each of the user's own tags
(`LOCAL_TAG_PLAY_SCORE_DELTA`) and 1 for each default tag (`DEFAULT_TAG_PLAY_SCORE_DELTA`), added
up by tag name, since scores go by name rather than by tag id. A name that is both a local and a
default tag on the song gets 3.

There is no native playback-start event. A start is the polled snapshot reporting a track that is
playing and is not the track the last point went to, so resuming after a pause is not a new play,
and neither is the same song repeating.

It reads the user's own tags through `useTagsOnSong` and the default tags through
`useDefaultTagsOnSong`, both under the song's `catalogId ?? id`. Those are the same cache keys the
player sheet's Tags page reads, and the list rows read the same data in batches, so the reads are
usually already warm when a song starts. The play waits for both. If the default read fails, it
scores the user's own tags alone.

Reading a song's default tags generates them when nothing has yet, so playing a song that no list
or player sheet has shown can spend an LLM call and holds the play's score until generation
finishes.

## Scoring tags in queries

`tag-scores.tsx::useScoreQueryTags` returns a callback that gives every tag a query uses
positively 10 points (`QUERY_TAG_SCORE_DELTA`), in one `PATCH /tags/scores`. `CadenzaScreen` calls it when the user opens
the full results, not on each live edit. The body is `tag-score-deltas.ts::queryTagScoreDeltas`,
which walks the `QueryJSON` tree. A tag filter under an odd number of `not`s is negative, and
`is_not_applied` counts as one more `not`. A tag counts once per query however often it appears,
and counts if it is used positively anywhere. `tag_name`, `tag_value`, and `tag_type` filters name
no one tag and score nothing. Tag ids resolve to names through the tag list the caller passes.

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
- `useAPIFetch` uses the bare `path` as its SWR key, so two `useAPIFetch` hooks on the same path
  share a mutation key. `useAPIMutation` keys on `[method, path, accountId]`, so it does not.
- `useAPIFetch` does not populate the cache, so it repeats a request it has already made. A live
  search field belongs on `useAPIData` with the search text in the params and `keepPreviousData`,
  which caches per search. `useAPIFetch` is for a one-shot the user asks for, like `useSuggestTags`
  spending an OpenAI call.
- Tags key on `catalogId ?? id`, not the library id, everywhere a song id crosses into the
  backend. Library ids differ per user for the same song; catalog ids do not.
- That key is not stable, though. Apple attaches a `catalogId` to a library song only when it
  resolves one, so the same song can reach the backend under its catalog id from one read and
  under its library id from another, and `user_songs` ends up holding a mix. Never match a
  backend song id against a track by one id alone. `useTracksForSongIds` indexes a track under
  `id`, `catalogId`, and `libraryId`, and falls back to `getSongInfo`, which does the same.
- The delete half of the library sync only runs when the Apple Music walk read every source. A
  source that throws is logged and skipped, and skipping it makes the walk incomplete, because
  "not stamped this run" would otherwise read the unread songs as deleted and strip them from
  `user_songs`.
- `initialized_songs` rows carry a `user_id`. The database file is per device and the library is
  per account, so without it a second account on the same device would read the first account's
  library as its own and sync the difference.
- `initialized_songs` tracks what the backend has been told, not what Apple Music holds. That is
  why it is written after each `PATCH /songs` succeeds and not before: a run that dies halfway
  leaves the rest for the next run rather than marking it done.
- `expo-sqlite` is a native module. Adding or upgrading it needs a dev client rebuild, not just
  a metro restart.
- The first sync on an existing install sends the whole library, one `PATCH /songs` per 200
  songs. It is cheap per request, since the backend no longer generates tags there, but a large
  library still makes a long first run.
- `api-actions.ts` reads `account?.jwt` at hook call time. A component rendered before the
  session is restored sends `Bearer undefined`.
- A comment vote is absolute (`"up"`, `"down"`, or `null`), and the server keeps whichever request
  it handles last. Two quick taps on one comment send two requests that can land out of order.
- Opening the app while Apple Music is already playing scores that song. The first snapshot looks
  exactly like a song that just started, and nothing in it says when playback began. A reload in
  development does the same.
- Nothing is scored while the app is backgrounded, because the snapshot poll only runs while it is
  foregrounded. A queue that advances in the background scores one song, whatever is playing when
  the app comes back.
- Skipping a song before its tags arrive drops that song's point. The tag read is keyed by song, so
  the answer for the song that already left is never looked at.
- Opening a query's full results twice scores its tags twice. Each open is one use.
- A song scores the tags it had when it started. Tagging it while it plays counts from the next
  play on.

---

Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
