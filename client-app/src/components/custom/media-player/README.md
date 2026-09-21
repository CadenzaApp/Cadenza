# media-player

The global Apple Music player. On iOS 26 its compact form is the native tab controller's bottom
accessory; UIKit moves it inline when native scrolling minimizes the tab bar. Older iOS, Android,
and web use a floating fallback. Tapping it opens the `/player` sheet; swiping it horizontally
pauses playback and dismisses the compact player. Comments, Player, and Tags are three
always-mounted pages in one horizontal pager at the bottom of that sheet.

## Files

| file                     | role                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`               | Public exports for the native accessory and compatibility overlay.                                                                                   |
| `media-player-host.tsx`  | Adapts native accessory placement, decides whether an accessory is declared at all, and positions the fallback.                                      |
| `media-player.tsx`       | Playback wiring shared by both native placements and the fallback.                                                                                   |
| `player-pager.tsx`       | Always-mounted horizontal pager plus its glass Comments / Player / Tags selector.                                                                    |
| `player-tabs.tsx`        | Selected-page context shared by the pager and Modify Tags actions.                                                                                   |
| `player-chrome.tsx`      | Context carrying how much room the pager's selector takes below the pages, for keyboard avoidance.                                                   |
| `player-scope.tsx`       | Resolves and shares the focused song across the sheet's three pages, and selects Tags for Modify Tags.                                               |
| `player-page.tsx`        | The Player route: artwork or the queue, the scrubber, and the transport. The only route that touches playback.                                       |
| `comments-page.tsx`      | The Comments route: every user's comments on `focusedSong`, highest score first. Posts, replies, votes, and deletes through `@/lib/routes/comments`. |
| `tags-page.tsx`          | The Tags route: every user tag for `focusedSong`, applied first, plus default tags a tap adopts and a long press removes.                            |
| `compact.tsx`            | Regular and inline compact content. Adds glass only for the compatibility fallback.                                                                  |
| `playback-details.tsx`   | `MediaPlayerTrackHeading` (title, artist, favorite, `...`) and `MediaPlayerProgress` (scrubber and timestamps).                                      |
| `queue-view.tsx`         | What replaces the artwork when the queue is open: compact heading, shuffle/repeat pills, and the reorderable next list.                              |
| `transport-controls.tsx` | Shuffle, skip, play, skip, queue.                                                                                                                    |

The `...` menu and its tag editor are **not** in this directory any more. They moved to
`@/components/custom/options-menu::SongOptionsMenu` and `@/components/custom/song-tag-editor`,
since the list-row song menu needed the same Favorite/Share/Add to Playlist/Go to Album/Go to
Artist/Modify Tags shape this sheet already had. `player-page.tsx` renders `SongOptionsMenu` with
a `navigate` that dismisses the sheet before pushing, and an `onModifyTags` that selects the
already-mounted Tags page in place instead of opening another sheet (see Connects to).

## How it works

`src/app/(tabs)/_layout.tsx` declares `NativeTabs.BottomAccessory`. UIKit supplies its position,
transition, and Liquid Glass. `MediaPlayerAccessory` reads `usePlacement()` and renders regular
or inline content. The native host owns its height, so `compact.tsx` fills the measured frame.

Whether the accessory is declared at all comes from `useMediaPlayerAccessoryDeclared`. UIKit keeps
the accessory's slot in the minimized tab bar reserved for as long as one is declared, so a
dismissed player would leave that slot empty between the tab buttons once a scroll minimizes the
bar. The declaration outlives the dismissal by UIKit's own hide animation, since dropping it on
the same commit as `bottomAccessoryHidden` tears the accessory out before that animation can play.

The same flag drives `minimizeBehavior`. Minimizing is worth it only when there is a player to
minimize around; with no accessory the shrunk bar is the selected tab and Search with a hole
between them, so the bar stays at full size instead (`"never"`).

UIKit exposes no public command for forcing accessory placement. The app therefore relies on
`minimizeBehavior="onScrollDown"` and native scrolling, with no direct vertical docking gesture or
private UIKit selector. A horizontal pan is still owned by the React content in either native
placement: crossing a quarter of the screen or flicking past the velocity threshold pauses native
playback and sets `bottomAccessoryHidden`, letting UIKit animate the complete glass accessory away.
UIKit does not expose an interactive transform for its accessory wrapper, so the native shell does
not track the finger before release. Starting another song or resuming from a system transport
restores it. The app-owned floating compatibility player tracks the finger and animates fully
offscreen before it is hidden.

### The now playing sheet's three pages

`app/player/_layout.tsx` presents the sheet and its route slot. Each of the three entry routes
renders the same `PlayerPager`, which mounts Comments, Player, and Tags side by side inside one
horizontal paging `ScrollView`. Route choice decides only which page is selected initially.
Swipes expose the adjacent live page under the finger, and the glass selector's highlight follows
the scroll position continuously. Each selected tab uses its filled icon variant; inactive tabs
use outlines. The three page instances stay mounted for the sheet's lifetime.

`PlayerChromeProvider` wraps the three pages with the measured height of the pager's own selector,
which is what a page needs to lift content clear of the keyboard. The pager is the only thing that
knows that number, so it reports it rather than letting each page guess.

`PlayerScopeProvider` resolves a `focusedSong` (id, title, artwork) from `usePlayback()`'s
`activeTrack` or the route's `tagsSongId` / `tagsSongTitle` / `tagsArtworkUrl` /
`tagsArtworkColor` params and shares it across the three routes. Modify Tags on a song that is not
playing pushes `/player/tags` with those params. Modify Tags from the Player page updates the
scope and selects the already-mounted Tags page without changing routes.

`CommentsPage` also takes `active`, whether the pager is on it, so it knows when to hold its
comment order. The pager derives that from the selected tab, which settles on momentum scroll end.

Only `PlayerPage` touches playback. `CommentsPage` and `TagsPage` take only `focusedSong` and never
read `usePlayback()`. `DetailScreen` paints the tint once behind the header and the transparent
pager, so there is no second gradient boundary below the title. The pager is the gesture surface;
it does not navigate during a swipe or wait for a destination route to mount.

The primary native bar and compact player remain mounted underneath a sheet. The sheet itself
covers them, which lets both appear on the first frame of dismissal instead of waiting for the
route transition to finish. Focused Search still suppresses them explicitly, and so does a raised
keyboard, which `BottomBarVisibilityProvider` watches for every screen at once.

Pushed detail screens sit above the native tab controller, so the controller's accessory cannot be
raised over them. One app-level `MediaPlayerPushedScreenOverlay`, mounted above the root stack,
renders the same regular compact content over **every** pushed route whenever playback has an
active track and the bars are not suppressed. Its route predicate
(`useShowsPushedPlayerOverlay`) is also the source of truth for descendant insets.

The native tab bar itself does **not** survive a pushed screen, and no overlay restores it.
`pushedScreenOptions` presents those routes as a root-level `transparentModal` so `zoom-dismiss`
has the previous screen to grow out of, and the detail card then paints over the whole screen,
tab bar included. Giving the bar back means either reimplementing it as a JS overlay or moving
these routes into the per-tab stacks and giving up the zoom transition.

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
- `@/lib/routes/comments` for the Comments page, and `@/lib/account::useAccount` for the email it
  signs the user's own comments with.
- `@/lib/screen-overlay` for the shared visibility rules and fallback clearance.
- `@/components/custom/reorderable-list::ReorderableList` for the up-next list.
- `@/components/custom/options-menu::SongOptionsMenu` for the `...` menu, documented in
  [../../README.md](../../README.md). `player-page.tsx` passes it a `navigate` that dismisses the
  sheet before pushing (`router.back()` then `router.push`), since Add to Playlist / Go to
  Album / Go to Artist are full screen routes and a push from inside a presented sheet would
  land inside its box, and an `onModifyTags` that selects the mounted Tags page in place.
- Mounted by `src/app/(tabs)/_layout.tsx`; the sheet navigator is declared by
  `src/app/player/_layout.tsx`.

## Gotchas

- Keep `app/player/` outside `(tabs)`. It is a root sheet over the primary tabs, and its pager is
  deliberately a plain horizontal scroll surface rather than another navigator.
- State shared by the native regular and inline accessory instances must stay above the accessory.
- Dismissal state lives in `PlaybackProvider`, not in an accessory instance. UIKit can replace the
  regular content with inline content during a scroll, and every native/fallback host must agree
  that the player is hidden.
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
- `CommentsPage`'s composer tracks the keyboard with `useAnimatedKeyboard` and a `translateY`,
  not `KeyboardAvoidingView`. The page sits inside a native form sheet (`DetailScreen`), and the
  sheet's own offset from the screen top throws off `KeyboardAvoidingView`'s padding math, leaving
  the composer under the keyboard. It lands the input's bottom edge one `COMPOSER_GAP` above the
  keyboard's top, subtracting the space that is already under the page: the keyboard covers the
  pager's selector before it covers anything on the page, so translating by the raw keyboard
  height double counts it and throws the composer far above the keyboard.
- That space comes from `usePlayerChrome`, which the pager fills in from an `onLayout` on its own
  selector. Do **not** reach for `measureInWindow` or `Dimensions` to rederive it. The origin
  those report from inside a presented form sheet is not the one `useAnimatedKeyboard` measures
  its height against, and mixing the two gives a composer that is wildly too high, too low, or
  never moves at all depending on which way the spaces disagree. `onLayout` keeps the whole
  calculation in one space, and the sheet reaches the bottom of the screen, so the selector's
  height is the entire gap.
- The pager's selector gives its `GlassSurface` an explicit radius instead of leaning on the
  parent's `overflow: hidden`. Native glass shapes its lensing and specular edge from its own
  corners, so a clipped square reads as a flat fill. The glass also stays off the touch path
  behind a `pointerEvents="none"` wrapper; the native view ignores `pointerEvents` itself and
  swallows the tab presses.- Comment authors are placeholders. The backend sends `mine` and no author, so `CommentsPage` signs
  the user's own comments with their email and everyone else's with `Anonymous`.
- Only top level comments get vote buttons and a Reply button, since replies go one level deep.
  The backend takes votes on replies too; the page just does not offer them.
- The backend sends comments newest first, and that is the order the SWR cache keeps. `CommentsPage`
  reorders them as it renders, through `@/lib/comment-votes`: highest score first, newest first
  among equal scores. Replies stay oldest first. While the page is `active` it holds the order it
  sorted when it came into view, so a vote changes a score without moving the comment. Comments
  posted since go on top, and deleted ones drop out. It sorts again when it comes back into view or
  the song changes. Out of view it sorts live, so a changed order settles while the page slides
  away rather than while it slides in.
- The `...` menu, its artist resolution, Go to Artist's library-only disabling, and its own
  gotchas now live with `SongOptionsMenu` - see [../../README.md](../../README.md) rather than
  this file. `TagsPage` lists **all** of the user's tags, not just applied ones (via
  `useSongTagEditor`, `@/components/custom/song-tag-editor`), so it grows unbounded with the tag
  count, and a tag created from its New button is applied to `focusedSong` straight away. The
  Default tags section works the same way in reverse: tapping one of the song's shared defaults
  copies it into the user's tags (or reuses their tag of that name) and applies it, so the pill
  moves up to On this song.
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
