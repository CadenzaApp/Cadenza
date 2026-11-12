# assistant

The in-app assistant: a chat sheet where the user asks about their tags, songs, and listening in
plain words. The backend's model answers by calling Cadenza's own read functions as tools. See
`POST /assistant/messages` in
[backend-api/src/routes/README.md](../../../../backend-api/src/routes/README.md) and the
Assistant section of [backend-api/src/services/README.md](../../../../backend-api/src/services/README.md).

## Files

| file                    | role                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `assistant-button.tsx`  | `AssistantRowButton`, the round button that opens the sheet. The media player host draws it as the bottom row's rightmost control. |
| `assistant-chat.tsx`    | `AssistantChat`, the sheet: messages, typing dots, error with Retry, and the composer. `app/assistant.tsx` renders it.             |
| `chat-parts.tsx`        | `MessageRow`, the step rows above an answer, `TypingIndicator`, `ErrorRow`, and `EmptyChat` with suggestion chips.                 |
| `song-results-card.tsx` | `SongResultsCard`, the songs a tool found: the first five rows, how many more, Play and Shuffle for all of them.                   |
| `use-assistant-chat.ts` | `useAssistantChat`: `entries`, `sending`, `error`, `send`, `retry`, `reset`.                                                       |
| `assistant-store.ts`    | The conversation in memory, outside the sheet, so closing and reopening keeps it. Per account, gone on restart.                    |
| `types.ts`              | The request and response shapes, and `ChatEntry`.                                                                                  |

## How it works

- Stateless backend: every send posts the whole conversation, plus the phone's time zone and
  local time so "last week" means the right dates.
- Sending goes through `useAPIMutation` with no invalidation. It is a one-off request, not a
  cached read, so it is not SWR.
- A reply carries `steps` (shown as muted rows above the answer) and optional `songs`, which
  `SongResultsCard` resolves to tracks with `usePagedTracksForSongIds`.

## Gotchas

- The button lives in the shared bottom row, drawn by `media-player-host.tsx`, so it is on every
  screen inside the tabs while the bottom bars show, track or not. It is always the rightmost
  control: a row action (sort, the Tags plus) sits one slot to its left, and both share the
  same lift, scale, and dock (above expanded playback, beside the circle, over Search when the
  player tucks). It hides with the bars (keyboard, focused Search with nothing playing) and
  under the multiselect toolbar.
- Screens with their own bottom controls make room: the Cadenza tag palette pads its heading's
  right side while it is low, and the advanced builder lifts its results and history row one
  control higher.
- The composer measures how far the keyboard covers the sheet and pads by that much, on both
  platforms. Neither moves a native sheet for the keyboard: `KeyboardAvoidingView` does not see
  an iOS sheet's frame, and react-native-screens leaves a one-detent Android sheet in place.
- Playing from the song card (a row, Play, or Shuffle) replaces the assistant sheet with the now
  playing sheet once a song starts. The conversation stays in the store.
- Replies are plain text: the prompt tells the model not to use markdown, since nothing renders
  it yet. Markdown support is a planned story.
- `/assistant` is in `SHEET_SEGMENTS` in `lib/screen-overlay.ts`, like the other sheets, so the
  bars stay mounted under it.
- A `client_tool_call` response (phone-side tools like playback) is typed but not handled yet;
  the hook answers it with a short "can't do that yet" message.
