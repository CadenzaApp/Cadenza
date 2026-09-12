# library

The library index and the sheets it opens. Modeled on Apple Music: the library screen is a short
list of category rows rather than a wall of songs, and each row opens that category as a sheet.
Which rows appear is the user's choice.

## Files

| file                      | role                                                                   |
| ------------------------- | ---------------------------------------------------------------------- |
| `categories.ts`           | `LibraryCategory`, the display order, labels, and icons. No React.      |
| `library-categories.tsx`  | `LibraryCategoriesProvider` / `useLibraryCategories`. Which rows show.  |
| `category-row.tsx`        | One row of the index.                                                   |
| `recently-added.tsx`      | The artwork grid under the rows.                                        |
| `tags-view.tsx`           | Every tag as a pill, opening `/tag/:tagId`. The Tags category's body.   |

## How it works

Four categories: `playlist`, `album`, `song`, `tag`. `LIBRARY_CATEGORY_ORDER` is the display
order and is the only place that order is written down.

```
/library               the index: a CategoryRow per enabled category, then RecentlyAdded
  -> /library-categories   sheet, toggles which categories are enabled
  -> /category/:kind       sheet, that category's contents
       -> /collection/:kind/:id   sheet, one album's or playlist's songs
       -> /tag/:tagId             sheet, one tag's songs
```

Every one of those is a sheet, so browsing into the library never leaves the tab and the bottom
bars stay put behind it.

`LibraryCategoriesProvider` is mounted in `src/app/_layout.tsx`, above the navigator, because the
screen that reads the selection and the sheet that edits it are separate routes. The selection is
persisted in `AsyncStorage` under `cadenza.library.categories`; a bad or missing value falls back
to all four enabled.

`/category/:kind` is one screen for all four categories. Songs render through `MusicList` (with
its sorting control and paging), albums and playlists through `CollectionList`, and tags through
`TagsView`. Only the requested category's hook is enabled, so opening Albums does not fetch
songs.

`RecentlyAdded` shows library **songs** sorted by `dateAdded`, not albums as Apple does, because
`dateAdded` ordering is only available on `getLibrarySongs`. That sort is iOS-only, so the
section is hidden on Android.

## Connects to

- `@/lib/musickit-hooks` for `useTracksFromLibrary`, `useLibraryAlbums`, `useUserPlaylists`.
- `@/lib/routes/tags::useUserTags` from `tags-view.tsx`, which fetches its own tags.
- `@/components/custom/collection-list` and `@/components/custom/music-list` for the bodies.
- `@/lib/playback::usePlaybackCommands` from `recently-added.tsx`, to play a tile.

## Gotchas

- A new category means a variant in `LibraryCategory`, an entry in `LIBRARY_CATEGORY_META`, a
  place in `LIBRARY_CATEGORY_ORDER`, and a branch in `app/category/[kind].tsx`. The type makes
  the first three fail loudly if you miss one; the branch does not.
- Tags used to be a segmented view on the Cadenza tab. That switch is gone; Cadenza is only the
  query builder now.
- Everything here renders inside a sheet. `SheetScreen` flags that through
  `InsideSheetContext`, which is what stops `useScreenOverlayInsets` from padding sheet content
  for a tab bar that is behind the sheet, not under it.

---
Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).
