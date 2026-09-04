# Apple MusicKit Expo module

This local Expo module provides Apple Music authorization, catalog and library
lookups, favorites, and native playback on iOS and Android. A mock implementation
supports frontend development in Expo Go without Apple Music credentials or a
subscription.

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

## Mock mode

Set the following public environment variable before starting Expo:

```sh
EXPO_PUBLIC_MOCK_MUSICKIT=1
```

Mock mode supplies authorization, catalog and library fixtures, paginated
collections, playlist contents, mutable favorite state, queue commands, and
playback snapshots with simulated progress. It does not play audio and does not
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
| `src/AppleMusicKit.types.ts` | `MusicItem`, `AuthResult`, `AuthStatus`, and the rest of the shared types. |
| `src/auth.ts` | Authorization and native token management. |
| `src/library.ts` | Catalog search, library pages, playlist tracks, favorites. |
| `src/playback.ts` | Native playback commands and the playback snapshot hooks. |
| `src/mock-native-module.ts` | The `EXPO_PUBLIC_MOCK_MUSICKIT=1` implementation. Fixtures, paginated collections, simulated progress. |
| `ios/AppleMusicKitModule.swift` | iOS native module. |
| `android/src/main/java/.../AppleMusicKitModule.kt` | Android native module. |
| `expo-module.config.json` | Autolinking config. Picked up via the `expo.autolinking.nativeModulesDir` entry in `client-app/package.json`. |

## Connects to

- `client-app/src/lib/apple-music-auth.tsx` owns the token lifecycle on top of `Auth`.
- `client-app/src/lib/playback.tsx` wraps `Playback` and adds queue tracking.
- `client-app/src/lib/musickit-hooks.ts` wraps `MusicKit` reads in SWR.

Nothing outside `client-app/src/lib` should import `@apple-musickit` for data. Use the hooks.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
