# components

Two directories with different rules.

- `ui/` - generic primitives, shadcn-style, generated or adapted. Styled with nativewind and
  built on `@rn-primitives/*`. No app concepts. A `Button` here does not know what a tag is.
- `custom/` - Cadenza components. They know about tags, songs, and playback, and they call hooks
  from `@/lib`.

New code goes in `custom/` unless it is a genuinely generic primitive. If you find yourself
importing `@/lib/routes/*` into a file under `ui/`, it belongs in `custom/`.

## Files

### ui/

`badge`, `button`, `card`, `dialog`, `glass-surface`, `glass-button`, `glass-confirm-dialog`,
`glass-icon-button`, `icon`, `input`,
`label`, `separator`, `skeleton`, `tabs`, `text`, `native-only-animated-view`, `detail-screen`,
`tint-backdrop`, `floating-close-button`, plus `sign-in-form` and `sign-up-form`.

`floating-close-button.tsx` exports `FloatingCloseButton`, the X a screen that draws its own hero
floats in the top right. It closes through `@/lib/zoom-dismiss::useCloseScreen`, so it plays the
same minimize the pull does. It has to be a component rather than a call in the screen, because
the controller lives in the `ZoomDismissScreen` that screen renders.

`glass-surface.tsx` exports `GlassSurface`, the translucent background layer behind both
floating bottom bars. It renders liquid glass on iOS 26, an `expo-blur` `BlurView` on anything
older, and a flat translucent card on web, all behind one component. It paints a background and
nothing else; the caller supplies size, radius, and `overflow: "hidden"`. Its optional
`tintColor` reaches native liquid glass and gets a translucent approximation on fallbacks.

`glass-button.tsx` and `glass-confirm-dialog.tsx` provide regular and destructive glass actions,
plus the accessible confirmation used by both Account sign-out flows.

`glass-icon-button.tsx` exports `GlassIconButton`, a round icon button built on it. The account
button and the library type button in the top rail are the callers. Reach for it rather than
hand-rolling another circle of glass.

`tint-backdrop.tsx` exports `TintBackdrop`, the artwork-colored wash behind a page: the color at
the top, darkening down it and bottoming out at a fraction of its own brightness rather than at
black. Pass `height` to run it over content taller than the screen, from inside that content, so
it scrolls with what it is painted behind. It takes the tint `@/lib/artwork-color` hands
back and renders nothing for a null one, so callers mount it unconditionally. `DetailScreen` takes
the same color as a `tint` prop and draws one itself.

`reorderable-list.tsx` is in `custom/` rather than `ui/` only because nothing else needs it yet.
It knows nothing about songs: `data`, `itemHeight`, `renderItem`, and an `onReorder(from, to)`.
Rows are absolutely positioned off `itemHeight` instead of measured, so dragging moves a
transform and never triggers layout, and it scrolls itself near either edge. The drag starts on
a long press, which leaves short drags to the scroll view. Do **not** reuse the query builder's
drag code for a list: it caches drop-zone rects once at drag start, so it breaks under scroll.

`detail-screen.tsx` exports `DetailScreen`, the header and safe-area shell for most routes that
are not a tab. A pushed one wraps its body in `ZoomDismissScreen`, so it minimizes on the way out;
a sheet does not, since it already has a native dismiss. `/artist/:id` and `/collection/:kind/:id` opt out: both draw a hero of their own
and float their own X. It draws the title, an optional
`headerRight`, and the X, then renders its children in a clipped flex body below them. One
`presentation` prop (`"screen"` by default, `"sheet"` for `/account`, `/appearance`, and
`/player`) decides the top inset and whether the body counts the bottom bars. The caller keeps
its own scrolling and bottom inset, and owes the body a definite
height (`flex-1` on the scrolling child), because a content-sized list in a sheet grows past
its box while the sheet animates. The header paints and hit-tests above the body, so a body
that gets this wrong can no longer cover the close button. It also wraps the body in `InsideSheetContext`, so
overlay insets inside it stop counting the tab bar and the compact player. Every sheet route
uses it, which is what keeps them identical. An optional `tint` washes the whole sheet in an
artwork color through `TintBackdrop`; the now playing and album sheets pass one.

Config lives in `client-app/components.json` (shadcn "new-york", base color neutral, css
variables), `tailwind.config.js`, and `global.css`. Class merging goes through
`@/lib/utils::cn`. Variants use `class-variance-authority`.

### custom/

| file | role |
| --- | --- |
| `music-list/` | Scrollable list of `MusicItem`s, with skeletons, paging, and sorting. See below. |
| `floating-bubble.tsx` | The round floating action button the list and tag screens sit under. |
| `song-detail-modal.tsx` | Full song sheet: artwork, tags, favorite, play. |
| `tag-pill.tsx` | A tag chip, colored from `tag.color`. Also exports `readableTextColor`. |
| `create-tag-dialog.tsx` | `CreateTagDialog` (controlled name + color picker, calls `useCreateTag`) and `CreateTagBubble` (floating trigger + dialog). |
| `modal-popup.tsx` | Small anchored popup used by the track menu and the selection actions. |
| `tab-bar.tsx` | The whole floating tab bar: `TABS`, `TabBarHost`, `TabSelectionProvider`, the selection bubble, and the items that move aside for the docked player. The bubble mounts after the bar is measured so native glass starts at its real size. Mounted at the root, not in the navigator. |
| `top-rail.tsx` | Shared tab header: page title on the left, an optional `actions` slot and the account initials on the right. |
| `account-initials.ts` | Pure email-to-initials helper, tested in `account-initials.test.ts`. |
| `coming-soon-screen.tsx` | Data-driven preview surface used by stubbed product areas. |
| `collection-list.tsx` | Paged list of albums or playlists. Tapping a row opens it. Owns its screen's scroll through `useScreenScroll`, and each row's artwork is a zoom origin. |
| `artist-list.tsx` | `ArtistList` (paged rows, owns the screen scroll) and `ArtistRail` (a sideways strip of tiles). Both record a zoom origin. |
| `reorderable-list.tsx` | Generic drag-to-reorder list. Fixed row height, hands back two indices on drop. |
| `media-player/` | The mini player and the now playing sheet body. See [custom/media-player/README.md](custom/media-player/README.md). |

### custom/music-list/

| file | role |
| --- | --- |
| `index.tsx` | The `MusicList` itself. Owns sort state, paging, selection, density, and the modals. |
| `music-list-item.tsx` | One row, plus `MusicListItemSkeleton`. |
| `music-list-sort-button.tsx` | The floating sort control. |
| `music-list-action-button.tsx` | One button in the selection toolbar. |
| `music-list-selection-toolbar.tsx` | The bar that slides up while rows are selected. |
| `music-list-track-menu.tsx` | The per-row overflow menu. |
| `use-music-list-selection.ts` | Selection state, haptics, and pruning. Tested in `use-music-list-selection.test.ts`. |
| `selection-utils.ts` | `reduceMusicListSelection`, the pure reducer behind the hook. |
| `sort-tracks.ts` | `sortTracks` / `nextSort`. Pure, unit tested in `sort-tracks.test.ts`. |
| `types.ts` | `MusicListProps` and the sort types, so callers do not import from `index.tsx`. |

Sorting is either `"local"` (this folder sorts the array it was handed) or `"remote"` (the
caller refetches sorted and only wants the control rendered). The library screen uses
`"remote"` on iOS, because `MusicLibraryRequest` sorts across the whole library rather than
just the page that happens to be loaded.

Paging is opt-in. Pass `pagination` to get `onEndReached` plus footer skeletons, or `null` for a
list that is fully loaded up front, like a tag's songs or a query's results.

Multi-select is opt-in too, via `multiSelect`. Selection is scoped to what is currently
displayed: if paging or a filter drops a row, its id is pruned. A long press starts a selection,
a tap toggles one, and clearing everything leaves selection mode. Pinching the list toggles
compact rows; pass `compact` and `onCompactChange` to control that from outside.

`collection-list.tsx` is deliberately not `MusicList`. Sorting, multi-select, tagging, and the
track menu all describe songs; none of them mean anything for an album, so the collection list
is its own small component rather than `MusicList` with five features switched off. It does
reuse `MusicListItemSkeleton` for its loading rows.

`artist-list.tsx` is the same idea for artists, which are `ArtistItem`s and not `MusicItem`s at
all. It draws round artwork, since that is how every music app draws a person, and exports
`canOpenArtist`: `/artist/[id]` reads the catalog, so an artist without a `catalogId` renders
inert instead of opening an empty screen. `ArtistRail` is the horizontal form, for a section
sitting above a list that owns the scroll.

`MusicList` hides its scroll indicator. Overscrolling at the top is how a detail screen closes,
and an indicator flicking in over the shrinking card is noise.

`MusicList` takes a `header` for exactly that case, and a `footer` for the other end. It also
reports its content size through `onContentSizeChange`, which is how the artist screen sizes a
backdrop to its own content rather than to the screen. It owns its
own `FlatList`, so anything above the first row or below the last has to go inside it rather than
beside it. The search tab's Artists section is the header's current user; `RecentlyAddedGrid`
takes a `header` for the same reason. The artist screen uses both at once: the artist image as
the header, the albums rail as the footer. The footer sits below the pagination skeleton, so a
paging list keeps loading into it.

## Connects to

- `@/lib/utils::cn` for class merging, everywhere.
- `@/lib/routes/*` and `@/lib/playback` from `custom/` only.
- `@apple-musickit` for the `MusicItem` type.
- `@rn-primitives/portal`'s `PortalHost`, mounted in `src/app/_layout.tsx`, is what dialogs and
  modals render into.

## Gotchas

- `sign-in-form.tsx` and `sign-up-form.tsx` sit in `ui/` but call `useAccount()`, so they break
  the rule above. Do not use them as the pattern for new work.
- Styling is mixed. Newer files use nativewind `className`, some older ones use `StyleSheet`.
  Use `className` for anything new.
- Anything portal-based (dialogs) needs `PortalHost` mounted, which happens in the root layout.
  It will render nothing if you host a screen outside that tree.
- Both floating bottom bars sit over the content rather than in it. Any new scrolling surface
  owes itself the padding from `@/lib/screen-overlay::useScreenOverlayInsets`.
- Theme colors come from the nav theme (`@/lib/theme::NAV_THEME`) in some places and tailwind
  tokens (`bg-background`, `text-foreground`) in others. They are configured separately and can
  drift.
- Never put a `className` and a `style={({ pressed }) => ...}` function on the same `Pressable`.
  Nativewind folds the class into `style`, `Pressable` then sees an array rather than a
  function, and it stops tracking the pressed state, so the feedback silently dies. Use
  `active:opacity-*` instead. Same rule for the width and height of a sized pressable: put them
  on a wrapper view, not next to a class.
- `tailwind.config.js` only scans `src/app`, `src/components`, `src/features`, and `src/lib`.
  A class used nowhere but an unscanned file compiles to nothing and renders as no style at
  all. It still typechecks and still lints.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
