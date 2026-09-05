# Apple MusicKit Android SDK

This directory contains the two Apple MusicKit for Android SDK artifacts used by
the Expo module:

- `mediaplayback-release-1.1.1.aar`
- `musickitauth-release-1.1.2.aar`

Their paths and versions are declared explicitly in `expo-module.config.json`.
When upgrading the SDK, replace both files together, update that configuration,
and compile the module for every supported Android ABI.

## How to obtain the SDK

1. Sign in to [developer.apple.com](https://developer.apple.com)
2. Navigate to **More** → **Downloads**
3. Search for **MusicKit for Android**
4. Download the SDK archive and extract it
5. Copy the authentication and media-playback `.aar` files into this directory.

The module also includes local AARs from this directory through:
```groovy
implementation fileTree(dir: 'libs', include: ['*.aar'])
```
Keep unrelated AARs out of this directory.

## Developer Token requirement

The Android MusicKit SDK requires a **developer token** — a signed JWT — passed to
`AuthenticationManager.createIntentBuilder(developerToken)`.

To generate one:

1. In the Apple Developer portal, go to **Keys** and create a new key with the
   **Media Services (MusicKit)** capability enabled.
2. Download the `.p8` private key file.
3. Sign a JWT on your **backend server** using:
   - `alg: ES256`
   - `kid`: your 10-character Key ID
   - `iss`: your 10-character Team ID
   - `iat`: current Unix timestamp
   - `exp`: expiry (max 6 months from `iat`)
4. Return that signed JWT to your app at runtime — **never hardcode it in client code**.

See [Apple's documentation](https://developer.apple.com/documentation/applemusicapi/generating_developer_tokens)
for the full token generation guide.
