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

`badge`, `button`, `card`, `dialog`, `icon`, `input`, `label`, `separator`, `skeleton`, `tabs`,
`text`, `native-only-animated-view`, plus `sign-in-form` and `sign-up-form`.

Config lives in `client-app/components.json` (shadcn "new-york", base color neutral, css
variables), `tailwind.config.js`, and `global.css`. Class merging goes through
`@/lib/utils::cn`. Variants use `class-variance-authority`.

### custom/

| file                        | role                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `music-list/`               | Scrollable list of `MusicItem`s, with skeletons, paging, and sorting. See below.       |
| `floating-bubble.tsx`       | The round floating action button the list and tag screens sit under.                   |
| `song-detail-modal.tsx`     | Full song sheet: artwork, tags, favorite, play.                                        |
| `track-collection-view.tsx` | Reusable artwork mosaic, metadata, actions, and sortable track list.                   |
| `track-collection-utils.ts` | Artwork ranking and track-count/duration formatting for collection views.              |
| `tag-pill.tsx`              | A solid `tag.color` chip with optional leading icon and outlined treatment.            |
| `create-tag-dialog.tsx`     | Name + color picker, calls `useCreateTag`.                                             |
| `modal-popup.tsx`           | Small anchored popup used by the track menu and the selection actions.                 |
| `media-player/`             | The global player. See [custom/media-player/README.md](custom/media-player/README.md). |

### custom/music-list/

| file                               | role                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `index.tsx`                        | The `MusicList` itself. Owns sorting, paging, selection, and the modals.             |
| `music-list-item.tsx`              | One row, plus `MusicListItemSkeleton`.                                               |
| `music-list-sort-button.tsx`       | The floating sort control.                                                           |
| `music-list-action-button.tsx`     | One button in the selection toolbar.                                                 |
| `music-list-selection-toolbar.tsx` | The bar that slides up while rows are selected.                                      |
| `music-list-track-menu.tsx`        | The per-row overflow menu.                                                           |
| `use-music-list-selection.ts`      | Selection state, haptics, and pruning. Tested in `use-music-list-selection.test.ts`. |
| `selection-utils.ts`               | `reduceMusicListSelection`, the pure reducer behind the hook.                        |
| `sort-tracks.ts`                   | `sortTracks` / `nextSort`. Pure, unit tested in `sort-tracks.test.ts`.               |
| `types.ts`                         | `MusicListProps` and the sort types, so callers do not import from `index.tsx`.      |

Sorting is either `"local"` (this folder sorts the array it was handed) or `"remote"` (the
caller refetches sorted and only wants the control rendered). The library screen uses
`"remote"` on iOS, because `MusicLibraryRequest` sorts across the whole library rather than
just the page that happens to be loaded.

Paging is opt-in. Pass `pagination` to get `onEndReached` plus footer skeletons, or `null` for a
list that is fully loaded up front, like a tag's songs or a query's results.

Multi-select is opt-in too, via `multiSelect`. Selection is scoped to what is currently
displayed: if paging or a filter drops a row, its id is pruned. A long press starts a selection,
a tap toggles one, and clearing everything leaves selection mode. Music List uses one fixed row
layout.

Pass `embedded` when placing a Music List inside another bounded surface. It removes the normal
screen-level bottom inset while leaving row behavior intact.

`fullBleedRows` places each row's selection background edge to edge and defaults its content to a
24-pixel horizontal inset. Use `fullBleedRowHorizontalPadding` when a bounded caller needs a tighter
inset; the query summary preview uses 12 pixels. `rowSurfaceColor` tells transparent rows and their
tag-edge fades which theme surface is underneath them. The query preview uses `card` rather than the
screen background.

Pass `showTags={false}` for large result sets that do not display tag chips. This avoids loading
tag assignments for every track in the list.

`TagPill` shows its leading circle or custom icon by default. It also supports outlined and thin
strikethrough treatments. Set `showIcon={false}` to render text-only pills. Music List rows use
small, full-name text-only pills while other tag surfaces retain icons. Rows have no separators
and use the artwork to keep their height and spacing consistent whether tags are present or not.
Untagged title and artist text is centered in that height. Rows and artwork are two pixels taller
than the original compact layout. Artwork uses an explicit square aspect ratio and owns its corner
crop so its alignment offset cannot clip the bottom corners. Square artwork is optically aligned
from the top of the title through the bottom of the tag row. Title-to-artist, artist-to-tag, and
artwork-to-text spacing use a shared visual rhythm, with the horizontal gap twice as wide as the
vertical gaps. The text stack has a one-pixel downward offset independent of the artwork. Adjacent
rows use 15 pixels of combined vertical padding. Loading rows use separate title, artist, and
tag-pill skeleton shapes.

Pass `listHeader` to put collection metadata inside the Music List's scroll surface. `onScroll`
supports UI-thread coordination such as the artwork scaling in `TrackCollectionView`.

`TrackCollectionView` accepts caller-owned `options`. No options leaves Play and Shuffle filling
the action row, one renders a direct icon action, and multiple options render an overflow popup.
Its artwork scales from 100 to 80 percent over the first 120 pixels of scrolling. A collection
with one distinct artwork renders one image; multiple artworks use the weighted 2x2 mosaic. The
scale is anchored at the artwork's bottom edge so its title spacing stays fixed. It also forwards
the Music List's `multiSelect` configuration and exposes a true-by-default `showTags` prop.

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
- Theme colors come from the nav theme (`@/lib/theme::NAV_THEME`) in some places and tailwind
  tokens (`bg-background`, `text-foreground`) in others. They are configured separately and can
  drift.

---

Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
