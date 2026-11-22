# assistant

The in-app assistant: a chat sheet where the user asks about their tags, songs, and listening in
plain words, or asks it to play something. The backend's model answers by calling Cadenza's own
read functions as tools, and hands the tools only the phone can run (playback, Apple Music,
opening a screen) to the phone. See
`POST /assistant/messages` in
[backend-api/src/routes/README.md](../../../../backend-api/src/routes/README.md) and the
Assistant section of [backend-api/src/services/README.md](../../../../backend-api/src/services/README.md).

## Files

| file                                       | role                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assistant-button.tsx`                     | `AssistantRowButton`, the round button that opens the sheet. The media player host draws it as the bottom row's rightmost control.                                                                                                                                                                                                                                                                                                                                     |
| `assistant-chat.tsx`                       | `AssistantChat`, the sheet: messages, the thinking indicator or a confirm card, error with Retry, and the composer floating on glass at the bottom, over a nebula in the user's accent. Mounts `PlaybackSnapshotBridge`. `app/assistant.tsx` renders it.                                                                                                                                                                                                               |
| `chat-parts.tsx`                           | `MessageRow` (the user's bubble, or the sparkle, the steps pill and the answer), `ConfirmCard`, `ThinkingIndicator`, `ErrorRow`, and `EmptyChat` with its glowing sparkle and suggestion tiles.                                                                                                                                                                                                                                                                        |
| `assistant-ui.tsx`                         | The sheet's glass pieces: `SparkleAvatar`, `IconTile`, `CardButton` (glass, or solid accent), `Hairline`, `Glow`, `useBreathing`, and `withAlpha`.                                                                                                                                                                                                                                                                                                                     |
| `assistant-nebula.ts`                      | `assistantNebulaColors`, the nebula behind the sheet: the accent and two companions turned from its hue. Pure, tested.                                                                                                                                                                                                                                                                                                                                                 |
| `song-results-card.tsx`                    | `SongResultsCard`, the songs a tool found, on glass: a mosaic of the first covers beside the total, Play and Shuffle for all of them, the first five rows, and a button for the rest (closes the sheet; a `run_query` card hands its query to the builder with `useQueryHandoff`, any other opens every card song, up to 250, on `/song-list`). A row plays only that song, now: the song that was playing goes to the top of Up Next, ahead of the rest of the queue. |
| `use-assistant-chat.ts`                    | `useAssistantChat`: `entries`, `sending`, `error`, `confirmation`, `send`, `retry`, `reset`. Runs each `client_tool_call` and posts its result back.                                                                                                                                                                                                                                                                                                                   |
| `phone-tools.ts`                           | `usePhoneTools`, the tools only the phone runs, and `confirmationFor`, which says which ones the user confirms first. Mirrors `backend-api/src/services/assistant/phone_tools.rs`.                                                                                                                                                                                                                                                                                     |
| `playback-snapshot.ts`                     | `PlaybackSnapshotBridge` and `currentPlayback()`: the queue and now playing, read at the moment a tap or a tool runs, without re-rendering on every progress tick.                                                                                                                                                                                                                                                                                                     |
| `assistant-store.ts`                       | The conversation in memory, outside the sheet, so closing and reopening keeps it, and the confirmation waiting for an answer. Per account, gone on restart.                                                                                                                                                                                                                                                                                                            |
| `query-handoff.ts`, `use-query-handoff.ts` | A `run_query` card opened: `prepareHandoff` (pure, tested) turns its query into a builder `load` and its sort, group and limit into the results' arrangement; the hook loads it into the Cadenza drafts as one undo step, leaves the results with `requestQueryResults`, closes the sheet, and switches to the Cadenza tab, which opens the results itself, so Back shows the builder.                                                                                 |
| `action-card.tsx`                          | `ActionCard`, the done card under an answer for each change it made, with Undo while it can still be undone, and `useUndoAndRecord`, which undoes through `POST /assistant/actions/{id}/undo` and updates the card in the chat.                                                                                                                                                                                                                                        |
| `activity-log.tsx`                         | `AssistantActivityLog`, the activity log sheet (`app/assistant-activity.tsx`, opened from the clock in the chat's header): every confirmed change for 30 days, newest first, from `GET /assistant/actions`, with Undo. It lives on the backend, so it outlives the chat.                                                                                                                                                                                               |
| `types.ts`                                 | The request and response shapes, and `ChatEntry`.                                                                                                                                                                                                                                                                                                                                                                                                                      |

## How it works

- Changes (tagging, saved queries, playlists) never run when the model asks. The backend answers
  `pending_action` with a preview, the chat shows it as the same `ConfirmCard` the Apple Music
  tools use, and the answer goes back as `resume: {continuation, output: {confirmed}}`. Only a
  yes makes the backend change anything. The reply's `actions` become `ActionCard`s, and
  `refreshAfterAssistantChanges` (`@/lib/routes/assistant-actions`) refreshes the reads they can
  move. The chat is in memory, but the activity log is not: after a sign out the Undo is still
  in the log.

- Stateless backend: every send posts the whole conversation, plus the phone's time zone and
  local time so "last week" means the right dates, and the query builder's library or tagged
  and suggested tags settings (`query_settings`, from `readQuerySettings`), so a card's songs
  match what the builder would show. An older card can be out of date once they change.
- A `run_query` card carries its `query` (the query, the builder it fits, the settings it ran
  with, and its sort, group and limit). Opening it loads the query into the simple builder,
  or the advanced one when Simple cannot hold it, and opens its results sorted, grouped and
  limited the same way, under the builder's current settings. A query naming a tag the user no
  longer has opens as a plain list instead. Undo in the builder brings the user's own query
  back; the chat has no undo for it yet.
- Sending goes through `useAPIMutation` with no invalidation. It is a one-off request, not a
  cached read, so it is not SWR.
- A reply carries `steps` (folded into a pill beside the sparkle, which lists them when tapped)
  and optional `songs`, which
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
  with a tap. A successful one comes back with a done card too, marked as one Cadenza can't
  undo, since the phone can only add to Apple Music playlists.
- `songs: "card"` reaches the phone as the card's ids; the backend swaps them in.

## Gotchas

- The sheet follows the user's appearance settings: the nebula, the bubbles, the send button and
  the cards' main buttons take the accent, glass takes their glass tint and style, and light,
  dark or a custom background all apply. The user's bubbles are translucent accent, not glass,
  since a long scroll of liquid glass views is costly.
- While an answer is coming, the send button shows Stop, which does nothing yet.
- The composer floats over the list, so the list pads its bottom by the composer's measured
  height. The blur under the composer (iOS only) shows only while some of the list is below the
  bottom edge. Messages rise in only when they arrive with the sheet open, not on reopening.

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
  sheet and navigates there. `cadenza` with `mode` switches the builder to simple or advanced
  first, as navigation, so no draft changes and no undo step is added. The reply still lands in the store. An artist or album id is
  checked with Apple first, so a wrong id is an error the model can fix rather than a page that
  cannot load.
