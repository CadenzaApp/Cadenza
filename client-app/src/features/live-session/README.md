# live-session

Live sessions: one host plays, members join, queue songs, and control playback as their role
allows. The backend owns the state; this feature plays it and shows it.

| file                      | role                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live-session-runner.tsx` | `LiveSessionRunner`, mounted once inside `PlaybackProvider`. Finds the caller's session and runs `useSessionPlayer` and `useSessionSink` on it.                             |
| `use-session-player.ts`   | Plays the session on this phone: always on the host, on a member only in `synced` mode with full playback. Applies each new snapshot version, and on the host reports back. |
| `use-session-sink.ts`     | While the session plays here, sends the app's player commands to the session (see below).                                                                                   |
| `session-commands.ts`     | Pure. Tracks to session songs (catalog only), and local queue positions to session entries. Tested.                                                                         |
| `session-reconciler.ts`   | Pure. `reconcile` turns the session queue into ops on the local queue, replacing it only when the current song differs. Drift math. Tested.                                 |
| `use-seed-session.ts`     | Fills a new session with what the phone plays, starting where the phone is in the current song.                                                                             |
| `listen-along-runner.tsx` | `ListenAlongRunner`, next to the session runner. With Listen along on, playing opens a listener only session. `listen-along.ts` is its pure rule, tested.                   |
| `use-live-badge.ts`       | The caller's session name and id, for the player's LIVE line.                                                                                                               |
| `LiveSessionScreen.tsx`   | The `/live-session/:id` sheet: now playing, transport by role, listen mode, Queue / Requests / People. Editors drag the queue.                                              |
| `StartSessionScreen.tsx`  | `/live-session/new`, and `?edit=id` for settings. Seeds the session with the host's current queue.                                                                          |
| `JoinScreen.tsx`          | `/join` and `/join/:code`. Redeems a code for a session or a shared playlist.                                                                                               |

How playback stays in step:

- The server keeps an anchor and projects it forward. Controllers' commands are HTTP calls that
  move the anchor; every member refetches on the realtime event.
- The host's phone is the speaker and the source of truth. It reports on song change, play or
  pause, a seek, and every 10 s, and skips re-applying versions its own reports made. So the
  host's normal player controls work: they show up in the next report.
- A synced member follows: queue ops from `reconcile`, play or pause matched, and a seek when
  more than 2 s off, at most every 5 s. Members never report.
- A member who stops playing along gets their old queue back, paused.
- The host leaving hands the session to another member, whose phone becomes the speaker. With
  nobody left it ends.

The app's player buttons in a session, through `usePlaybackSink` in `@/lib/playback`:

- On the host, queue changes (play a song, play next, add to queue, move, remove) go to the
  session. Play, pause, skip, and seek stay on the phone and reach the session in its reports.
- On a synced member everything goes to the session. Play, pause, skip, and seek are locked
  (`controlsLocked`) unless the role is controller. Back restarts the song, since a session has
  no history.
- Playing a song plays it now for a controller or the host, queues it next for a queue editor,
  and suggests it for a suggester. A remote member's player stays their own.
- `useSessionPlayer` drives the phone with `useLocalPlaybackCommands`, past the sink.

Gotchas:

- Only catalog songs can be in a session. The host's library only songs are left out when a
  session is seeded, and leave the host's queue on the first sync.
- With `UIBackgroundModes: audio` the host keeps reporting in the background on iOS. Android
  needs the media service described in `modules/apple-musickit/README.md`.
- Listen along opens at most one session per song, so ending one does not reopen it until the
  next song. Its sessions are flagged `listen_along`, so joining them checks the Listen along
  audience, not the Live sessions one.
