# library

The library index and the category views in its tab-local stack. Modeled on Apple Music: the
library screen is a short list of category rows rather than a wall of songs. Which rows appear is
the user's choice.

## Files

| file                          | role                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categories.ts`               | `LibraryCategory`, the display order, labels, and icons. No React.                                                                                                      |
| `library-categories.tsx`      | `LibraryCategoriesProvider` / `useLibraryCategories`. Which rows show.                                                                                                  |
| `category-row.tsx`            | One row of the index. Pushes a normal view in the Library tab stack.                                                                                                    |
| `library-category-screen.tsx` | Picks the body for a category and sets the title.                                                                                                                       |
| `library-list-header.tsx`     | `LibraryListHeader` (search field, then Play and Shuffle) and `useLibraryListSearch`, the debounced term.                                                               |
| `library-songs.tsx`           | Songs: Apple's paged library, the backend's sorted copy, or library search results.                                                                                     |
| `library-collections.tsx`     | Albums or Playlists, or the ones matching search. Albums can be played whole.                                                                                           |
| `library-playlists.tsx`       | Playlists: Your playlists or Shared playlists, over `LibraryCollections` or `SharedPlaylistsList`. |
| `library-view-switch.tsx`     | `useLibraryViewSwitch`, a category's two-view switch, kept in the `view` param so a link opens on either. Playlists and Queries use it. |
| `library-artists.tsx`         | Artists, or the ones matching search.                                                                                                                                   |
| `saved-queries-view.tsx`      | Queries: the user's saved queries, or only the ones shared on their profile, favorites first, each with its saved cover. A row opens its stored songs on `/query-results`; the trash icon deletes it.             |
| `play-queue.ts`               | `mapInOrder` and `concatUnique`, for one queue built from several lists. Tested.                                                                                        |
| `recently-added.tsx`          | `RecentlyAddedGrid`, the paged artwork grid that owns the screen scroll and reports it with `useScreenScroll`. Collection tiles open with the native zoom (`ZoomTile`). |
| `tags-view.tsx`               | Every tag as a pill, opening `/tag/:tagId`. The Tags category's body.                                                                                                   |

## How it works

Six categories: `playlist`, `artist`, `album`, `song`, `query`, `tag`. `LIBRARY_CATEGORY_ORDER` is the
display order and is the only place that order is written down.

```
/library               the index: a CategoryRow per enabled category, then RecentlyAddedGrid
  -> /library-categories          toggles which categories are enabled
  -> /library/category/:kind      normal tab-stack category view
       -> /collection/:kind/:id   one album's or playlist's songs
       -> /artist/:id             one catalog artist, image on a nebula
       -> /tag/:tagId             one tag's songs
       -> /query-results          one saved query's stored songs
```

The category destinations stay inside the Library tab's native stack. They use the shared top
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

`/library/category/:kind` is one screen for every category, and each category is its own body
component, so only the open one reads anything. Every list but Tags starts with
`LibraryListHeader`, inside the list so it scrolls with the rows, the way Apple Music lays it out:

| category  | search                | Play / Shuffle queue                                                                          |
| --------- | --------------------- | --------------------------------------------------------------------------------------------- |
| Songs     | Apple library search  | search results loaded, else what a sorted list shows, else the whole library in Apple's order |
| Albums    | Apple library search  | every song of every album loaded or matched, in list order                                    |
| Playlists | Apple library search  | none                                                                                          |
| Artists   | Apple library search  | none                                                                                          |
| Queries   | by name, on the phone | each query shown rerun, the user's own songs first, at most 500                               |

Songs render through `MusicList` (with Sort by / Group by and paging). Unarranged they page from
Apple Music in its own order; sorted or grouped they are the backend's "every song in the library"
query run library-only, so the whole library sorts at once on Android too. Sort by and Group by
hide during a search, since Apple ranks those results. Each list fills a `ScreenScrollMarker`, so
native scrolling can minimize the tab bar and move its player accessory inline. A list's loading
skeleton is inside the list, so the search field never unmounts while a new page loads.

Queries come from `GET /saved-queries`, saved from the "..." menu on a results screen. A saved query
holds the songs it matched when saved, not a live result. Rerun query in the same menu replaces
them. With Update saved queries on (Account, Listening), tagging a song adds it to any saved query
it now matches. Play and Shuffle on the list queue the stored songs.

Album and playlist details render through the shared `TrackCollectionView`. The route supplies
pagination, an artwork-derived fallback color for the nebula, current playback state, and its rich
collection options menu. Artist details use the same track surface with a `BlendedCover` of the
portrait and an albums footer. Query results use the standard mosaic header and add their Save
action through the same options input. Tag details also use the mosaic, tag pill and song count as
the title, and supply their tag color as the nebula's fallback. Tag details also offer options to
rename, recolor, or delete the tag.

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

- `@/lib/musickit-hooks` for the library reads, their `*SearchPages` searches, and
  `readAllLibrarySongs` / `readAllCollectionSongs` for Play.
- `@/lib/play-all::usePlayAll` for Play and Shuffle.
- `@/lib/routes/saved-queries` for Queries.
- `@/components/custom/artist-list::ArtistList` for the Artists category body.
- `@/lib/routes/tags::useUserTags` from `tags-view.tsx`, which fetches its own tags.
- `@/components/custom/collection-list`, `track-collection-view`, and `music-list` for the bodies.
- `@/lib/playback::usePlaybackCommands` from `recently-added.tsx`, to play a tile.

## Gotchas

- A new category means a variant in `LibraryCategory`, an entry in `LIBRARY_CATEGORY_META`, a
  place in `LIBRARY_CATEGORY_ORDER`, and a case in `CategoryBody` in `library-category-screen.tsx`.
  The type makes all four fail loudly if you miss one. Do not touch
  `LEGACY_KNOWN_CATEGORIES`: it is a record of what already shipped, not a list to keep current.
- Tags used to be a segmented view on the Cadenza tab. That switch is gone; Cadenza is only the
  query builder now.
- Category views must remain under `(tabs)/(library)/library`; moving them back to the root stack hides the
  native tab controller that owns both the tab bar and iOS bottom player accessory.

---

Touching files in this directory? Update this README in the same change.
See [../../../../AGENT_GUIDE.md](../../../../AGENT_GUIDE.md).
