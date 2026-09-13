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
| `recently-added.tsx`      | `RecentlyAddedGrid`, the paged artwork grid that owns the screen scroll and reports it with `useScreenScroll`. |
| `tags-view.tsx`           | Every tag as a pill, opening `/tag/:tagId`. The Tags category's body.   |

## How it works

Five categories: `playlist`, `artist`, `album`, `song`, `tag`. `LIBRARY_CATEGORY_ORDER` is the
display order and is the only place that order is written down.

```
/library               the index: a CategoryRow per enabled category, then RecentlyAddedGrid
  -> /library-categories   sheet, toggles which categories are enabled
  -> /category/:kind       sheet, that category's contents
       -> /collection/:kind/:id   sheet, one album's or playlist's songs
       -> /artist/:id             sheet, one catalog artist
       -> /tag/:tagId             sheet, one tag's songs
```

Every one of those is a sheet, so browsing into the library never leaves the tab and the bottom
bars stay put behind it.

`LibraryCategoriesProvider` is mounted in `src/app/_layout.tsx`, above the navigator, because the
screen that reads the selection and the sheet that edits it are separate routes. The selection is
persisted in `AsyncStorage` under `cadenza.library.categories`; a bad or missing value falls back
to all of them enabled.

The stored value records both what is enabled and which categories existed when it was written.
A category the user was never offered cannot have been deliberately turned off, so it comes back
enabled instead of silently missing for everyone who saved a selection before it shipped. The
legacy shape was a bare array, and `LEGACY_KNOWN_CATEGORIES` is what it was choosing among.

`/category/:kind` is one screen for all five categories. Songs render through `MusicList` (with
its sorting control and paging), albums and playlists through `CollectionList`, artists through
`ArtistList`, and tags through `TagsView`. Only the requested category's hook is enabled, so
opening Albums does not fetch songs.

An artist row opens `/artist/:catalogId`, the same catalog artist screen the player's `...` menu
reaches. A library artist Apple knows no catalog equivalent for has nowhere to go, and
`ArtistList` disables it.

`RecentlyAddedGrid` renders Apple's own recently added feed, so a tile is an album, a playlist,
or a song that was added on its own. A whole album added at once is one tile, not twelve. Albums
and playlists open `/collection/:kind/:id`; songs play. It pages as you scroll, 24 items a time.

The grid is the library screen's scroll container, not a section inside one: a paging list cannot
live in a `ScrollView`, so the category rows are handed to it as `header`.

## Connects to

- `@/lib/musickit-hooks` for `useTracksFromLibrary`, `useLibraryAlbums`, `useUserPlaylists`,
  `useLibraryArtists`.
- `@/components/custom/artist-list::ArtistList` for the Artists category body.
- `@/lib/routes/tags::useUserTags` from `tags-view.tsx`, which fetches its own tags.
- `@/components/custom/collection-list` and `@/components/custom/music-list` for the bodies.
- `@/lib/playback::usePlaybackCommands` from `recently-added.tsx`, to play a tile.

## Gotchas

- A new category means a variant in `LibraryCategory`, an entry in `LIBRARY_CATEGORY_META`, a
  place in `LIBRARY_CATEGORY_ORDER`, and a branch in `app/category/[kind].tsx`. The type makes
  the first three fail loudly if you miss one; the branch does not. Do not touch
  `LEGACY_KNOWN_CATEGORIES`: it is a record of what already shipped, not a list to keep current.
- Tags used to be a segmented view on the Cadenza tab. That switch is gone; Cadenza is only the
  query builder now.
- Everything here renders inside a sheet. `SheetScreen` flags that through
  `InsideSheetContext`, which is what stops `useScreenOverlayInsets` from padding sheet content
  for a tab bar that is behind the sheet, not under it.

---
Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).
