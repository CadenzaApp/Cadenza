# media-player

The global Apple Music player. The mini player is one instance mounted outside the navigator, so
it survives navigation, and floats as a glass pill above the tab bar pill. Tapping or swiping it
up opens the now playing sheet, which is the `/player` route rather than a modal this directory
owns.

## Files

| file | role |
| --- | --- |
| `index.ts` | Public surface. Exports `MediaPlayerHost` and nothing else. |
| `media-player-host.tsx` | Decides whether to render at all. Nothing else. |
| `media-player.tsx` | The mini player: playback wiring, the drag between floating and docked, the swipe-up gesture, and `router.push("/player")`. |
| `expanded.tsx` | `MediaPlayerExpanded`, the body of the now playing sheet. Rendered by `app/player.tsx`. |
| `compact.tsx` | The collapsed bar, and the animation between its floating and docked rects. Presentational, all props. |
| `playback-details.tsx` | `MediaPlayerTrackHeading` (title, artist, favorite, `...`) and `MediaPlayerProgress` (scrubber and timestamps). |
| `queue-view.tsx` | What replaces the artwork when the queue is open: compact heading, shuffle and repeat pills, the reorderable up-next list. |
| `track-menu.tsx` | The `...` menu. Favorite, Share, Edit Tags, Add to Playlist, Go to Album, Go to Artist. |
| `tag-editor.tsx` | The tag sheet: applied tags, the rest dimmed, and a New button. Opened from the menu. Exports `EditableSongTag`. |
| `transport-controls.tsx` | Shuffle, skip, play, skip, queue. |

## How it works

`MediaPlayerHost` is rendered once in `src/app/_layout.tsx`, as a sibling of `Stack`. It reads
`compactPlayerVisible` from `useScreenOverlayInsets()` and renders `<MediaPlayer />` or nothing.
That is the whole file. Where the bar sits is not its business: `media-player.tsx` reads
`compactPlayerBottom` from the same hook, so the bar and the padding screens leave for it come
from one place and cannot disagree.

That hook works off the *base* route segment rather than `useSegments()[0]`, so a sheet
presented on top of a screen does not move or unmount the bar underneath it.

Playback state is unaffected either way, because it lives in `PlaybackProvider`, not here.

The bar has two resting places. Floating above the tab bar, and docked inside it over the middle
three tab slots, which is where scrolling a page sends it and where a downward drag puts it.
`media-player.tsx` builds both rects out of `useScreenOverlayInsets` and the bar metrics on
`usePlayerDock`, and `compact.tsx` interpolates between them off `dockProgress`. Skip is the
control that gives way while docked; artwork, title, and play stay. See the docking section of
[../../../lib/README.md](../../../lib/README.md) for what drives the progress.

The two halves are split by what they render into. `media-player.tsx` owns the bar and holds
almost no state: playback from `usePlayback()`, an artwork fallback, and the gesture that pushes
`/player`. `expanded.tsx` owns the sheet body and takes no props, deriving everything from the
same hooks: `usePlayback()`, `useUserTags()`, and `useTagsOnSong(activeTrack?.id)`, merged into
`EditableSongTag[]` (every tag, each flagged `applied`) for the tag editor. Toggling a chip calls
`useApplyTag` / `useUnapplyTag`, whose invalidation is scoped to that `song_id`. Favorites go
through `useSongFavoriteStatus`, which updates optimistically. SWR dedupes the shared reads, so
the split costs no extra requests.

The layout follows Apple Music's. Top block, then the scrubber, then the transport. The top
block is artwork or, once the queue button is on, `queue-view.tsx`. The queue opens **in place**
rather than as a second sheet, so playback stays reachable while you reorder. `expanded.tsx`
holds that as one `view` state and nothing else changes.

Queue positions are converted in exactly one place. `queue-view.tsx` works in upcoming-list
positions, because the playing song is its heading rather than a row; `usePlayback()` works in
whole-queue positions, because that is what native takes. `queuePositionOf` in `expanded.tsx` is
the only bridge between them.

Every other file is presentational. They take props and render, and hold no hooks into `@/lib`.
That includes the `...` menu: it does not open its own copy of the favorite or artist state,
because `expanded.tsx` already has both. Keep it that way.

Sheet presentation, the grabber, the drag to dismiss, and the header are **not** in this
directory. They come from `sheetScreenOptions` (`@/lib/theme`) and `SheetScreen`
(`@/components/ui/sheet-screen`), shared with the account sheet.

What is left of the animation is content, not presentation: a horizontal drag inside the sheet
pages between details and the tag editor via `detailsTranslateX` / `detailsPage`. Progress is
interpolated over `PLAYBACK_PROGRESS_INTERPOLATION_MS` (800ms) so the bar moves smoothly between
the 750ms native snapshot polls, and scrubbing overrides it with `scrubPosition` until release.

## Connects to

- `@/lib/playback::usePlayback` for all transport.
- `@/lib/routes/tags::useUserTags` and `@/lib/routes/songs` for the tag editor.
- `@/lib/musickit-hooks::useSongFavoriteStatus` for the heart.
- `@/lib/screen-overlay::useScreenOverlayInsets` for the route gate and every offset.
- `@apple-musickit::MusicKit` directly for a few native calls.
- `@/components/custom/reorderable-list::ReorderableList` for the up-next list.
- `/artist/[id]` and `/add-to-playlist`, pushed from the `...` menu.
- Mounted by `src/app/_layout.tsx`; the sheet body is rendered by `src/app/player.tsx`.

## Gotchas

- Only `MediaPlayerHost` is exported from `index.ts`. Import the mini player through the host.
  `app/player.tsx` is the one caller allowed to import `expanded.tsx` directly.
- A new top-level route will not show the player until its segment is added to
  `PLAYER_STACK_SEGMENTS` in `@/lib/screen-overlay`. A new *sheet* route goes in
  `SHEET_SEGMENTS` in the same file instead, or it will read as a route change and drop the bar.
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
  `expanded.tsx` only seed the first frame before that measurement lands. `SHEET_HEADER_HEIGHT`
  still mirrors `SheetScreen` by hand and has to be updated if that header changes.
- The pager gesture deliberately claims horizontal drags only (`activeOffsetX` / `failOffsetY`).
  Widen it and a vertical pull stops reaching the native sheet, which breaks drag to dismiss.
- Repeat is deliberately not on the transport row. It lives on the queue view next to shuffle,
  which is where Apple keeps it and what frees the bottom-right slot for the queue button.
- Tapping a queue row **discards** the rows above it. That is not a shortcut, it is the only
  thing either native player can do; see the queue section of the module README.
- The artist for the `...` menu is only resolved while the menu is open. Resolving it eagerly
  would cost a catalog lookup on every song that plays.
- Go to Artist is disabled for a library-only song, which has no catalog artist to open.
- The queue list is `ReorderableList`, which positions rows off a fixed `QUEUE_ROW_HEIGHT`
  rather than measuring them. Change the row's height and that constant has to move with it.
- The tag editor lists **all** of the user's tags, not just applied ones, so it grows unbounded
  with the tag count.
- It owns a `Modal` instead of using `ModalPopup`. The popup sizes to its content, and a
  `flex-1` scroll view inside an auto-height parent measures to nothing, so the list has to sit
  in a box with a real `maxHeight`.
- A tag created from the player's New button is applied to the playing song straight away.
  `CreateTagDialog` is controlled and reports the new id; `CreateTagBubble` is the floating
  trigger the tag list uses. Do not reach for the bubble from a menu.

---
Touching files in this directory? Update this README in the same change.
See [../../../../../AGENT_GUIDE.md](../../../../../AGENT_GUIDE.md).
