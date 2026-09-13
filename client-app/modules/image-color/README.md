# image-color

Average color of a remote image, as `#rrggbb`. A local Expo module, imported as
`@image-color`.

It knows nothing about Apple Music, and nothing about what the color is for. It
takes a URL and returns a color, so the surfaces that tint themselves can be
fed from anywhere.

## Consumer API

```ts
import { ImageColor } from "@image-color";

const color = await ImageColor.getAverageColor(artworkUrl); // "#7a3f5e" | null
```

Null, never a throw, for everything that does not produce a color: a blank URL,
a fetch that fails, an undecodable image, fully transparent artwork, or no
native module at all. Expo Go is that last case, so it always returns null
there and the caller renders untinted.

Results are cached by URL on the native side. The average of a given URL cannot
change, so the second call for the same artwork costs nothing.

## Files

| file | role |
| --- | --- |
| `index.ts` | Public surface. This is what `@image-color` resolves to. |
| `src/index.ts` | `ImageColor`, the optional-native wrapper and the hex validation. |
| `ios/ImageColorModule.swift` | Downloads, draws the image into one pixel, reads it back. |
| `android/.../ImageColorModule.kt` | Downloads, subsamples with `inSampleSize`, averages the pixels. |

## How it works

Both platforms do the same two things: fetch the bytes, then reduce them to one
color without ever holding the full image.

iOS draws the whole `CGImage` into a 1x1 `CGContext`. The downsample *is* the
average, so there is no pixel loop. The context is premultiplied, so a partly
transparent result is divided back out before it is returned, or it would come
back darker than the image looks.

Android has no equivalent one-step draw, so it decodes with an `inSampleSize`
that caps the long edge at 64 pixels and averages what comes back, weighting
each pixel by its alpha for the same reason.

## Connects to

- `@/lib/artwork-color` is the only caller. Nothing else in the app imports this
  module: that hook is where Apple's own color and this average are chosen
  between.

## Gotchas

- There is no `expo-image` involvement. This fetches the bytes itself, so a URL
  that only works with custom headers will not work here.
- The cache is per process and unbounded in count. Artwork URLs are finite per
  session, so this has not needed an eviction policy; it would if it were ever
  pointed at arbitrary user images.
- Adding a call means adding it in three places: the native Swift, the native
  Kotlin, and the `ImageColorNativeModule` interface in `src/index.ts`.
- Native changes need a rebuild (`npm run ios` / `npm run android`). A reload
  will not pick them up.

---
Touching files in this directory? Update this README in the same change.
See [../../../AGENT_GUIDE.md](../../../AGENT_GUIDE.md).
