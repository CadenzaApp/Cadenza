# media-player

The global Apple Music player. One instance, mounted outside the navigator, so it survives
navigation. Collapsed it is a bar above the tab bar; expanded it is a full-screen sheet with
artwork, transport, and a swipeable pager between song details and a tag editor.

## Files

| file | role |
| --- | --- |
| `index.ts` | Public surface. Exports `MediaPlayerHost` and nothing else. |
| `media-player-host.tsx` | Decides whether to render at all, based on the current route segment. |
| `media-player.tsx` | Everything else: state, gestures, animation, data wiring, layout. ~690 lines. |
| `compact.tsx` | The collapsed bar. Presentational, all props. |
| `playback-details.tsx` | Expanded view page 1: title, artist, favorite, actions. |
| `tag-editor.tsx` | Expanded view page 2: every tag as a toggle chip. Exports `EditableSongTag`. |
| `transport-controls.tsx` | Play/pause, skip, and the scrubber row. |

## How it works

`MediaPlayerHost` is rendered once in `src/app/_layout.tsx`, as a sibling of `Stack`. It reads
`useSegments()` and returns:

- `(tabs)` -> `<MediaPlayer compactBottomOffset={54} />`, clearing the tab bar
- `tag` -> `<MediaPlayer compactBottomOffset={0} />`
- anything else -> `null`

Playback state is unaffected either way, because it lives in `PlaybackProvider`, not here.

`media-player.tsx` is the only stateful file. It pulls playback from `usePlayback()`, the user's
tags from `useTags()`, and the current song's tags from `useTagsOnSong(activeTrack?.id)`, then
merges them into `EditableSongTag[]` (every tag, each flagged `applied`) for the tag editor.
Toggling a chip calls `useApplyTag` / `useUnapplyTag`, whose invalidation is scoped to that
`song_id`. Favorites go through `useSongFavoriteStatus`, which updates optimistically.

The four sibling files are presentational. They take props and render, and hold no hooks into
`@/lib`. Keep it that way: new state belongs in `media-player.tsx`.

Animation is reanimated shared values driven by gesture-handler. A vertical drag on the sheet
runs `sheetTranslateY`, a horizontal drag inside the expanded view pages between details and the
tag editor via `detailsTranslateX` / `detailsPage`. Progress is interpolated over
`PLAYBACK_PROGRESS_INTERPOLATION_MS` (800ms) so the bar moves smoothly between the 750ms native
snapshot polls, and scrubbing overrides it with `scrubPosition` until release.

## Connects to

- `@/lib/playback::usePlayback` for all transport.
- `@/lib/routes/tags::useTags` and `@/lib/routes/songs` for the tag editor.
- `@/lib/musickit-hooks::useSongFavoriteStatus` for the heart.
- `@apple-musickit::MusicKit` directly for a few native calls.
- Mounted by `src/app/_layout.tsx`.

## Gotchas

- Only `MediaPlayerHost` is exported from `index.ts`. Import the player through the host, not by
  reaching into `media-player.tsx`.
- A new top-level route will not show the player until you add a case to `media-player-host.tsx`.
- `compactBottomOffset` is a hand-tuned `54` for the tab bar. Change the tab bar height and this
  needs to change with it.
- The expanded artwork size is computed by subtracting a stack of magic numbers from the window
  height (see `availableArtworkSize`). Changing the layout means re-deriving those.
- Shuffle, repeat, artist navigation, and queue management render but only log. Not implemented.
- The tag editor lists **all** of the user's tags, not just applied ones, so it grows unbounded
  with the tag count.

---
Touching files in this directory? Update this README in the same change.
See [../../../../../AGENT_GUIDE.md](../../../../../AGENT_GUIDE.md).
