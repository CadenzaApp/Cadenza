# UI refactor (branch `ui-refactors`)

This branch reworks navigation, the media player, and library/search/account into a new
"liquid glass" visual system. It touches 128 files. If you built something on top of `main`
in parallel, you will hit conflicts, mostly because old tab screens, the old song detail
modal, and old track menu got deleted and replaced with new patterns.

This doc exists so you don't have to reverse-engineer the diff. Read the section for the area
you touched, then use the migration checklist at the bottom.

Each area also has its own README (linked below) that is the source of truth going forward.
This doc is a one-time map of what changed and why; the READMEs are what stays current.

## 1. Liquid glass design system

New primitives in `src/components/ui/`:

- `glass-surface.tsx` - `GlassSurface`. The one place that paints translucency. On iOS 26+ it
  renders real `GlassView` (`expo-glass-effect`), otherwise falls back to `expo-blur`
  `BlurView`, otherwise (web) a plain `bg-card/80`. Props: `variant?: "regular" | "clear"`,
  `tintColor?: ColorValue`, `intensity?: number` (ignored when real glass renders). It only
  paints a background: you own size/radius/`overflow:"hidden"`, and shadows must live on a
  parent (clipping kills iOS shadows).
- `glass-button.tsx` - `GlassButton`. Full-width rectangular action (h-12, rounded-2xl).
  `variant: "default" | "destructive"` only changes text color, not the glass.
- `glass-icon-button.tsx` - `GlassIconButton`. Fixed circular icon button, `size` prop
  (default 40). Used for close buttons, header icons, the account avatar.
- `glass-confirm-dialog.tsx` - `GlassConfirmDialog`. Destructive confirmation dialogs (e.g.
  account sign-out). Use this instead of a bespoke `Alert`/modal.
- `tint-backdrop.tsx` + `src/lib/artwork-color.ts` - `TintBackdrop` + `useArtworkTint`.
  `useArtworkTint(source)` prefers Apple's own `artworkColor`, else averages the artwork image
  color via `ImageColor.getAverageColor` (SWR-cached by URL). `TintBackdrop` renders a
  `LinearGradient` from that tint to a darkened version of itself (never to black), so a
  screen reads as "one color" behind its content. Renders null for a null tint, so you can
  mount it unconditionally.
- `detail-screen.tsx` + `floating-close-button.tsx` - the standard shell for any non-tab
  screen. `DetailScreen({ title, onClose?, headerRight?, tint?, presentation?, children })`.
  `presentation: "screen"` (default) is a pushed transparent-modal route wrapped in
  `ZoomDismissScreen`. `presentation: "sheet"` is a native formSheet (Account, Appearance,
  Player). Both render a header with a `GlassIconButton` close button
  (`useCloseScreen()` by default) and a `TintBackdrop` behind everything. Screens that draw
  their own hero image instead of a title bar (artist, collection) skip `DetailScreen` and use
  `FloatingCloseButton` instead.
- `top-rail.tsx` - `TopRail({ title, actions? })`. Shared header for the four bottom-tab
  screens (title, optional actions, account-avatar button). Mounted as the tab navigator
  header in `(tabs)/_layout.tsx`.
- `src/lib/theme.ts` - `THEME.light/dark` (full token set: background, foreground, card,
  primary, destructive, border, etc), `NAV_THEME` for React Navigation's `useTheme()`, and the
  canonical `Stack.Screen` option builders `sheetScreenOptions(theme)` and
  `pushedScreenOptions()`. Tailwind classes (`bg-background`, etc) are the other consumption
  path for the same tokens; the two can drift, the README flags this.

**What got replaced:** `custom/song-detail-modal.tsx` (405 lines) and
`custom/music-list/music-list-track-menu.tsx` (130 lines) are both deleted. See section 3.

Note: `tailwind.config.js`'s `content` globs were extended to include `src/features/**/*.{ts,tsx}`.
If your branch added Tailwind classes under a source directory outside
`app/`, `components/`, `features/`, `lib/`, they may be silently compiling to nothing.

Read `src/components/README.md` for more detail.

## 2. Navigation and layout restructure

**Tabs.** Old tabs: `home`, `tags`, `query`, `explore`, `account` (native `Tabs` navigator,
per-screen icons). New tabs: `social`, `analytics`, `cadenza`, `library`, `search`.

- `tags.tsx` + `query.tsx` -> merged into `cadenza.tsx` / `features/cadenza`. Tag *browsing* is
  no longer part of this tab; it moved to the library (see section 4). Cadenza is now
  query-builder only.
- `explore.tsx` -> split into `library.tsx` (category index + Recently Added) and `search.tsx`.
- `home.tsx` and the `account` tab are gone. Account is now a root-level sheet route
  (`app/account.tsx`), opened from the `TopRail` avatar button, not a tab.
- `social.tsx` / `analytics.tsx` are new placeholder tabs.

**Tab bar.** `components/custom/tab-bar.tsx` replaces the native tab bar entirely: it's a
custom component mounted as a sibling of the router `Stack` (survives navigation across pushed
screens), with `(tabs)/_layout.tsx` passing `tabBar={() => null}`. `TABS` in that file is now
the single place tab order/membership is declared. Selection tracks `useSegments()` (there's no
navigator state above it). The selected-tab "bubble" is a `GlassSurface` whose position is a
Reanimated shared value eased between tab slots; icon/label colors crossfade based on distance
from the bubble.

**Player docking.** `src/lib/player-dock.tsx` (`PlayerDockProvider`/`usePlayerDock()`) tracks a
0-to-1 `progress` between "floating above the tab bar" and "docked inside it". When docked, the
tab bar moves the selected tab to the leftmost slot and fades the middle tabs out to make room.
This is unrelated to `media-player/mini-tab-bar.tsx`, which is the *player sheet's own*
Comments/Player/Tags segmented control, same glass-bubble technique, different state.

**Zoom-dismiss / screen overlays.** New system behind screens that grow out of the artwork that
opened them (artist, collection, category, tag, library-categories, add-to-playlist), Apple
Music style:

- `src/lib/zoom-dismiss.tsx` - `ZoomOriginProvider` (root), `useZoomSource()` (put `ref` on the
  artwork view, call `capture()` after navigating), `ZoomDismissScreen` (wraps the pushed
  screen body), `useCloseScreen()` (call this from any close button; falls back to
  `router.back()` if there's no zoom controller).
- `src/lib/zoom-dismiss-geometry.ts` - pure worklet math for the transform.
- `src/lib/screen-overlay.ts` - the layout decision layer: `SHEET_SEGMENTS`,
  `PUSHED_DETAIL_SEGMENTS`, `useIsPushedDetailScreen()`, `useScreenOverlayInsets()` (every
  scrolling screen must apply `contentBottomInset`/`listBottomInset` from this, since neither
  bar reserves layout space anymore), `InsideSheetContext`, `useSuppressBottomBars`.
- `components/custom/bottom-bars-overlay.tsx` - `BottomBarsOverlay` renders the tab bar and
  the media player host inside one `FullWindowOverlay` (iOS only) so they stay visible above a
  pushed screen's native transparent modal layer.

Read `src/app/README.md` for the full picture; it's kept current.

## 3. Media player rework

The old near-monolithic player is now split by what mounts where:

- `media-player-host.tsx` - `MediaPlayerHost`. Pure visibility gate off
  `useScreenOverlayInsets().compactPlayerVisible`.
- `media-player.tsx` - the collapsed/mini bar only. Wires `usePlayback()`, the drag-to-dock
  gesture, the swipe-up gesture, and `router.push("/player")`.
- `compact.tsx` - presentational collapsed bar, interpolates between floating/docked rects.
- `player-pager.tsx` - body of the `/player` sheet (rendered by `app/player.tsx`). Owns
  `focusedSong` state and the swipe between three hardcoded pages, keyed by `PlayerPageKey`
  (`"comments" | "player" | "tags"`, from `mini-tab-bar.tsx`). Per the directory's own
  convention, `app/player.tsx` is the only caller allowed to import this file directly.
- `player-page.tsx` - the middle page. The *only* page that touches `usePlayback()`. Renders
  artwork-or-queue, scrubber, transport, and its own `SongOptionsMenu`.
- `queue-view.tsx`, `tags-page.tsx`, `comments-page.tsx` - the other two pages plus the queue
  view. Each takes just `focusedSong` (or nothing), renders `TintBackdrop` from
  `useArtworkTint(focusedSong)` behind a `ScrollView`. `queue-view.tsx` uses the new
  `ReorderableList` (see section 4) for the upcoming-tracks drag list.

**What replaced `song-detail-modal.tsx` and `music-list-track-menu.tsx`:** a new
`components/custom/options-menu/` directory, rendered through `ModalPopup variant="glass"`:

- `song-options-menu.tsx` - `SongOptionsMenu({ track, onClose, navigate?, onModifyTags? })`.
  Favorite/share, Add to Playlist, Play Next, Add to Queue, Go to Album/Artist, and a "Modify
  Tags" footer button. Used both by list rows and by `player-page.tsx` (which overrides
  `navigate`/`onModifyTags` to stay inside the sheet).
- `collection-options-menu.tsx` - `CollectionOptionsMenu({ kind, collectionId, tracks, onClose })`,
  same idea for an album/playlist.
- `favorite-share-row.tsx` - the shared favorite+share row both menus lead with.

`media-player/tag-editor.tsx` moved out to `components/custom/song-tag-editor.tsx`
(`useSongTagEditor(songId)`), now shared between the row menu's "Modify Tags" and
`tags-page.tsx`.

Read `src/components/custom/media-player/README.md`; it's kept current.

## 4. Library, search, account, cadenza

**Library.** New concept: a "library category" - one of `playlist`, `artist`, `album`, `song`,
`tag` (`features/library/categories.ts`). `(tabs)/library.tsx` is now a short index
(`CategoryRow` per enabled category + `RecentlyAddedGrid`), not a flat song list. Which
categories show is user-toggleable via `/library-categories`
(`LibraryCategoriesProvider`/`useLibraryCategories`, persisted to AsyncStorage). Route flow:
`/library` -> `/category/:kind` (branches per category: `MusicList`, `CollectionList`,
`ArtistList`, or `TagsView`) -> `/collection/:kind/:id` or `/artist/:id` or `/tag/:tagId`. Tags
are now a library category, browsed from here, not from the Cadenza tab.

**Search.** `(tabs)/search.tsx` owns unfocused (top rail + tag shelf landing) vs focused
(scope toggle, recents, results) state. Reuses `useCatalogSongSearch`/`useLibrarySongSearch`/
`useCatalogArtistSearch`/`useLibraryArtistSearch` from `musickit-hooks.ts`. `recent-searches.ts`
persists up to 20 entries to AsyncStorage.

**Account.** `features/account/settings-ui.tsx` is the shared settings-primitives file:
`GlassSettingsPanel`, `SettingsIcon`, `TodoBadge`, `SettingsRow`, `GlassToggle`. Both
`account-settings.tsx` and `appearance-settings.tsx` build on these rather than hand-rolled
glass panels.

**Cadenza.** `features/cadenza/CadenzaScreen.tsx` is now query-builder only (tags moved to
library, see above), and owns query-tree/result state on the screen so it survives tab
switches.

**New lib utilities:**
- `music-routes.ts` - `collectionRoute`/`albumRouteForTrack`, builds `/collection/[kind]/[id]`
  hrefs carrying title/artist/artwork params so the destination can paint before its own fetch
  lands.
- `queue-order.ts` - pure index math for keeping the queue UI mirror in sync with native
  reordering.
- `share-track.ts` - `shareTrack`/`shareCollection`, native share sheet off a canonical Apple
  Music share URL.
- `components/custom/reorderable-list.tsx` - generic `ReorderableList<T>`: absolutely
  positioned fixed-height rows, long-press to drag, auto-scroll near edges,
  `onReorder(fromIndex, toIndex)`. Used today by the player queue; reuse this for any future
  drag list instead of a bespoke implementation.

New exports on `musickit-hooks.ts` worth knowing about: `useLibrarySongSearch`,
`useLibraryAlbums`, `useLibraryArtists`, `useCatalogArtistSearch`, `useLibraryArtistSearch`,
`useUserPlaylists`, `useRecentlyAdded`, `useCollectionSongs`, `useCollectionFavoriteStatus`,
`useCollectionInfo`, `useSongArtists`, `useArtist`, `usePlaylistMutations`. Most paged ones
build on a shared internal `usePagedLibraryResult` helper; reuse it instead of hand-rolling
offset paging.

Read `src/features/library/README.md`, `src/features/search/README.md`,
`src/features/account/README.md`, `src/features/cadenza/README.md`.

## Migration checklist

If your branch built on `main` before this landed:

- **A tab screen under `(tabs)/home.tsx`, `explore.tsx`, `tags.tsx`, `query.tsx`, or
  `account.tsx`** - those files are gone. Tag-browsing content goes in `features/library/`
  (reached via `/category/tag`); other "explore" content splits between `library.tsx` and
  `search.tsx`; account content goes in `app/account.tsx` as a sheet. To register a genuinely
  new tab, add a route file and an entry to `TABS` in `components/custom/tab-bar.tsx`.
- **A custom "..." track menu or bottom sheet** - replace with `SongOptionsMenu`
  (`components/custom/options-menu/song-options-menu.tsx`) or `CollectionOptionsMenu`, rendered
  via `ModalPopup variant="glass"`. Don't reinvent a modal.
- **Any import of `custom/song-detail-modal` or `music-list/music-list-track-menu`** - both
  deleted. Replace per the point above.
- **Any import of `media-player/tag-editor.tsx`** - moved to
  `components/custom/song-tag-editor.tsx` (`useSongTagEditor`). If it was a stacked modal over
  the player, tags now live as a swipeable page inside `player-pager.tsx`
  (`goToTagsFor` in-sheet, or push `/player` with `tagsSongId`/`tagsSongTitle`/
  `tagsArtworkUrl`/`tagsArtworkColor` params out-of-sheet).
- **A custom full-screen / detail view (artist, album, category, settings-like screen)** -
  rebuild on `DetailScreen` with the right `presentation` (`"sheet"` for overlay-style,
  `"screen"` for pushed detail views with `pushedScreenOptions()`), instead of a hand-rolled
  header/close button. Add its segment to `SHEET_SEGMENTS` or `PUSHED_DETAIL_SEGMENTS` in
  `src/lib/screen-overlay.ts` as appropriate. Source rows that open it should use
  `useZoomSource()`/`capture()` if it should zoom-transition from an artwork tap.
- **Any bespoke button/icon-button with manual `BlurView`/opacity styling** - use `GlassButton`
  or `GlassIconButton`. Any custom translucent card - build it on `GlassSurface`.
  Never hand-roll blur/glass logic outside `components/ui/glass-surface.tsx`.
- **A new scrolling screen** - call `useScreenOverlayInsets()` and apply
  `contentBottomInset`/`listBottomInset`; neither the tab bar nor the player reserve layout
  space anymore.
- **A new drag-to-reorder list** - use `components/custom/reorderable-list.tsx::ReorderableList`
  instead of a bespoke implementation.
- **New Tailwind classes in a source directory other than `app/`, `components/`, `features/`,
  `lib/`** - add it to `tailwind.config.js`'s `content` globs or the classes compile to
  nothing.
- **Any feature directory you touch** - update its README in the same change, per
  `AGENT_GUIDE.md`. All the feature READMEs referenced above are kept current; trust them over
  this document once you've merged.
