# search

The Search tab. Two states, the way Apple Music's is: a browse page, and a focused search
screen you get by tapping the field. Apple's browse page is editorial categories, which we have
no catalog for, so ours is the user's own tags.

## Files

| file                          | role                                                                    |
| ----------------------------- | ----------------------------------------------------------------------- |
| `search-field.tsx`            | `SearchField`, the glass search pill.                                   |
| `search-scope.tsx`            | `SearchScopeToggle` and the `SearchScope` type. Apple Music vs Library. |
| `search-landing.tsx`          | `SearchLanding`, the unfocused body. Tag shelf.                         |
| `search-recents.tsx`          | `SearchRecents`, the focused body before a search runs.                 |
| `search-artists.tsx`          | `SearchArtists`, the Artists section above the results.                |
| `recent-searches.ts`          | `useRecentSearches`, the recents list over `AsyncStorage`. No UI.       |
| `recent-searches-section.tsx` | `RecentSearchesSection`, the recents rows plus the Clear control.       |
| `tag-shelf.tsx`               | `TagShelf`, the user's tags as a two-up grid of colored tiles.          |

## How it works

`src/app/(tabs)/search.tsx` owns the state: the term, the scope, and one `focused` boolean.

```
unfocused   top rail, an inert field, SearchLanding (tag tiles -> /tag/:tagId)
  tap the field
focused     rail hidden, field + close button, scope toggle, SearchRecents
  submit
focused     same top, MusicList of results for the active scope
```

Focused hides the navigator's header with `navigation.setOptions({ headerShown: false })` and
pays the top safe-area inset itself, since `TopRail` was what paid it before. Closing restores
the header, clears the term, and clears both scopes' results.

The unfocused field is wrapped in a `Pressable` with `pointerEvents="none"` over it, so a tap
changes state rather than opening the keyboard under a layout that is about to move. There is
no submit button. The return key searches, which is what Apple does.

Scope goes through `useCatalogSongSearch` or `useLibrarySongSearch`; both present the same
surface, so the screen reads one set of results off whichever is active and renders a single
`MusicList`. Switching scope re-runs the current term in the other one.

Artists come from `useCatalogArtistSearch` or `useLibraryArtistSearch`, picked off the same
scope, and render as `SearchArtists` handed to `MusicList` as its `header`. `MusicList` owns its
scroll container, so the section cannot be a sibling above it. The section draws nothing when
the term matched no artists, so a songs-only result looks exactly as it did before. Tapping a
tile pushes `/artist/:catalogId`.

The artist hooks take the term as an argument rather than holding it the way the two song
searches do. The screen keeps one `submittedTerm` for them, set on submit: `term` changes on
every keystroke, and keying off it would refetch mid-typing.

A recent entry is either a query or a song. Artists are not recorded; the rows are a
hand-written non-`MusicItem` list and a third variant has not been needed yet.

```
{ kind: "query", id: "query:<lowercased text>", at, text }
{ kind: "song",  id: "song:<songId>",           at, songId, title, artistName?, artworkUrl? }
```

The screen records a query on submit and a song on tap, through `onTrackPressOverride`, which
also plays it exactly as the default would. Recording something already in the list moves it to
the front rather than duplicating it. The list is capped at 20, newest first, and persisted
under `cadenza.search.recents`; anything that does not parse back is dropped whole.

A song entry keeps only the fields its row draws. Caching a whole `MusicItem` would go stale and
then lie about ids we try to play, so tapping one fetches the real track with
`MusicKit.getSongInfo` first.

## Connects to

- `@/lib/musickit-hooks::useCatalogSongSearch` and `::useLibrarySongSearch`, plus
  `@/lib/playback::usePlaybackCommands`, all from the screen.
- `@/lib/routes/tags::useUserTags` from `tag-shelf.tsx` and `search-landing.tsx`. Same SWR key,
  so it is one request.
- `@/components/ui/glass-surface` and `@/components/ui/glass-icon-button` for the field, the
  scope toggle, and the close button. The toggle also borrows `TAB_BAR_ITEM_INSET` from
  `@/lib/screen-overlay`, so its selection pill is as thick as the tab bar's.
- `@/components/custom/tag-pill::readableTextColor`, to pick black or white on a tag color.
- `@/lib/screen-scroll` and `@/lib/screen-overlay`, so the landing docks the mini player and
  both bodies clear the bars.

## Gotchas

- The glass in `SearchField` is an absolutely positioned layer behind the content, and the
  wrapper owns the height, the radius, and the clip. A native glass view handed children and no
  size of its own collapses instead of laying them out, which is exactly how the field ended up
  a stub with invisible text the first time.
- The field is a bare `TextInput`, not `@/components/ui/input`. That primitive is a bordered,
  filled form field and every base class would have to be fought.
- `useRecentSearches` holds local state, so calling it twice gives you two lists that drift.
  The screen calls it once and passes the pieces down.
- `SearchRecents` deliberately skips `useScreenScroll`. Docking the player while the keyboard is
  up would shift the thing being typed into.
- The recents rows are a hand-written list, not `MusicList`. Half of them are plain text and
  none of them are a full `MusicItem`, so sorting, tagging, and multi-select mean nothing here.
  `CollectionList` is the same call.
