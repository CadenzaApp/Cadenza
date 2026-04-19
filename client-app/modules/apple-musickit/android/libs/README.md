# Apple MusicKit Android SDK

This directory must contain the Apple MusicKit for Android SDK `.aar` file before building.

## How to obtain the SDK

1. Sign in to [developer.apple.com](https://developer.apple.com)
2. Navigate to **More** → **Downloads**
3. Search for **MusicKit for Android**
4. Download the SDK archive and extract it
5. Copy the `.aar` file (e.g. `apple-music-sdk.aar`) into this directory

The `build.gradle` for this module uses:
```groovy
implementation fileTree(dir: 'libs', include: ['*.aar', '*.jar'])
```
so any `.aar` file placed here will be picked up automatically at build time.

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
