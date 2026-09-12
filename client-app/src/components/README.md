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

`badge`, `button`, `card`, `dialog`, `glass-surface`, `glass-icon-button`, `icon`, `input`,
`label`, `separator`, `skeleton`, `tabs`, `text`, `native-only-animated-view`, `sheet-screen`,
plus `sign-in-form` and `sign-up-form`.

`glass-surface.tsx` exports `GlassSurface`, the translucent background layer behind both
floating bottom bars. It renders liquid glass on iOS 26, an `expo-blur` `BlurView` on anything
older, and a flat translucent card on web, all behind one component. It paints a background and
nothing else; the caller supplies size, radius, and `overflow: "hidden"`.

`glass-icon-button.tsx` exports `GlassIconButton`, a round icon button built on it. The account
button and the library type button in the top rail are the callers. Reach for it rather than
hand-rolling another circle of glass.

`reorderable-list.tsx` is in `custom/` rather than `ui/` only because nothing else needs it yet.
It knows nothing about songs: `data`, `itemHeight`, `renderItem`, and an `onReorder(from, to)`.
Rows are absolutely positioned off `itemHeight` instead of measured, so dragging moves a
transform and never triggers layout, and it scrolls itself near either edge. The drag starts on
a long press, which leaves short drags to the scroll view. Do **not** reuse the query builder's
drag code for a list: it caches drop-zone rects once at drag start, so it breaks under scroll.

`sheet-screen.tsx` exports `SheetScreen`, the header and safe-area shell for any route
presented with `sheetScreenOptions` from `@/lib/theme`. It draws the title, an optional
`headerRight`, and a close button, then renders its children in a clipped flex body below
them. The caller keeps its own scrolling and bottom inset, and owes the body a definite
height (`flex-1` on the scrolling child), because a content-sized list in a sheet grows past
its box while the sheet animates. The header paints and hit-tests above the body, so a body
that gets this wrong can no longer cover the close button. It also wraps the body in `InsideSheetContext`, so
overlay insets inside it stop counting the tab bar and the compact player. Every sheet route
uses it, which is what keeps them identical.

Config lives in `client-app/components.json` (shadcn "new-york", base color neutral, css
variables), `tailwind.config.js`, and `global.css`. Class merging goes through
`@/lib/utils::cn`. Variants use `class-variance-authority`.

### custom/

| file | role |
| --- | --- |
| `music-list/` | Scrollable list of `MusicItem`s, with skeletons, paging, and sorting. See below. |
| `floating-bubble.tsx` | The round floating action button the list and tag screens sit under. |
| `song-detail-modal.tsx` | Full song sheet: artwork, tags, favorite, play. |
| `tag-pill.tsx` | A tag chip, colored from `tag.color`. |
| `create-tag-dialog.tsx` | `CreateTagDialog` (controlled name + color picker, calls `useCreateTag`) and `CreateTagBubble` (floating trigger + dialog). |
| `modal-popup.tsx` | Small anchored popup used by the track menu and the selection actions. |
| `tab-bar.tsx` | The floating tab bar's chrome: sliding glass bubble, and icons and labels that tint as it passes. |
| `top-rail.tsx` | Shared tab header: page title on the left, an optional `actions` slot and the account initials on the right. |
| `account-initials.ts` | Pure email-to-initials helper, tested in `account-initials.test.ts`. |
| `coming-soon-screen.tsx` | Data-driven preview surface used by stubbed product areas. |
| `collection-list.tsx` | Paged list of albums or playlists. Tapping a row opens it. |
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
