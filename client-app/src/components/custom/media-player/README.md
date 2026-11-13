# media-player

Global Apple Music playback controls. Expanded playback uses the iOS 26+ native tab accessory
and tucks on scroll. Unsupported platforms and pushed screens use floating controls. The full
player sheet at `/player` has Player, Discuss, and Tags pages.

## Entry points

- `media-player-host.tsx` mounts the tab host. It stays mounted under native sheets to avoid a
  dismissal flash.
- `media-player.tsx` renders the floating surface; it does not own motion state.
- `native-player-accessory.tsx` renders UIKit's regular/inline content.
- `@/lib/player-presentation.tsx` owns one UI-thread motion controller, foreground geometry,
  native layout, and handoff readiness. Host and gesture tokens reject stale callbacks.
  Its derived geometry is a direct mapper input for the floating surface; do not hide shared
  geometry dependencies inside a helper worklet called by `useAnimatedStyle`. Floating width
  uses untransformed layout dimensions.
- `@/lib/screen-overlay-geometry.ts` owns bottom spacing, spring settings, and gesture math.

## Behavior and invariants

When playback first supplies a track, a centered artwork circle fades in over 100ms, pauses for
150ms, then springs outward to the expanded bar. Native insertion waits for completion. Changing songs
keeps the existing presentation and does not replay the entrance.

Tapping expanded artwork collapses the player without pausing. A left drag must cross 8 points
before changing visuals. A transparent interaction proxy above the native accessory owns the
whole gesture and remains mounted as the accessory is removed. Swipe collapse is disabled
while UIKit has tucked the player inline with the navigation bar. The floating bar then tracks
finger movement beyond the threshold. Releasing projects velocity into its settling spring;
cancelling restores expanded playback before native reinsertion. Artwork taps spring the bar
and artwork down to the circle immediately.
The locked circle is 52 points wide with a
3-point artwork rim. A right drag widens it with the finger and projects release velocity into
a spring. Holding for 155ms unlocks free dragging with one haptic. Free bubbles grow 10%, drag
silently, and expand only on a tap. Dropping within 1.5 free radii of home springs back and locks;
a post-release spring landing also captures. A free tap first returns vertically over 160ms,
pauses 80ms, then expands. The native accessory is inserted only after expansion completes. Floating glass is hidden
in that same React commit, before native layout reports, to avoid stacked-material flashes.
Track and queue changes preserve the current collapsed or expanded state.

On a committed native collapse, the floating renderer owns the width and artwork animation. The screens patch
removes insertion/removal fades. Movement below the threshold leaves native glass untouched. Run `npx pod-install` and rebuild iOS after changing
the patch. Scroll minimization remains UIKit-owned.

Sort and Library Tags' plus action share `useBottomRowActionButton`. Their sources own their
sheets; the host owns placement. The assistant button is always the row's rightmost
control, whenever the row shows except under multiselect; a row action sits one slot to its
left and both share the same lift, scale, and dock. Floating bottom glass always clips to its radius. Unclipped, it
goes square on Android, and on iOS it paints dark rectangles whenever UIKit clips something above
it, like the screen behind any sheet. Artwork and
transport content have separate clipping.
The control sits above expanded playback, follows native tuck,
and stays centered over Search, expanded or tucked. Search's place is not readable from UIKit, so
it comes from `SEARCH_TAB_CENTER_FROM_RIGHT` in `@/lib/screen-overlay-geometry` (a 62pt circle
21pt in), which floating bubbles use too through `BOTTOM_ACTION_RIGHT_OFFSET`. In circle mode it shares the bottom row. Temporary chrome
suppression hides it without mounting a local fallback. Controls enter and exit from the right.

Multiselect registers content in the separate `bottom-selection-overlay.tsx` context to avoid
feeding panel updates back through list layout. It slides in from the left, above an expanded
player or below a circle. Its modal state stays mounted while keyboard suppression hides chrome.
Full-height positioning wrappers use `pointerEvents="box-none"` so palette and list scrolling
passes through outside the visible controls. Do not animate the host's bounds or poll hidden native views with Reanimated `measure()`.

Gesture Handler 3 hooks live in `usePlayerGestures`, outside the shared controller. The
controller supplies worklet callbacks; handler tags drive manual activation, and canceled
deactivation never commits a collapse. The renderer owns stable native handler lifetimes.

The worklet tests exercise the shared controller with React Compiler enabled, including stale
host events, native drag handoff, lock/capture, and expansion ordering. Shared values are read
only in callbacks/worklets (`.get()`), never during React render. Native visual behavior still
needs device verification; no test harness simulates UIKit's material or hit testing.

### The now playing sheet's three pages

`app/player/_layout.tsx` presents the sheet and its route slot. `/player`, `/player/discuss`, and
`/player/tags` each render the same `PlayerPager`, which mounts Discuss, Player, and Tags side by
side inside one horizontal paging `ScrollView`. The route selects Player, Discuss, or Tags.
Swipes expose the adjacent live page under the finger, and the glass selector's highlight follows
the scroll position continuously. Each selected tab uses its filled icon variant; inactive tabs
use outlines. The three page instances stay mounted for the sheet's lifetime. Tags and Discuss do not
start their network reads merely because their page shells are mounted. The pager enables a page's
reads the first time that page is selected, then leaves them enabled so revisiting it is instant.
Preserve that separation when adding data to an offscreen player page.

On Android the sheet is a Material `BottomSheetBehavior`, which lets a vertical drag through to
the content only inside the first nested-scrolling view it finds, and moves the sheet for every
other vertical drag. Pages sit side by side, so it would find Discuss's pull-to-refresh list and
block scrolling on Tags. `SheetScrollRegion` in `player-pager.tsx` is an empty scroll view placed
ahead of the pages so the sheet finds it instead. It covers the pages on Discuss and Tags and
shrinks to nothing on Player, so pulling the artwork down still closes the sheet. A new vertical
scroll view in the sheet needs nothing more, but anything nested-scrolling placed ahead of
`SheetScrollRegion` would take its place.

`PlayerScopeProvider` resolves a `focusedSong` (id, title, artwork) from `usePlayback()`'s
`activeTrack` or the route's `tagsSongId` / `tagsSongTitle` / `tagsArtworkUrl` /
`tagsArtworkColor` params and shares it across the three pages.

Only `PlayerPage` touches playback. `TagsPage` and `DiscussPage` take `focusedSong` and never read
`usePlayback()`. Discuss lists posts whose topic is that song, most liked first, ten at a time. Its compose
dialog is the media tab's new-post dialog with the topic locked to that song. Tapping an author closes this sheet, or the standalone `/discuss/:songId` screen, and opens that person's profile on the Social tab. `DetailScreen` hands the sampled artwork color to the same mode-aware Oklch
gradient hook as `TrackCollectionView`, then paints those stops once behind the header and the
transparent pager, so there is no second gradient boundary below the title. The pager is the gesture surface;
it does not navigate during a swipe or wait for a destination route to mount.

The primary native bar and compact player remain mounted underneath a sheet. The sheet itself
covers them, which lets both appear on the first frame of dismissal instead of waiting for the
route transition to finish. Focused Search still suppresses them explicitly, and so does a raised
keyboard, which `BottomBarVisibilityProvider` watches for every screen at once.

Detail screens push inside the current tab's stack, so the tab bar and the tab-level player stay
over them like any tab screen. No separate player host is needed.

Playback state lives in `PlaybackProvider`, not here.

The two halves are split by what they render into. `media-player.tsx` owns playback commands and
the tap that pushes `/player`. `player-scope.tsx` owns the song shared by the sheet routes.
`player-page.tsx` derives its state from `usePlayback()`. Favorites for the heading/queue heart go through
`useSongFavoriteStatus`, which updates optimistically; tag editing and the `...` menu's own
favorite copy now live inside `SongOptionsMenu`, not here (see Files).

The layout follows Apple Music's within the Player page. Top block, then the scrubber, then the
transport. The top block is artwork or, once the queue button is on, `queue-view.tsx`. The queue
opens **in place** rather than as a second page or a second sheet, so playback stays reachable
while you reorder. `player-page.tsx` holds that as one `view` state and nothing else changes.

The artist name opens the artist; artwork opens View artwork and Go to album actions. The image
viewer supports close/native back. Opening an artist or album closes this sheet and pushes the page
in the tab underneath, through `useOpenScreen`'s `closing: "player"`. The song menu shares these caches.

Queue positions are converted in exactly one place. `queue-view.tsx` works in upcoming-list
positions, because the playing song is its heading rather than a row; `usePlayback()` works in
whole-queue positions, because that is what native takes. `queuePositionOf` in `player-page.tsx`
is the only bridge between them.

Every other file is presentational. They take props and render, and hold no hooks into `@/lib`.

Sheet presentation, the grabber, the drag to dismiss, and the header are **not** in this
directory. They come from `sheetScreenOptions` (`@/lib/theme`) and `DetailScreen`
(`@/components/ui/detail-screen`), shared with the account sheet. Those two routes are the only
sheets left; every other detail route is pushed with the bars over it.

Progress is interpolated over `PLAYBACK_PROGRESS_INTERPOLATION_MS` (800ms) so the bar moves
smoothly between the 750ms native snapshot polls, and scrubbing overrides it with
`scrubPosition` until release.

## Connects to

- `@/lib/playback::usePlayback` for all transport.
- `@/features/social` (`PostCard`, `CreatePostDialog`) and `@/lib/routes/social`
  (`useTopicPosts`, `useCreatePost`) for Discuss. A post there has `topic_mk_id` set to the
  focused song.
- `@/lib/musickit-hooks::useSongFavoriteStatus` for the heading/queue heart.
- `@/lib/screen-overlay` for the shared visibility rules and fallback clearance.
- `@/components/custom/reorderable-list::ReorderableList` for the up-next list.
- `@/components/custom/options-menu::SongOptionsMenu` for the `...` menu, documented in
  [../../README.md](../../README.md). `player-page.tsx` passes it a `navigate` that dismisses the
  sheet and opens the destination in the tab underneath. Discuss opens `/discuss/:songId` for that song, dismissing the sheet when
  it is already up, and does not change playback. Modify Tags opens the menu's selector popup
  without navigating.
- Mounted by `src/app/(tabs)/_layout.tsx`; the sheet navigator is declared by
  `src/app/player/_layout.tsx`.

## Gotchas

- Keep `app/player/` outside `(tabs)`. It is a root sheet over the primary tabs, and its pager is
  deliberately a plain horizontal scroll surface rather than another navigator.
- Collapse state stays in `PlaybackProvider` so tab and pushed-screen hosts agree on the shape.
- The app-owned surface paints the glass once behind the controls and artwork.
- A sheet belongs in `SHEET_SEGMENTS` so base-route and sheet-local inset calculations keep using
  the screen beneath it. Sheets do not explicitly hide the primary bars; their native surface
  covers bars that remain mounted underneath.
- Fullscreen artwork uses `ModalPopup` `fullscreen`. The centered card's percentage
  height resolves to 0 on Android, so that viewer was a black screen. The image
  fills its flex parent with absolute edges instead of `h-full`.
- The artwork size is derived from the sheet body measured by `onLayout`, not the window, because
  the sheet leaves out the status bar and the header. `SHEET_DETENT` (imported from
  `@/lib/theme`, so it cannot drift from `sheetScreenOptions`) and `SHEET_HEADER_HEIGHT` in
  `player-page.tsx` only seed the first frame before that measurement lands. `SHEET_HEADER_HEIGHT`
  still mirrors `DetailScreen` by hand and has to be updated if that header changes.
- `PlayerPager` keeps `removeClippedSubviews` off intentionally. All three pages must remain
  mounted, including the page just outside the viewport, or an interactive swipe exposes a blank
  destination and loses page-local state.
- Repeat is deliberately not on the transport row. It lives on the queue view next to shuffle,
  which is where Apple keeps it and what frees the bottom-right slot for the queue button.
- Both mode pills are glass while they are off and invert to a solid white pill with a dark glyph
  while they are on. Off and on differing only by icon color did not read, since `secondary` and
  `muted` are the same value in the dark palette.
- Tapping a queue row **discards** the rows above it. That is not a shortcut, it is the only
  thing either native player can do; see the queue section of the module README.
- The queue list is `ReorderableList`, which positions rows off a fixed `QUEUE_ROW_HEIGHT`
  rather than measuring them. Change the row's height and that constant has to move with it.
- The right end of a queue row (`QUEUE_HANDLE_STRIP`, the three-bar handle and its padding)
  drags on the first movement, however long it was held. A long press anywhere else on the row
  drags too.
- On Android the queue only scrolls because the pager's `SheetScrollRegion` covers the pages
  while it is open. `player-page.tsx` reports its queue view through `useReportQueueOpen`
  (`queue-open.tsx`). With the artwork showing, the region shrinks again so pulling the artwork
  down still closes the sheet.
- The pager's selector gives its `GlassSurface` an explicit radius instead of leaning on the
  parent's `overflow: hidden`. Native glass shapes its lensing and specular edge from its own
  corners, so a clipped square reads as a flat fill. The glass also stays off the touch path
  behind a `pointerEvents="none"` wrapper; the native view ignores `pointerEvents` itself and
  swallows the tab presses.
- The `...` menu, its artist resolution, Go to Artist's library-only disabling, and its own
  gotchas now live with `SongOptionsMenu` - see [../../README.md](../../README.md) rather than
  this file. `TagsPage` uses the reusable `TagSelector`: Your Tags and Suggested are separate glass
  cards. Chosen tags are solid, available tags are outlined, and Show more reveals user tags 20 at
  a time without changing their initial relevance order as choices change. The funnel in Your Tags
  switches between relevance and alphabetical order. Its + control opens tag creation. A tag
  created from it or adopted from Suggested becomes one of the user's tags and is applied to
  `focusedSong` straight away. Basic tag toggles update
  optimistically and hold that state until the refreshed backend read arrives.
- Below the selector, the read-only Metadata Tags card uses the same theme-aware `TagSelectorPanel`
  surface as Your Tags and Suggested and is collapsed by default. Its data is not fetched
  until it expands. Then it shows the song's metadata tags from `useMetadataTagsOnSong`
  (title, artist, album, genre, release date, duration in milliseconds, explicit, and total
  plays, which counts every user's plays), turned into pills by `@/lib/song-metadata-tags` with
  the query builder's field names, followed by My Plays, First Played, and Last Played from
  `useActivityTagsOnSong`. The metadata comes
  from the backend's stored copy, the same rows metadata queries read, so a pill shows exactly
  what a query matches on. A never-set date reads "Never". Activity values change only as the
  user listens (`@/lib/play-recorder`), never from a tap here.
- Long pressing a Suggested tags pill opens `SuggestedTagMenu`, the same glass `ModalPopup` the
  `...` menus use, holding one Remove this action. It calls `useSongTagEditor`'s
  `removeDefaultTag`, which hides that suggestion on this song for this user alone and counts a
  remove against the name. The menu closes first and the request runs after, like the `...` menus,
  so the pill goes when the default tag read comes back without it rather than on the press. It is
  the one editor callback that hands its promise back, so `MusicListActionButton` can log a
  removal that did not save.

---

Touching files in this directory? Update this README in the same change.
See [../../../../../AGENT_GUIDE.md](../../../../../AGENT_GUIDE.md).
