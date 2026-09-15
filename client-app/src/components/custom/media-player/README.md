# media-player

The global Apple Music player. On iOS 26 its compact form is the native tab controller's bottom
accessory; UIKit moves it inline when native scrolling minimizes the tab bar. Older iOS, Android,
and web use a floating fallback. Tapping it opens the `/player` sheet. Comments, Player, and Tags
are three routes in a separate native tab navigator at the bottom of that sheet.

## Files

| file                     | role                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `index.ts`               | Public exports for the native accessory and compatibility overlay.                                                      |
| `media-player-host.tsx`  | Adapts native accessory placement and positions the non-iOS-26 fallback.                                                |
| `media-player.tsx`       | Playback wiring shared by both native placements and the fallback.                                                      |
| `player-tab-swipe.tsx`   | Horizontal page gesture that selects the adjacent native player tab.                                                    |
| `player-scope.tsx`       | Resolves and shares the focused song across the sheet's three native tab routes, and selects Tags for Modify Tags.      |
| `player-page.tsx`        | The Player route: artwork or the queue, the scrubber, and the transport. The only route that touches playback.          |
| `comments-page.tsx`      | The Comments route: a stub social feed for `focusedSong`. Local state only, no backend, no seed data.                   |
| `tags-page.tsx`          | The Tags route: every user tag for `focusedSong`, applied first. Replaces the old stacked-modal tag editor.             |
| `compact.tsx`            | Regular and inline compact content. Adds glass only for the compatibility fallback.                                    |
| `playback-details.tsx`   | `MediaPlayerTrackHeading` (title, artist, favorite, `...`) and `MediaPlayerProgress` (scrubber and timestamps).         |
| `queue-view.tsx`         | What replaces the artwork when the queue is open: compact heading, shuffle/repeat pills, and the reorderable next list. |
| `transport-controls.tsx` | Shuffle, skip, play, skip, queue.                                                                                       |

The `...` menu and its tag editor are **not** in this directory any more. They moved to
`@/components/custom/options-menu::SongOptionsMenu` and `@/components/custom/song-tag-editor`,
since the list-row song menu needed the same Favorite/Share/Add to Playlist/Go to Album/Go to
Artist/Modify Tags shape this sheet already had. `player-page.tsx` renders `SongOptionsMenu` with
a `navigate` that dismisses the sheet before pushing, and an `onModifyTags` that selects the
native Tags route in place instead of opening another sheet (see Connects to).

## How it works

`src/app/(tabs)/_layout.tsx` declares `NativeTabs.BottomAccessory`. UIKit supplies its position,
transition, and Liquid Glass. `MediaPlayerAccessory` reads `usePlacement()` and renders regular
or inline content. The native host owns its height, so `compact.tsx` fills the measured frame.

UIKit exposes no public command for forcing accessory placement. The app therefore relies on
`minimizeBehavior="onScrollDown"` and native scrolling, with no direct vertical player gesture or
private UIKit selector. The floating compatibility player remains fixed above the tab bar.

### The now playing sheet's three pages

`app/player/_layout.tsx` presents a second `NativeTabs` navigator inside the player sheet. It is a
root-stack sibling of the primary `(tabs)` navigator, not a native navigator nested inside it.
The system draws its Comments / Player / Tags bar and owns the selection behavior and material.
`minimizeBehavior="never"` keeps this local control stable while the sheet is open.

`PlayerScopeProvider` resolves a `focusedSong` (id, title, artwork) from `usePlayback()`'s
`activeTrack` or the route's `tagsSongId` / `tagsSongTitle` / `tagsArtworkUrl` /
`tagsArtworkColor` params and shares it across the three routes. Modify Tags on a song that is not
playing pushes `/player/tags` with those params. Modify Tags from the Player route updates the
scope and selects `/player/tags` in the existing sheet.

Only `PlayerPage` touches playback. `CommentsPage` and `TagsPage` take only `focusedSong` and never
read `usePlayback()`. `PlayerTabSwipe` recognizes an intentional left or right pan and asks the
native navigator to select the adjacent route. The scrubber claims horizontal movement at 4
points, before the page gesture's 12-point threshold, so seeking wins for a drag that starts on
the scrubber.

The primary native bar and compact player remain mounted underneath a sheet. The sheet itself
covers them, which lets both appear on the first frame of dismissal instead of waiting for the
route transition to finish. Focused Search still suppresses them explicitly.

Playback state is unaffected either way, because it lives in `PlaybackProvider`, not here.

The two halves are split by what they render into. `media-player.tsx` owns playback commands and
the tap that pushes `/player`. `player-scope.tsx` owns the song shared by the sheet routes.
`player-page.tsx` takes only `onModifyTags` as a prop and derives everything else from
`usePlayback()`. Favorites for the heading/queue heart go through
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
- `@/lib/screen-overlay` for the shared visibility rules and fallback clearance.
- `@/components/custom/reorderable-list::ReorderableList` for the up-next list.
- `@/components/custom/options-menu::SongOptionsMenu` for the `...` menu, documented in
  [../../README.md](../../README.md). `player-page.tsx` passes it a `navigate` that dismisses the
  sheet before pushing (`router.back()` then `router.push`), since Add to Playlist / Go to
  Album / Go to Artist are full screen routes and a push from inside a presented sheet would
  land inside its box, and an `onModifyTags` that selects the native Tags route in place.
- Mounted by `src/app/(tabs)/_layout.tsx`; the sheet navigator is declared by
  `src/app/player/_layout.tsx`.

## Gotchas

- Keep `app/player/` outside `(tabs)`. Expo Router does not support nesting one native tab
  navigator inside another; the root Stack presentation makes the player navigator a sibling.
- State shared by the native regular and inline accessory instances must stay above the accessory.
- Do not add `GlassSurface` to the native accessory. UIKit owns its material. Only the fallback
  paints its own glass.
- A sheet belongs in `SHEET_SEGMENTS` so base-route and sheet-local inset calculations keep using
  the screen beneath it. Sheets do not explicitly hide the primary bars; their native surface
  covers bars that remain mounted underneath.
- The artwork size is derived from the sheet body measured by `onLayout`, not the window, because
  the sheet leaves out the status bar and the header. `SHEET_DETENT` (imported from
  `@/lib/theme`, so it cannot drift from `sheetScreenOptions`) and `SHEET_HEADER_HEIGHT` in
  `player-page.tsx` only seed the first frame before that measurement lands. `SHEET_HEADER_HEIGHT`
  still mirrors `DetailScreen` by hand and has to be updated if that header changes.
- The scrubber's pan deliberately claims horizontal drags at 4 points. `PlayerTabSwipe` waits for
  12, so the scrubber wins the nested gesture race. Keep both gestures vertical-failing so a
  downward sheet dismissal can still reach the native sheet.
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
