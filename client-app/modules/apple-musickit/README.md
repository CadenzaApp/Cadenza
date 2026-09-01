# Apple MusicKit Expo module

This local Expo module provides Apple Music authorization, catalog and library
lookups, favorites, and native playback on iOS and Android. Web and Expo Go can
import the TypeScript API, but native operations report that the bridge is not
available.

## Consumer API

Import `Auth`, `MusicKit`, `Playback`, and their public types from
`@apple-musickit`.

- `Auth` authorizes the current user and restores or clears native tokens.
- `MusicKit` searches the catalog, reads library pages and playlist tracks, and
  reads or changes song favorite state.
- `Playback` exposes native commands plus React hooks for the shared playback
  snapshot.

Returned `MusicItem` values identify their `resourceKind`, `source`, canonical
`id`, optional `catalogId` and `libraryId`, and required `playbackType`. Library
requests accept `limit` and `offset`; results expose Apple's `next` path when a
later page exists.

Use `Auth.isAvailable()`, `MusicKit.isAvailable()`, or `Playback.isAvailable()`
when rendering a surface that may run on web or in Expo Go.

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
