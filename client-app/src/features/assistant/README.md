# assistant

The in-app assistant: a chat sheet where the user asks about their tags, songs, and listening in
plain words, or asks it to play something. The backend's model answers by calling Cadenza's own
read functions as tools, and hands the tools only the phone can run (playback, Apple Music,
opening a screen) to the phone. See
`POST /assistant/messages` in
[backend-api/src/routes/README.md](../../../../backend-api/src/routes/README.md) and the
Assistant section of [backend-api/src/services/README.md](../../../../backend-api/src/services/README.md).

## Files

| file                    | role                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assistant-button.tsx`  | `AssistantRowButton`, the round button that opens the sheet. The media player host draws it as the bottom row's rightmost control.                                                                                                                                                                                          |
| `assistant-chat.tsx`    | `AssistantChat`, the sheet: messages, typing dots or a confirm card, error with Retry, and the composer. Mounts `PlaybackSnapshotBridge`. `app/assistant.tsx` renders it.                                                                                                                                                   |
| `chat-parts.tsx`        | `MessageRow`, the step rows above an answer, `ConfirmCard`, `TypingIndicator`, `ErrorRow`, and `EmptyChat` with suggestion chips.                                                                                                                                                                                           |
| `song-results-card.tsx` | `SongResultsCard`, the songs a tool found: the first five rows, the total, Open list (closes the sheet and opens every card song, up to 250, on `/song-list`), and Play and Shuffle for all of them. A row plays only that song, now: the song that was playing goes to the top of Up Next, ahead of the rest of the queue. |
| `use-assistant-chat.ts` | `useAssistantChat`: `entries`, `sending`, `error`, `confirmation`, `send`, `retry`, `reset`. Runs each `client_tool_call` and posts its result back.                                                                                                                                                                        |
| `phone-tools.ts`        | `usePhoneTools`, the tools only the phone runs, and `confirmationFor`, which says which ones the user confirms first. Mirrors `backend-api/src/services/assistant/phone_tools.rs`.                                                                                                                                          |
| `playback-snapshot.ts`  | `PlaybackSnapshotBridge` and `currentPlayback()`: the queue and now playing, read at the moment a tap or a tool runs, without re-rendering on every progress tick.                                                                                                                                                          |
| `assistant-store.ts`    | The conversation in memory, outside the sheet, so closing and reopening keeps it, and the confirmation waiting for an answer. Per account, gone on restart.                                                                                                                                                                 |
| `types.ts`              | The request and response shapes, and `ChatEntry`.                                                                                                                                                                                                                                                                           |

## How it works

- Stateless backend: every send posts the whole conversation, plus the phone's time zone and
  local time so "last week" means the right dates.
- Sending goes through `useAPIMutation` with no invalidation. It is a one-off request, not a
  cached read, so it is not SWR.
- A reply carries `steps` (shown as muted rows above the answer) and optional `songs`, which
  `SongResultsCard` resolves to tracks with `usePagedTracksForSongIds`.
- Each assistant message goes back with its card's `song_ids`, so "those" or "the second one"
  in a follow-up reaches the same songs.
- A `client_tool_call` reply is a tool only the phone runs. `useAssistantChat` runs it with
  `usePhoneTools` and posts the same conversation again with `resume: {continuation, output}`,
  repeating until a `reply` comes (at most 10 tools). The output is JSON for the model; a
  failure is `{ error }`, never a throw. Songs come back as `card`, which the backend makes the
  card under the answer.
- `create_apple_music_playlist` and `add_to_apple_music_playlist` wait for the user: the chat
  shows a `ConfirmCard` in place of the typing dots, and Cancel sends `{ cancelled: true }`.
  Clearing the chat counts as Cancel. Everything else runs straight away, since it can be undone
  with a tap.
- `songs: "card"` reaches the phone as the card's ids; the backend swaps them in.

## Gotchas

- The button uses white sparkles on glass, independent of the account accent. It lives in the shared bottom row, drawn by `media-player-host.tsx`, so it is on every
  screen inside the tabs while the bottom bars show, track or not. It is always the rightmost
  control: a row action (sort, the Tags plus) sits one slot to its left, and both share the
  same lift, scale, and dock (above expanded playback, beside the circle, centered over Search
  on the iOS 26 glass tab bar, expanded or tucked). It hides with the bars (keyboard, focused Search with nothing playing) and
  under the multiselect toolbar.
- Screens with their own bottom controls make room: the Cadenza tag palette pads its heading's
  right side while it is low, and the advanced builder lifts its results and history row one
  control higher.
- The local keyboard hook in `assistant-chat.tsx` lifts the composer by the keyboard's visible height, less any
  height the native sheet already lost to resizing. It captures the resting body height
  before focus and follows keyboard frame changes, including the predictive-text bar.
  It does not compare the sheet's local window origin with keyboard screen coordinates.
- The chat list has `nestedScrollEnabled`, so on Android the sheet lets it scroll first and
  only moves itself once the list is at its top or cannot scroll.
- Shuffle on the song card shuffles the songs itself and starts at the first, with Apple's
  shuffle off, so Up Next lists all of them. `usePlayAll` instead starts at a random song with
  Apple's shuffle on, and Up Next then shows only the songs after it.
- Playing from the song card (a row, Play, or Shuffle) replaces the assistant sheet with the now
  playing sheet once a song starts. The conversation stays in the store.
- Replies are plain text: the prompt tells the model not to use markdown, since nothing renders
  it yet. Markdown support is a planned story.
- `/assistant` is in `SHEET_SEGMENTS` in `lib/screen-overlay.ts`, like the other sheets, so the
  bars stay mounted under it.
- `play` and `queue_songs` take songs, or an Apple Music playlist, an album (its tracks, via
  `getAlbumSongs`), or an artist (their top songs, via `getArtist`) by id.
  `playback` `clear_queue` replaces the queue with only the song playing and seeks back to
  where it was, since MusicKit has no way to drop the rest in place.
- `play` shuffles the list itself, with Apple's shuffle off, like the card's Shuffle.
- Anything that starts playback (`play`, or `queue_songs` with nothing playing) opens the now
  playing sheet: it replaces the assistant sheet when that is on top, and is pushed otherwise,
  in case the chat was closed while the answer ran. The reply still lands in the chat.
  `set_shuffle` turns Apple's shuffle on, the same as the queue's toggle.
- Playback tools refuse while `controlsLocked` (a live session the user cannot control), and
  go through the same commands as a tap otherwise, so a live session's rules apply.
- `open_screen` closes the assistant. A settings sheet, the player, or the player's Tags page
  for the song playing (`/player/tags`) replaces it. A detail screen (tag, saved query, shared
  playlist, Apple Music playlist, artist, album, a song's posts) opens in the tab underneath
  (`useOpenScreen` with `closing: "assistant"`). A tab, or a tab's own screen (friends,
  notifications, friends listening, an Analytics ranking, a Library section), dismisses the
  sheet and navigates there. The reply still lands in the store. An artist or album id is
  checked with Apple first, so a wrong id is an error the model can fix rather than a page that
  cannot load.
