# Apple MusicKit Expo module

This local Expo module provides Apple Music authorization, catalog and library
lookups, favorites, and native playback on iOS and Android. A mock implementation
supports frontend development in Expo Go without Apple Music credentials or a
subscription.

## Consumer API

Import `Auth`, `MusicKit`, `Playback`, and their public types from
`@apple-musickit`.

- `Auth` authorizes the current user and restores or clears native tokens.
- On iOS, authorization requests a fresh music-user token through MusicKit's
  `MusicUserTokenProvider` with cache bypass after the user grants access. The old
  `SKCloudServiceController.requestUserToken` path is deprecated and could return an opaque
  StoreKit client-invalid error after a developer-token change.
- `MusicKit` searches the catalog, reads library pages and playlist tracks,
  reads or changes favorite state for songs, albums, and playlists, writes to
  library playlists, and reads catalog and library artists.
- `Playback` exposes native commands plus React hooks for the shared playback
  snapshot. `setPlaybackEngine(engine)` routes every command to a JS player with
  the same surface (`PlaybackEngine`), like the app's preview player; null goes
  back to native. The old engine is stopped and emptied (`stop()`, queued behind
  commands already sent), so nothing it held plays or comes back later.
  `Playback.stop()` does the same to the current engine. Android cannot empty
  its queue, so after `stop` its snapshot hides the kept item until the next
  queue is prepared.
- `Auth.getSubscription()` says whether the connected account can play full
  songs (`canPlayCatalogContent`). iOS reads `MusicSubscription`; Android cannot
  tell and resolves `{}`.

Catalog reads (`/v1/catalog/...`, and `/v1/storefronts/...`) need only the
developer token, so they work with no user signed in: the user token is sent
when there is one. With no user token the storefront is the device's region if
Apple has a store for it (checked once against `/v1/storefronts`), else `us`.
On iOS catalog search and song
info go through REST instead of MusicKit's own requests. Everything under
`/v1/me` still throws `ERR_MISSING_USER_TOKEN` without one.

Returned `MusicItem` values identify their `resourceKind`, `source`, canonical
`id`, optional `catalogId` and `libraryId`, and required `playbackType`. Catalog
songs also carry `previewUrl` when Apple ships a ~30 second clip; library-only
songs often have none. Topic cards play that clip instead of the full queue.
`isExplicit` is true for a song or album Apple rates explicit, and missing
otherwise. Playlists are never rated.
Library
requests accept `limit` and `offset`; results expose Apple's `next` path when a
later page exists.

Paged reads pass `{ limit, offset }` across the bridge as an options object. On
iOS it arrives as a `Record` (`ios/PageOptions.swift`) so ExpoModulesCore does
the conversion; on Android it is read through `as? Number`. Neither side digs
values out of an untyped dictionary by hand. A JS number reaches native as a
`Double`, so a hand-written `as? Int` misses and the read silently falls back to
its default, which is what made `getLibrarySongs` page forever at offset 0.

`catalogSearch` is the exception: it still takes scalar `limit` and `offset`
arguments at the bridge, flattened before records were adopted here. The public
TypeScript API takes an options object either way.

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

## Silent playback (x86 Android emulators)

Apple's Android player is ARM-only, so it fails on x86 emulators. Set
`EXPO_PUBLIC_MUSICKIT_TARGET=android_studio` in `client-app/.env` to skip native
player commands; everything else works, but no audio plays.

## Platform requirements

- iOS 16.4 or newer, matching the application deployment target.
- Android API 24 or newer with the Apple Music app installed for authorization.
- A current Apple Music developer token and an authorized music-user token.

The application should obtain renewable developer tokens from its backend. Do
not commit a long-lived developer token or its signing key. Persist music-user
tokens with platform-backed secure storage.

## Errors

A 403 from Apple throws `ERR_APPLE_MUSIC_AUTH`: the music-user token is dead,
and a new one fixes it. A 401 throws `ERR_APPLE_MUSIC_DEVELOPER_TOKEN`: the
developer token is dead, which only a new build fixes, so the app does not ask
the user to reconnect for it. Both are apart from the generic
`ERR_APPLE_MUSIC_API`, so the app can tell a dead credential from a bad day at
Apple.

`Auth.refreshUserToken(developerToken)` gets a new music-user token with no
prompt when access is already granted (iOS reads `MusicAuthorization.currentStatus`
and never calls `request()`). Otherwise it resolves the current status. Android
always resolves `unknown`, since a token there needs the Apple Music app's own
screen.

iOS throws `MusicKitException(name:reason:)`, never `Exception(name:description:)`.
ExpoModulesCore renders a thrown exception to JavaScript as `"<name>: <reason>"`,
and the base initializer sets only `description`, leaving `reason` at its
`"undefined reason"` default. Using it swallows the message: every Apple Music
failure arrived in JS as `ERR_APPLE_MUSIC_API: undefined reason` with the status
code and Apple's response body dropped. Android throws its own `MusicKitException(code, message)`,
a `CodedException`, with the same `ERR_` names as iOS. Android `authorize` resolves `failed` with
a reason (for example, no Apple Music app installed) instead of rejecting.

## Validation

From `client-app`:

```sh
npx tsc --noEmit
npx eslint modules/apple-musickit/index.ts modules/apple-musickit/src/*.ts
```

Compile native targets with the `AppleMusicKitModule` Xcode scheme and Gradle's
`:apple-musickit:compileDebugKotlin` task.

## Files

| file                                               | role                                                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                         | Public surface. This is what `@apple-musickit` resolves to.                                                                                           |
| `src/index.ts`                                     | Re-exports `Auth`, `MusicKit`, `Playback`.                                                                                                            |
| `src/AppleMusicKit.types.ts`                       | `MusicItem`, `AuthResult`, `AuthStatus`, `ShuffleMode`, `RepeatMode`, `ArtistItem`, `ArtistResult`, `ArtistDetail`, and the rest of the shared types. |
| `src/auth.ts`                                      | Authorization and native token management.                                                                                                            |
| `src/library.ts`                                   | Catalog search, library pages, album and playlist tracks, favorites, playlist writes, artists.                                                        |
| `src/playback.ts`                                  | Native playback commands and the playback snapshot hooks.                                                                                             |
| `src/mock-native-module.ts`                        | The `EXPO_PUBLIC_MOCK_MUSICKIT=1` implementation. Fixtures, paginated collections, simulated progress.                                                |
| `ios/AppleMusicKitModule.swift`                    | iOS native module, and `MusicKitException`, the error type every iOS throw uses.                                                                      |
| `ios/PageOptions.swift`                            | The `Record` types for paged options, and the limit/offset clamp they share.                                                                          |
| `android/src/main/java/.../AppleMusicKitModule.kt` | Android native module.                                                                                                                                |
| `expo-module.config.json`                          | Autolinking config. Picked up via the `expo.autolinking.nativeModulesDir` entry in `client-app/package.json`.                                         |

## Background playback

Cadenza reads the player while it is in the background too: `PlaybackProvider` polls every
5 s there (750 ms in the foreground), so the play recorder keeps counting plays and the now
playing reporter keeps telling friends what is on. That only works while the OS keeps the app
process running.

- **iOS: done.** `UIBackgroundModes: ["audio"]` in `client-app/app.config.js` keeps the app
  running while `ApplicationMusicPlayer` plays. Tested on a device: lock screen skips, seeks,
  pause and resume all reach the backend within seconds. While paused iOS may suspend the app,
  and pressing play wakes it.
- **Android: not done.** The controller plays inside our process
  (`createLocalController`), but nothing makes that process a foreground service. The manifest
  asks for `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and nothing uses them.
  With the screen off for a while (Doze, or an OEM battery saver) Android can kill the process,
  which stops the music and every report with it. There are also no notification or lock
  screen controls.

### Android task: a media foreground service

Native only. No JS changes: the polling and reporting above already run once the process stays
alive.

1. **One controller, owned outside React.** Today it is a field on `AppleMusicKitModule`,
   built from `appContext.reactContext` and released in `OnDestroy`. Move it into an
   app scoped holder (an `object` built from `applicationContext`, with the token provider
   reading the tokens the module sets) so the module and the service share the same instance.
2. **`MediaPlaybackService`**, declared in this module's `android/src/main/AndroidManifest.xml`
   with `android:foregroundServiceType="mediaPlayback"` and `exported="false"`. It holds a
   `MediaSessionCompat` (add `androidx.media:media` to `android/build.gradle`) whose callback
   maps play, pause, skip next, skip previous, and seek onto the controller.
3. **Keep the session in sync** with `MediaPlayerController.Listener`
   (`controller.addListener`). `onCurrentItemChanged` and `onMetadataUpdated` set the session
   metadata (title, artist, album, artwork, duration), `onPlaybackStateChanged` and
   `onPlaybackStateUpdated` set its state and position. Rebuild the notification from the same
   callbacks.
4. **Foreground lifecycle.** Start the service (`ContextCompat.startForegroundService`) when a
   queue starts playing, and call `startForeground` with a `NotificationCompat.MediaStyle`
   notification inside 5 s. When paused, `stopForeground(STOP_FOREGROUND_DETACH)` so the
   notification stays but the app can be reclaimed, same as iOS. Back to foreground on play.
   `stop` and `OnDestroy` release the controller and `stopSelf`.
5. **Notification permission.** Media session notifications are exempt from Android 13's
   `POST_NOTIFICATIONS` prompt. Confirm the notification shows on 13+ without asking.

**Done when**, on a real ARM device (Apple's player does not run on x86 emulators):

- Lock the phone with a queue playing and leave it 10 minutes. Music keeps playing.
- The backend request log shows a
  `PUT /listening/now-playing` about once a minute and on every song change.
- Skip and pause from the notification and the lock screen. Each one shows a `PUT` within a few
  seconds, and a friend's Listening now card follows.
- Plays made while locked show up in Analytics.

## Library reads

`MusicKit` covers songs, albums, and playlists in the user's library. Every one
of them pages the same way: pass `{ limit, offset }`, read `nextOffset` off the
result, stop when `hasNextPage` is false.

| call                                            | returns                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `getLibrarySongs(options)`                      | Library songs. The only one that accepts `sort`, which is iOS only.                                                                            |
| `getLibraryAlbums(options)`                     | Library albums.                                                                                                                                |
| `getUserPlaylists(options)`                     | Library playlists.                                                                                                                             |
| `getAlbumSongs(albumId, options)`               | The songs on one library album.                                                                                                                |
| `getPlaylistSongs(playlistId, options)`         | The songs in one library playlist. Apple answers 404 for a playlist holding no tracks, which comes back as an empty page rather than an error. |
| `getRecentlyAdded(options)`                     | Recently added library items, newest first. Mixed albums, playlists, and loose songs. Apple caps `limit` at 25.                                |
| `searchLibrarySongs(term, options)`             | Library songs matching a text term. Added after the first dev builds shipped, so a stale binary throws "rebuild the app" rather than crashing. |
| `getLibraryArtists(options)`                    | Library artists. Same stale-binary guard as `searchLibrarySongs`.                                                                              |
| `searchLibraryArtists(term, options)`           | Library artists matching a text term. Same guard.                                                                                              |
| `searchLibraryCollections(term, kind, options)` | Library albums (`kind: "album"`) or playlists (`"playlist"`) matching a text term. Same guard.                                                 |
| `getSongInfo(ids)`                              | Full metadata for song ids, in the order given. Not paged: it takes the ids it is given.                                                       |

Albums and playlists come back as `MusicItem`s with `resourceKind` set to
`"album"` or `"playlist"`, so the same item type describes all three. Pass the
`libraryId` to `getAlbumSongs` and `getPlaylistSongs`; `id` is the catalog
identifier whenever Apple knows of a catalog equivalent, and it is the one to
hand to `setPlaybackQueue`.

`getAlbumSongs` takes either kind of album id. Apple prefixes library ids with a
dot-segment, so a bare numeric id is treated as a catalog album and read from the
catalog path instead. That is what a song's `albumID` is.

`getSongInfo` is the id-to-song resolver. It splits the ids by shape, reads the
library ones from the library and the catalog ones from the catalog, and puts the
answers back in the requested order. An id nothing came back for is left out
rather than erroring. It indexes each song under its `id`, `catalogId`, and
`libraryId`, so a caller holding either kind of id finds the song. The ids are
deduplicated and sent 25 at a time, 6 requests at once, because Apple's
`?ids=` endpoints take a bounded list and a caller may hand over a whole query
result.

A library song carries a `catalogId` only when Apple resolves one for it. On iOS
that resolution is a best-effort REST call layered over the native library read,
so the same song can be seen with a catalog id on one read and only its library
id on another. Anything that stores a song id, or matches one against a track,
has to tolerate both. `getSongInfo` is what makes that tolerable.

## Playlist writes

| call                                  | does                                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| `addSongsToPlaylist(playlistId, ids)` | Appends catalog songs to a library playlist.                |
| `createPlaylist(name, ids)`           | Creates a library playlist and returns it as a `MusicItem`. |

Both go through the Apple Music HTTP API on both platforms rather than through
either native SDK, because neither SDK edits playlists. Library-only song ids
are resolved to their catalog equivalent first; Apple rejects the request
otherwise.

## Favorites and collection info

| call                                                                                          | does                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSongFavoriteStatus(id)` / `setSongFavoriteStatus(id, isFavorite)`                         | Reads or writes a song's favorite state.                                                                                                                                              |
| `getCollectionFavoriteStatus(kind, id)` / `setCollectionFavoriteStatus(kind, id, isFavorite)` | The same, for an album or playlist. `kind` is `"albums"` or `"playlists"`, matching the Apple Music API path segment directly rather than the app's singular `LibraryCollectionKind`. |
| `getCollectionInfo(kind, ids)`                                                                | Metadata (title, artwork, `shareUrl`) for the album or playlist itself, mirroring `getSongInfo`.                                                                                      |

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

| call                                        | returns                                                      |
| ------------------------------------------- | ------------------------------------------------------------ |
| `getSongArtists(songId)`                    | Catalog artist ids credited on a song, most prominent first. |
| `getArtist(artistId)`                       | An `ArtistDetail`: name, artwork, genres, top songs, albums. |
| `getLibraryArtists(options)`                | A page of `ArtistItem`s from the user's library.             |
| `searchLibraryArtists(term, options)`       | Library artists matching a term.                             |
| `catalogSearch(term, ["artists"], options)` | Catalog artists, on `SearchResult.artists`.                  |

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

| call                                           | does                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `playSongQueue(tracks, startIndex)`            | Replaces the queue and plays.                                                 |
| `appendSongQueue(tracks)`                      | Adds to the end.                                                              |
| `insertSongsNext(tracks)`                      | Adds directly after the playing entry.                                        |
| `moveQueueItem(from, to)`                      | Reorders. The playing entry keeps playing.                                    |
| `removeQueueItem(index)`                       | Drops one entry.                                                              |
| `playQueueItem(index)`                         | Jumps to an entry.                                                            |
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
