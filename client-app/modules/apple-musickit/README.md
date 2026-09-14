# Apple MusicKit Expo module

This local Expo module provides Apple Music authorization, catalog and library
lookups, favorites, and native playback on iOS and Android. A mock implementation
supports frontend development in Expo Go without Apple Music credentials or a
subscription.

## Consumer API

Import `Auth`, `MusicKit`, `Playback`, and their public types from
`@apple-musickit`.

- `Auth` authorizes the current user and restores or clears native tokens.
- `MusicKit` searches the catalog, reads library pages and playlist tracks,
  reads or changes favorite state for songs, albums, and playlists, writes to
  library playlists, and reads catalog and library artists.
- `Playback` exposes native commands plus React hooks for the shared playback
  snapshot.

Returned `MusicItem` values identify their `resourceKind`, `source`, canonical
`id`, optional `catalogId` and `libraryId`, and required `playbackType`. Library
requests accept `limit` and `offset`; results expose Apple's `next` path when a
later page exists.

Catalog pagination is flattened to scalar `limit` and `offset` arguments at the
native bridge. The public TypeScript API still accepts an options object. This
avoids platform-specific object-to-dictionary conversion failures in ExpoModulesCore.

Use `Auth.isAvailable()`, `MusicKit.isAvailable()`, or `Playback.isAvailable()`
when rendering a surface that may run on web or in Expo Go.

## Mock mode

Set the following public environment variable before starting Expo:

```sh
EXPO_PUBLIC_MOCK_MUSICKIT=1
```

Mock mode supplies authorization, catalog and library fixtures, paginated
collections, album and playlist contents, mutable favorite state for songs and
collections, the full queue
surface (reorder, remove, jump, play next, shuffle, repeat), playlist writes,
artists, and playback snapshots with simulated progress. Mock artist ids are
derived from the artist name, so every fixture has one without the fixtures
carrying it. Library albums and both artist lists are
derived from the song fixtures rather than written out, so every album the mock
lists has tracks behind it and every artist it lists has songs. Mock library
artists always carry a `catalogId`, so the tap into the artist screen is
exercisable in Expo Go. It does not play audio and does not
require `EXPO_PUBLIC_MUSICKIT_DEVELOPER_TOKEN`.

Unset `EXPO_PUBLIC_MOCK_MUSICKIT` for native MusicKit builds. The mock switch is
evaluated when the JavaScript bundle is created, so restart Expo after changing
it.

## Platform requirements

- iOS 16.4 or newer, matching the application deployment target.
- Android API 24 or newer with the Apple Music app installed for authorization.
- A current Apple Music developer token and an authorized music-user token.

The application should obtain renewable developer tokens from its backend. Do
not commit a long-lived developer token or its signing key. Persist music-user
tokens with platform-backed secure storage.

## Validation

From `client-app`:

```sh
npx tsc --noEmit
npx eslint modules/apple-musickit/index.ts modules/apple-musickit/src/*.ts
```

Compile native targets with the `AppleMusicKitModule` Xcode scheme and Gradle's
`:apple-musickit:compileDebugKotlin` task.

## Files

| file | role |
| --- | --- |
| `index.ts` | Public surface. This is what `@apple-musickit` resolves to. |
| `src/index.ts` | Re-exports `Auth`, `MusicKit`, `Playback`. |
| `src/AppleMusicKit.types.ts` | `MusicItem`, `AuthResult`, `AuthStatus`, `ShuffleMode`, `RepeatMode`, `ArtistItem`, `ArtistResult`, `ArtistDetail`, and the rest of the shared types. |
| `src/auth.ts` | Authorization and native token management. |
| `src/library.ts` | Catalog search, library pages, album and playlist tracks, favorites, playlist writes, artists. |
| `src/playback.ts` | Native playback commands and the playback snapshot hooks. |
| `src/mock-native-module.ts` | The `EXPO_PUBLIC_MOCK_MUSICKIT=1` implementation. Fixtures, paginated collections, simulated progress. |
| `ios/AppleMusicKitModule.swift` | iOS native module. |
| `android/src/main/java/.../AppleMusicKitModule.kt` | Android native module. |
| `expo-module.config.json` | Autolinking config. Picked up via the `expo.autolinking.nativeModulesDir` entry in `client-app/package.json`. |

## Library reads

`MusicKit` covers songs, albums, and playlists in the user's library. Every one
of them pages the same way: pass `{ limit, offset }`, read `nextOffset` off the
result, stop when `hasNextPage` is false.

| call | returns |
| --- | --- |
| `getLibrarySongs(options)` | Library songs. The only one that accepts `sort`, which is iOS only. |
| `getLibraryAlbums(options)` | Library albums. |
| `getUserPlaylists(options)` | Library playlists. |
| `getAlbumSongs(albumId, options)` | The songs on one library album. |
| `getPlaylistSongs(playlistId, options)` | The songs in one library playlist. |
| `getRecentlyAdded(options)` | Recently added library items, newest first. Mixed albums, playlists, and loose songs. Apple caps `limit` at 25. |
| `searchLibrarySongs(term, options)` | Library songs matching a text term. Added after the first dev builds shipped, so a stale binary throws "rebuild the app" rather than crashing. |
| `getLibraryArtists(options)` | Library artists. Same stale-binary guard as `searchLibrarySongs`. |
| `searchLibraryArtists(term, options)` | Library artists matching a text term. Same guard. |

Albums and playlists come back as `MusicItem`s with `resourceKind` set to
`"album"` or `"playlist"`, so the same item type describes all three. Pass the
`libraryId` to `getAlbumSongs` and `getPlaylistSongs`; `id` is the catalog
identifier whenever Apple knows of a catalog equivalent, and it is the one to
hand to `setPlaybackQueue`.

`getAlbumSongs` takes either kind of album id. Apple prefixes library ids with a
dot-segment, so a bare numeric id is treated as a catalog album and read from the
catalog path instead. That is what a song's `albumID` is.

## Playlist writes

| call | does |
| --- | --- |
| `addSongsToPlaylist(playlistId, ids)` | Appends catalog songs to a library playlist. |
| `createPlaylist(name, ids)` | Creates a library playlist and returns it as a `MusicItem`. |

Both go through the Apple Music HTTP API on both platforms rather than through
either native SDK, because neither SDK edits playlists. Library-only song ids
are resolved to their catalog equivalent first; Apple rejects the request
otherwise.

## Favorites and collection info

| call | does |
| --- | --- |
| `getSongFavoriteStatus(id)` / `setSongFavoriteStatus(id, isFavorite)` | Reads or writes a song's favorite state. |
| `getCollectionFavoriteStatus(kind, id)` / `setCollectionFavoriteStatus(kind, id, isFavorite)` | The same, for an album or playlist. `kind` is `"albums"` or `"playlists"`, matching the Apple Music API path segment directly rather than the app's singular `LibraryCollectionKind`. |
| `getCollectionInfo(kind, ids)` | Metadata (title, artwork, `shareUrl`) for the album or playlist itself, mirroring `getSongInfo`. |

All three favorite calls resolve a library-only id to its catalog equivalent
first (`resolveCatalogSongID` for songs, the generalized `resolveCatalogID` for
albums/playlists), then read or write Apple's rating endpoint
(`/v1/catalog/{storefront}/{type}/{id}?extend=inFavorites` to read,
`/v1/me/ratings/{type}/{id}` to write). A purely personal playlist that was
never published to the catalog has no catalog id to resolve to; both platforms
throw `ERR_CATALOG_ID_UNAVAILABLE` in that case, and the client treats it as
"favorite unavailable" rather than a hard failure.

`getCollectionInfo` did not exist before the options-menu rework: the
collection screen previously only ever fetched a collection's songs, never the
collection itself. It follows `getSongInfo`'s shape (library/catalog split,
original order preserved) but goes through the raw REST `formatAPIResource`
(iOS) / `formatMediaItem` (Android) path rather than the typed MusicKit
framework calls `getSongInfo` uses for catalog songs, since there is no typed
album/playlist equivalent needed elsewhere in this module.

## Artists

| call | returns |
| --- | --- |
| `getSongArtists(songId)` | Catalog artist ids credited on a song, most prominent first. |
| `getArtist(artistId)` | An `ArtistDetail`: name, artwork, genres, top songs, albums. |
| `getLibraryArtists(options)` | A page of `ArtistItem`s from the user's library. |
| `searchLibraryArtists(term, options)` | Library artists matching a term. |
| `catalogSearch(term, ["artists"], options)` | Catalog artists, on `SearchResult.artists`. |

An artist in a list is an `ArtistItem`, not a `MusicItem`. `MusicResourceKind`
still has no `"artist"` and `PlaybackQueueType` still has no artist case,
because an artist is not a thing you can queue, and `MusicItem.playbackType` is
required. `ArtistItem` follows the same `id` / `catalogId` / `libraryId`
convention as `MusicItem` otherwise.

`getArtist` asks Apple for 1200x1200 artwork, because the artist screen runs it
full bleed behind its header, and for 300x300 alongside it as
`artworkUrlSmall`. The screen shows the small one while the big one downloads,
so the hero is never a blank rectangle with the tint already painted around it.
The artist lists ask for 200x200, which is tile size.

`getSongArtists` and `getArtist` are catalog only. A library song with no
catalog equivalent resolves to no artists at all, and `MusicItem.artistId` is
absent for it.

`getLibraryArtists` requests Apple's `catalog` relationship inline
(`include=catalog`), and `searchLibraryArtists` does the same with the
type-scoped form the library search endpoint wants
(`include[library-artists]=catalog`). Either way a library artist arrives
already carrying the `catalogId` needed to open it, plus the catalog artist's
artwork, which a library artist has none of on its own. A library artist Apple
knows no catalog equivalent for has no `catalogId`, and there is nowhere to
open it: the client disables that row rather than pushing an empty artist
screen.

## Artwork color

Every artwork Apple ships carries a representative color alongside its URL, and
it is what Music tints its own artist, album, and now playing screens with. It
arrives as `artworkColor` on `MusicItem`, `ArtistItem`, and `ArtistDetail`,
normalized to `#rrggbb`.

Two sources end up in that one field. MusicKit objects on iOS expose it as
`Artwork.backgroundColor`, a `CGColor`. The raw Apple Music API ships it as a
bare hex string under `artwork.bgColor`, which is the only path Android has.
`artworkColorHex` on each platform is the only place that difference exists.

Library artwork usually has no color at all. `artworkColor` is absent for it,
and the client averages the image itself through `modules/image-color` rather
than this module. Nothing here decodes an image.

## Queue control

The native player owns the queue. These commands address it by position in the
whole queue, counting the entry that is playing, which is the same index space
`client-app/src/lib/playback.tsx` mirrors.

| call | does |
| --- | --- |
| `playSongQueue(tracks, startIndex)` | Replaces the queue and plays. |
| `appendSongQueue(tracks)` | Adds to the end. |
| `insertSongsNext(tracks)` | Adds directly after the playing entry. |
| `moveQueueItem(from, to)` | Reorders. The playing entry keeps playing. |
| `removeQueueItem(index)` | Drops one entry. |
| `playQueueItem(index)` | Jumps to an entry. |
| `setShuffleMode(mode)` / `setRepeatMode(mode)` | `ShuffleMode` and `RepeatMode`. Both also come back on the playback snapshot. |

`playQueueItem` forward **discards** everything it skipped over. Neither player
can move the cursor without consuming the queue: MusicKit will not set
`currentEntry`, and the Android SDK only skips to a queue id. Apple Music's own
up-next list behaves the same way, so the platforms and the mock all agree.

A module that cannot report a mode leaves it off the snapshot rather than
guessing, and `src/playback.ts` keeps the last value it set.

## Connects to

- `client-app/src/lib/apple-music-auth.tsx` owns the token lifecycle on top of `Auth`.
- `client-app/src/lib/playback.tsx` wraps `Playback`. The native player owns the queue now
  (`playSongQueue`, `appendSongQueue`, `skipToNextEntry`); the provider mirrors it so the UI has
  the track list and the current index.
- `client-app/src/lib/musickit-hooks.ts` wraps `MusicKit` reads in SWR, including
  `useArtist`, `useSongArtists`, `useLibraryArtists`, `useCatalogArtistSearch`,
  `useLibraryArtistSearch`, `usePlaylistMutations`,
  `useCollectionFavoriteStatus`, and `useCollectionInfo`.
- `client-app/src/lib/queue-order.ts` holds the index math the mirror and the
  native players have to agree on.

Nothing outside `client-app/src/lib` should import `@apple-musickit` for data. Use the hooks.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
