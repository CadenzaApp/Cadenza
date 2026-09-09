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

| file | role |
| --- | --- |
| `music-list/` | Scrollable list of `MusicItem`s, with skeletons, paging, and sorting. See below. |
| `floating-bubble.tsx` | The round floating action button the list and tag screens sit under. |
| `song-detail-modal.tsx` | Full song sheet: artwork, tags, favorite, play. |
| `tag-pill.tsx` | A tag chip, colored from `tag.color`. |
| `create-tag-dialog.tsx` | Name + color picker, calls `useCreateTag`. |
| `modal-popup.tsx` | Small anchored popup used by the track menu and the selection actions. |
| `media-player/` | The global player. See [custom/media-player/README.md](custom/media-player/README.md). |

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
