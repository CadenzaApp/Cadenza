# library

The library index and the category views in its tab-local stack. Modeled on Apple Music: the
library screen is a short list of category rows rather than a wall of songs. Which rows appear is
the user's choice.

## Files

| file                     | role                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------- |
| `categories.ts`          | `LibraryCategory`, the display order, labels, and icons. No React.                                                                                      |
| `library-categories.tsx` | `LibraryCategoriesProvider` / `useLibraryCategories`. Which rows show.                                                                                  |
| `category-row.tsx`       | One row of the index. Pushes a normal view in the Library tab stack.                                                                                    |
| `library-category-screen.tsx` | Shared body for all five categories, with tab-stack and compatibility detail hosts.                                                               |
| `recently-added.tsx`     | `RecentlyAddedGrid`, the paged artwork grid that owns the screen scroll and reports it with `useScreenScroll`. Tiles record themselves as zoom origins. |
| `tags-view.tsx`          | Every tag as a pill, opening `/tag/:tagId`. The Tags category's body.                                                                                   |

## How it works

Five categories: `playlist`, `artist`, `album`, `song`, `tag`. `LIBRARY_CATEGORY_ORDER` is the
display order and is the only place that order is written down.

```
/library               the index: a CategoryRow per enabled category, then RecentlyAddedGrid
  -> /library-categories          toggles which categories are enabled
  -> /library/category/:kind      normal tab-stack category view
       -> /collection/:kind/:id   one album's or playlist's songs
       -> /artist/:id             one catalog artist, image full bleed
       -> /tag/:tagId             one tag's songs
```

The five category destinations stay inside the Library tab's native stack. They use the shared top
rail with a back arrow, keep the native tab bar mounted, and therefore keep its bottom player
accessory visible when playback starts. Album, playlist, artist, and tag details remain separate
resource routes when a row inside a category opens one.

`LibraryCategoriesProvider` is mounted in `src/app/_layout.tsx`, above the navigator, because the
screen that reads the selection and the sheet that edits it are separate routes. The selection is
persisted in `AsyncStorage` under `cadenza.library.categories`; a bad or missing value falls back
to all of them enabled.

The stored value records both what is enabled and which categories existed when it was written.
A category the user was never offered cannot have been deliberately turned off, so it comes back
enabled instead of silently missing for everyone who saved a selection before it shipped. The
legacy shape was a bare array, and `LEGACY_KNOWN_CATEGORIES` is what it was choosing among.

`/library/category/:kind` is one screen for all five categories. Songs render through `MusicList` (with
its sorting control and paging), albums and playlists through `CollectionList`, artists through
`ArtistList`, and tags through `TagsView`. Only the requested category's hook is enabled, so
opening Albums does not fetch songs.

Album and playlist details render through the shared `TrackCollectionView`. The route supplies
pagination, tint, current playback state, and its rich collection options menu. Artist details use
the same track surface with a custom full-bleed hero and albums footer. Query results use the
standard mosaic header and add their Save action through the same options input.

An artist row opens `/artist/:catalogId`, the same catalog artist screen the player's `...` menu
reaches. A library artist Apple knows no catalog equivalent for has nowhere to go, and
`ArtistList` disables it.

`RecentlyAddedGrid` renders Apple's own recently added feed, so a tile is an album, a playlist,
or a song that was added on its own. A whole album added at once is one tile, not twelve. Albums
and playlists open `/collection/:kind/:id`; songs play. It pages as you scroll, 24 items a time.

The grid is the library screen's scroll container, not a section inside one: a paging list cannot
live in a `ScrollView`, so the category rows are handed to it as `header`. Its `FlatList` is the
direct child of `ScreenScrollMarker`, which registers the list through the nested native stack so
scrolling can minimize the native tab bar and move the player inline.

## Connects to

- `@/lib/musickit-hooks` for `useTracksFromLibrary`, `useLibraryAlbums`, `useUserPlaylists`,
  `useLibraryArtists`.
- `@/components/custom/artist-list::ArtistList` for the Artists category body.
- `@/lib/routes/tags::useUserTags` from `tags-view.tsx`, which fetches its own tags.
- `@/components/custom/collection-list`, `track-collection-view`, and `music-list` for the bodies.
- `@/lib/playback::usePlaybackCommands` from `recently-added.tsx`, to play a tile.

## Gotchas

- A new category means a variant in `LibraryCategory`, an entry in `LIBRARY_CATEGORY_META`, a
  place in `LIBRARY_CATEGORY_ORDER`, and a branch in `library-category-screen.tsx`. The type makes
  the first three fail loudly if you miss one; the branch does not. Do not touch
  `LEGACY_KNOWN_CATEGORIES`: it is a record of what already shipped, not a list to keep current.
- Tags used to be a segmented view on the Cadenza tab. That switch is gone; Cadenza is only the
  query builder now.
- Category views must remain under `(tabs)/library`; moving them back to the root stack hides the
  native tab controller that owns both the tab bar and iOS bottom player accessory.

---
Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).
