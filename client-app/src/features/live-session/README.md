# live-session

Live sessions: one host plays, members join, queue songs, and control playback as their role
allows. The backend owns the state; this feature plays it and shows it.

| file                      | role                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live-session-runner.tsx` | `LiveSessionRunner`, mounted once inside `PlaybackProvider`. Finds the caller's session and runs `useSessionPlayer` on it.                                                  |
| `use-session-player.ts`   | Plays the session on this phone: always on the host, on a member only in `synced` mode with full playback. Applies each new snapshot version, and on the host reports back. |
| `session-reconciler.ts`   | Pure. `reconcile` turns the session queue into ops on the local queue, replacing it only when the current song differs. Drift math. Tested.                                 |
| `LiveSessionScreen.tsx`   | The `/live-session/:id` sheet: now playing, transport by role, listen mode, Queue / Requests / People.                                                                      |
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

Gotchas:

- Only catalog songs can be in a session. The host's library only songs are left out when a
  session is seeded.
- With `UIBackgroundModes: audio` the host keeps reporting in the background on iOS. Android
  needs the media service described in `modules/apple-musickit/README.md`.
- Members control the session from its sheet. The global player's buttons drive only the local
  player; on a synced member the session pulls it back.
