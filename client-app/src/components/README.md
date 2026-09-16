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
`glass-icon-button`, `input`,
`label`, `separator`, `skeleton`, `tabs`, `text`, `native-only-animated-view`, `detail-screen`,
`tint-backdrop`, `floating-close-button`, plus `sign-in-form` and `sign-up-form`.

`floating-close-button.tsx` exports `FloatingCloseButton`, the X a screen that draws its own hero
floats in the top right. It closes through `@/lib/zoom-dismiss::useCloseScreen`, so it plays the
same minimize the pull does. It has to be a component rather than a call in the screen, because
the controller lives in the `ZoomDismissScreen` that screen renders.

`glass-surface.tsx` exports `GlassSurface`, the translucent background layer behind app-owned
glass controls and compatibility surfaces. It renders liquid glass on iOS 26, an `expo-blur` `BlurView` on anything
older, and a flat translucent card on web, all behind one component. It paints a background and
nothing else; the caller supplies size, radius, and `overflow: "hidden"`. Its optional
`tintColor` reaches native liquid glass and gets a translucent approximation on fallbacks.

`glass-button.tsx` and `glass-confirm-dialog.tsx` provide regular and destructive glass actions.
Destructive actions keep neutral glass and use red foreground content. The confirmation is used
by both Account sign-out flows.

`dialog.tsx` paints form dialogs on `GlassSurface` by default. Its card-color tint and translucent
underfill keep the material legible inside iOS's full-window portal, where an untinted native glass
view can otherwise render effectively clear. Keep form structure, focus handling, and portal
behavior in this primitive rather than rebuilding a glass modal at each call site.

`glass-icon-button.tsx` exports `GlassIconButton`, a round icon button built on it. Header actions,
detail-screen controls, and every floating circular action use it. Reach for it rather than
hand-rolling another circle of glass.

`tint-backdrop.tsx` exports `TintBackdrop`, the artwork-colored wash behind a page. It uses
`expo-linear-gradient` to run the source color at the top continuously into a darker fraction of
that same color at the bottom, rather than into black. Pass `height` to run it over content taller
than the screen, from inside that content, so it scrolls with what it is painted behind. It takes
the tint `@/lib/artwork-color` hands back and renders nothing for a null one, so callers mount it
unconditionally. `DetailScreen` takes the same color as a `tint` prop and draws one itself.

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

There is no `icon` primitive. Icons come straight from `@expo/vector-icons/Ionicons`.

Config lives in `client-app/components.json` (shadcn "new-york", base color neutral, css
variables), `tailwind.config.js`, and `global.css`. Class merging goes through
`@/lib/utils::cn`. Variants use `class-variance-authority`.

### custom/

| file                        | role                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `music-list/`               | Scrollable list of `MusicItem`s, with skeletons, paging, sorting, selection, and applied tag values. See below.   |
| `floating-bubble.tsx`       | The liquid-glass round floating action button the list and tag screens sit under.                                 |
| `options-menu/`             | The song, album, and playlist "..." menus, on liquid glass. See below.                                            |
| `song-tag-editor.tsx`       | Tag editing for one song: applied state, values, mutations, and create-dialog state.                              |
| `tag-pill.tsx`              | The solid app tag chip. Attribute tags keep their type icon through query negation and can show formatted values. |
| `create-tag-dialog.tsx`     | Creates a tag with its name, color, and optional attribute type.                                                  |
| `tag-value-dialog.tsx`      | Liquid-glass per-type editor opened when an attribute tag is applied or edited.                                   |
| `modal-popup.tsx`           | Small popup used by options, sorting, and selection actions. Liquid glass is the default.                         |
| `tab-stack.tsx`             | The native stack each bottom tab nests for the shared `TopRail` header.                                           |
| `top-rail.tsx`              | Shared tab header with optional glass back button, page title, actions, and account initials.                     |
| `account-initials.ts`       | Pure email-to-initials helper, tested in `account-initials.test.ts`.                                              |
| `coming-soon-screen.tsx`    | Data-driven preview surface used by stubbed product areas.                                                        |
| `collection-list.tsx`       | Paged album or playlist rows. Owns screen scrolling and records artwork zoom origins.                             |
| `artist-list.tsx`           | Paged artist rows and the sideways artist rail. Both record a zoom origin.                                        |
| `track-collection-view.tsx` | Shared artwork, actions, metadata, and track-list surface for query results, collections, and artist top songs.   |
| `reorderable-list.tsx`      | Generic fixed-row-height drag-to-reorder list.                                                                    |
| `media-player/`             | The mini player and now-playing sheet body. See [custom/media-player/README.md](custom/media-player/README.md).   |

### custom/music-list/

| file                               | role                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `index.tsx`                        | The `MusicList` itself. Owns sort state, paging, selection, density, and the modals.                                                  |
| `music-list-item.tsx`              | One row, plus `MusicListItemSkeleton`.                                                                                                |
| `tag-fade-rail.tsx`                | Overflow-aware horizontal tag rail whose alpha mask preserves the surface behind it. Takes `AppliedTag[]` and shows each tag's value. |
| `music-list-sort-button.tsx`       | The floating sort control.                                                                                                            |
| `music-list-action-button.tsx`     | One button in the selection toolbar.                                                                                                  |
| `music-list-selection-toolbar.tsx` | The bar that slides up while rows are selected.                                                                                       |
| `use-music-list-selection.ts`      | Selection state, haptics, and pruning. Tested in `use-music-list-selection.test.ts`.                                                  |
| `selection-utils.ts`               | `reduceMusicListSelection`, the pure reducer behind the hook.                                                                         |
| `sort-tracks.ts`                   | `sortTracks` / `nextSort`. Pure, unit tested in `sort-tracks.test.ts`.                                                                |
| `types.ts`                         | `MusicListProps` and the sort types, so callers do not import from `index.tsx`.                                                       |

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

Rows use the query-revamp spacing, artwork alignment, skeletons, and solid-color `TagPill`
appearance. The density gesture changes row size without switching back to the older translucent
pill design. Selected rows use a light foreground tint with alpha instead of an opaque replacement
color, so artwork gradients remain visible. The floating selection toolbar and its overflow popup
are liquid glass. The toolbar uses the same screen-aware bottom anchor as the sort bubble, so native
tab and player insets are not counted twice. `trackMenuActions` appends caller actions to the shared `SongOptionsMenu`; do not
restore the deleted list-specific track menu.

`collection-list.tsx` is deliberately not `MusicList`. Sorting, multi-select, tagging, and the
song options menu all describe songs; none of them mean anything for an album, so the collection
list is its own small component rather than `MusicList` with five features switched off. It does
reuse `MusicListItemSkeleton` for its loading rows.

`artist-list.tsx` is the same idea for artists, which are `ArtistItem`s and not `MusicItem`s at
all. It draws round artwork, since that is how every music app draws a person, and exports
`canOpenArtist`: `/artist/[id]` reads the catalog, so an artist without a `catalogId` renders
inert instead of opening an empty screen. `ArtistRail` is the horizontal form, for a section
sitting above a list that owns the scroll.

`MusicList` hides its scroll indicator. Overscrolling at the top is how a detail screen closes,
and an indicator flicking in over the shrinking card is noise.

Tag rails use `MaskedView` with an opaque-to-transparent trailing mask. Do not replace it with a
gradient painted in a theme color: rows also sit over artwork tints, so no single fill color can
match every screen.

`TrackCollectionView` owns the standard mosaic or single-artwork header, play/shuffle row,
caller-supplied simple glass options, and the `MusicList`. Routes can supply pagination, playback
overrides, scrolling tint content, a fixed overscroll background, close controls, and opt the
standard header into the device's top safe area. Gradient-backed routes render the same tint as
both scrolling content and the fixed underlay, so elastic scrolling reveals the correct top or
bottom endpoint instead of a flat color. Artist uses its custom hero and albums
rail through the header/footer inputs, while album and playlist details use the standard layout
and open `CollectionOptionsMenu` from a supplied option.

`MusicList` takes a `header` for exactly that case, and a `footer` for the other end. It also
reports its content size through `onContentSizeChange`, which is how the artist screen sizes a
backdrop to its own content rather than to the screen. It owns its
own `FlatList`, so anything above the first row or below the last has to go inside it rather than
beside it. The search tab's Artists section is the header's current user; `RecentlyAddedGrid`
takes a `header` for the same reason. The artist screen uses both at once: the artist image as
the header, the albums rail as the footer. The footer sits below the pagination skeleton, so a
paging list keeps loading into it.

Top-level `MusicList`, `CollectionList`, `ArtistList`, and coming-soon scrollers are direct
children of `@/lib/screen-scroll-marker`. This lets the native tab stack locate their underlying
scroll views for inset, scroll-to-top, and tab-bar/accessory minimization.

### custom/options-menu/

| file                          | role                                                                                                                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `song-options-menu.tsx`       | `SongOptionsMenu`. Favorite + Share, Add to Playlist, Play Next, Add to Queue, Go to Album, Go to Artist, then a pronounced Modify Tags footer. Self-contained: owns its own favorite and artist state from just a `track`. Used by the music list row menu and the now-playing sheet. |
| `collection-options-menu.tsx` | `CollectionOptionsMenu`. Favorite + Share for the album/playlist itself, then Play Next / Add to Queue against its songs. Used by `/collection/[kind]/[id]`.                                                                                                                           |
| `favorite-share-row.tsx`      | `FavoriteShareRow`, the icon row + divider both menus lead with. Generic over the target type.                                                                                                                                                                                         |

Both menus render through the liquid-glass default in `ModalPopup`. Neither owns navigation directly:
`SongOptionsMenu` takes an optional `navigate` (defaulting to a plain `router.push`), so the
now-playing sheet can pass a function that dismisses itself first, without that assumption living
in the shared component. Modify Tags is the same shape: `SongOptionsMenu` takes an optional
`onModifyTags`, defaulting to a route push to `/player/tags` with `tagsSongId` and friends (opening the
now-playing sheet's Tags page for a song that may not be playing), while the now-playing sheet's
own menu instance passes a function that selects its native Tags tab in place instead - see
[custom/media-player/README.md](custom/media-player/README.md).

Gotchas carried over from before the two "..." menus were merged: `SongOptionsMenu` resolves the
song's artist (for Go to Artist) as soon as it mounts, which is only while the menu is open, so
nothing above it costs a catalog lookup on every song that plays; Go to Artist is disabled for a
library-only song, which has none.

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
- Native tabs inset scroll content themselves. App-owned floating actions and compatibility
  surfaces use `@/lib/screen-overlay::useScreenOverlayInsets` for extra clearance.
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
