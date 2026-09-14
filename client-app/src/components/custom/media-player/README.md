# media-player

The global Apple Music player. The mini player is one instance mounted outside the navigator, so
it survives navigation, and floats as a glass pill above the tab bar pill. Tapping or swiping it
up opens the now playing sheet, which is the `/player` route rather than a modal this directory
owns. The sheet's body is three swipeable pages - Comments, Player, Tags - with a small glass tab
bar of its own at the bottom.

## Files

| file | role |
| --- | --- |
| `index.ts` | Public surface. Exports `MediaPlayerHost` and nothing else. |
| `media-player-host.tsx` | Decides whether to render at all. Nothing else. |
| `media-player.tsx` | The mini player: playback wiring, the drag between floating and docked, the swipe-up gesture, and `router.push("/player")`. |
| `player-pager.tsx` | `PlayerPager`, the body of the now playing sheet: the three-page swipe, `focusedSong`, and the mini tab bar. Rendered by `app/player.tsx`. |
| `mini-tab-bar.tsx` | `MiniTabBar`, the sheet's own Comments / Player / Tags glass bar, driven by the pager's swipe position. |
| `player-page.tsx` | `PlayerPage`, the middle page: artwork or the queue, the scrubber, the transport. The only page that touches playback. |
| `comments-page.tsx` | `CommentsPage`, the left page: a stub social feed for `focusedSong`. Local state only, no backend, no seed data. |
| `tags-page.tsx` | `TagsPage`, the right page: every user tag for `focusedSong`, applied first. Replaces the old stacked-modal tag editor. |
| `compact.tsx` | The collapsed bar, and the animation between its floating and docked rects. Presentational, all props. |
| `playback-details.tsx` | `MediaPlayerTrackHeading` (title, artist, favorite, `...`) and `MediaPlayerProgress` (scrubber and timestamps). |
| `queue-view.tsx` | What replaces the artwork when the queue is open: compact heading, shuffle and repeat pills, the reorderable up-next list. |
| `transport-controls.tsx` | Shuffle, skip, play, skip, queue. |

The `...` menu and its tag editor are **not** in this directory any more. They moved to
`@/components/custom/options-menu::SongOptionsMenu` and `@/components/custom/song-tag-editor`,
since the list-row song menu needed the same Favorite/Share/Add to Playlist/Go to Album/Go to
Artist/Modify Tags shape this sheet already had. `player-page.tsx` renders `SongOptionsMenu` with
a `navigate` that dismisses the sheet before pushing, and an `onModifyTags` that moves the pager
to the Tags page in place instead of the menu's default route push (see Connects to).

## How it works

`MediaPlayerHost` is rendered once inside `BottomBarsOverlay`, beside `Stack` in
`src/app/_layout.tsx`. It reads `compactPlayerVisible` from `useScreenOverlayInsets()` and renders
`<MediaPlayer />` or nothing. That is the whole file. Where the bar sits is not its business:
`media-player.tsx` reads `compactPlayerBottom` from the same hook, so the bar and the padding
screens leave for it come from one place and cannot disagree.

### The now playing sheet's three pages

`app/player.tsx` resolves a `focusedSong` (id, title, artwork) and an `initialPage` from
`usePlayback()`'s `activeTrack` and the route's `tagsSongId` / `tagsSongTitle` / `tagsArtworkUrl`
/ `tagsArtworkColor` params, then renders `PlayerPager` with them. Modify Tags on a song that is
not playing is what sets those params: `SongOptionsMenu`'s default `onModifyTags` pushes `/player`
with them, since a list row has no sheet to already be inside. Modify Tags on the song actually
playing (the sheet's own menu, in `player-page.tsx`) never touches the route - it calls the pager's
`goToTagsFor`, which updates `focusedSong` in place and swipes to the Tags page, no push.

`PlayerPager` owns the swipe: a `Gesture.Pan` drives a shared `translateX` across the three pages
(Comments, Player, Tags), and a `position` derived value (fractional page index) feeds
`MiniTabBar`'s sliding highlight, the same technique the main `TabBar` uses for its own bubble.
Only `PlayerPage`, the middle page, touches playback; `CommentsPage` and `TagsPage` both take only
`focusedSong` and never read `usePlayback()`.

On iOS, `BottomBarsOverlay` uses `FullWindowOverlay` so native transparent detail screens cannot
cover it. The shared visibility hook hides both bars for account sheets, the now playing sheet,
and focused Search.

Playback state is unaffected either way, because it lives in `PlaybackProvider`, not here.

The bar has two resting places. Floating above the tab bar, and docked inside it over the middle
three tab slots, which is where scrolling a page sends it and where a downward drag puts it.
`media-player.tsx` builds both rects out of `useScreenOverlayInsets` and the bar metrics on
`usePlayerDock`, and `compact.tsx` interpolates between them off `dockProgress`. Skip is the
control that gives way while docked; artwork, title, and play stay. See the docking section of
[../../../lib/README.md](../../../lib/README.md) for what drives the progress.

The two halves are split by what they render into. `media-player.tsx` owns the bar and holds
almost no state: playback from `usePlayback()`, an artwork fallback, and the gesture that pushes
`/player`. `player-pager.tsx` owns the sheet body: `focusedSong`, which page is active, and the
swipe. `player-page.tsx`, the Player page it renders, takes only `onModifyTags` as a prop and
derives everything else from `usePlayback()`. Favorites for the heading/queue heart go through
`useSongFavoriteStatus`, which updates optimistically; tag editing and the `...` menu's own
favorite copy now live inside `SongOptionsMenu`, not here (see Files).

The layout follows Apple Music's within the Player page. Top block, then the scrubber, then the
transport. The top block is artwork or, once the queue button is on, `queue-view.tsx`. The queue
opens **in place** rather than as a second page or a second sheet, so playback stays reachable
while you reorder. `player-page.tsx` holds that as one `view` state and nothing else changes.

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
- `@/lib/musickit-hooks::useSongFavoriteStatus` for the heading/queue heart.
- `@/lib/screen-overlay::useScreenOverlayInsets` for the route gate and every offset.
- `@/components/custom/reorderable-list::ReorderableList` for the up-next list.
- `@/components/custom/options-menu::SongOptionsMenu` for the `...` menu, documented in
  [../../README.md](../../README.md). `player-page.tsx` passes it a `navigate` that dismisses the
  sheet before pushing (`router.back()` then `router.push`), since Add to Playlist / Go to
  Album / Go to Artist are full screen routes and a push from inside a presented sheet would
  land inside its box, and an `onModifyTags` that jumps the pager to the Tags page in place.
- Mounted by `src/app/_layout.tsx`; the sheet body is rendered by `src/app/player.tsx`.

## Gotchas

- Only `MediaPlayerHost` is exported from `index.ts`. Import the mini player through the host.
  `app/player.tsx` is the one caller allowed to import `player-pager.tsx` directly.
- Authenticated routes show the bars by default. Add a route to `PUSHED_DETAIL_SEGMENTS` only if
  it uses the custom pull-down close. Add a new sheet to `SHEET_SEGMENTS` so it hides the overlay
  and receives sheet-local insets.
- The player and the tab bar are mounted side by side at the root, and both are gated by the
  same hook, so wherever one shows the other does. `playerCanDock` follows from that: there is
  always a bar under the player when the player is visible.
- Bottom geometry lives entirely in `@/lib/screen-overlay`. Nothing in this directory should
  hardcode a bar height or an offset.
- The bar's background is a `GlassSurface`, which clips itself. The shadow has to stay on the
  animated container around it, because a clipping view does not cast one on iOS.
- The drag gesture is built by `createDockGesture`, a plain function rather than a hook, so the
  shared values arrive as arguments. Writing a shared value that came out of a hook in the same
  component is what `react-hooks/immutability` rejects.
- Floating, its side gutter is `TAB_BAR_MARGIN`, the same constant the tab bar pill uses, so the
  two bars stay the same width. Docked, it is that plus however many tab slots it leaves alone.
  Both come from the rects in `media-player.tsx`; do not hardcode an inset in `compact.tsx`.
- The artwork size is derived from the sheet body measured by `onLayout`, not the window, because
  the sheet leaves out the status bar and the header. `SHEET_DETENT` (imported from
  `@/lib/theme`, so it cannot drift from `sheetScreenOptions`) and `SHEET_HEADER_HEIGHT` in
  `player-page.tsx` only seed the first frame before that measurement lands. `SHEET_HEADER_HEIGHT`
  still mirrors `DetailScreen` by hand and has to be updated if that header changes.
- Both the scrubber's pan (`player-page.tsx`) and the page swipe (`player-pager.tsx`)
  deliberately claim horizontal drags only (`activeOffsetX` / `failOffsetY`). Widen either and a
  vertical pull stops reaching the native sheet, which breaks drag to dismiss.
- The page swipe never gets an explicit relation to the scrubber's pan - no ref, no
  `requireExternalGestureToFail` across the two components. It relies on the scrubber's tighter
  `activeOffsetX([-4, 4])` (the pager's is `[-10, 10]`) winning the activation race for any drag
  that starts on it, the same threshold-race arbitration `seekGesture` already uses between its
  own pan and tap. Reading a ref during render to wire an explicit relation instead is also just
  not allowed here - `react-hooks/refs` rejects it.
- Repeat is deliberately not on the transport row. It lives on the queue view next to shuffle,
  which is where Apple keeps it and what frees the bottom-right slot for the queue button.
- Both mode pills are glass while they are off and invert to a solid white pill with a dark glyph
  while they are on. Off and on differing only by icon color did not read, since `secondary` and
  `muted` are the same value in the dark palette.
- Tapping a queue row **discards** the rows above it. That is not a shortcut, it is the only
  thing either native player can do; see the queue section of the module README.
- The queue list is `ReorderableList`, which positions rows off a fixed `QUEUE_ROW_HEIGHT`
  rather than measuring them. Change the row's height and that constant has to move with it.
- `CommentsPage`'s composer tracks the keyboard with `useAnimatedKeyboard` and a `translateY`,
  not `KeyboardAvoidingView`. The page sits inside a native form sheet (`DetailScreen`), and the
  sheet's own offset from the screen top throws off `KeyboardAvoidingView`'s padding math, leaving
  the composer under the keyboard.
- The `...` menu, its artist resolution, Go to Artist's library-only disabling, and its own
  gotchas now live with `SongOptionsMenu` - see [../../README.md](../../README.md) rather than
  this file. `TagsPage` lists **all** of the user's tags, not just applied ones (via
  `useSongTagEditor`, `@/components/custom/song-tag-editor`), so it grows unbounded with the tag
  count, and a tag created from its New button is applied to `focusedSong` straight away.

---
Touching files in this directory? Update this README in the same change.
See [../../../../../AGENT_GUIDE.md](../../../../../AGENT_GUIDE.md).
