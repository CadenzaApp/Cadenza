# live-session

Live sessions: one host plays, members join, queue songs, and control playback as their role
allows. The backend owns the state; this feature plays it and shows it.

| file                          | role                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live-session-runner.tsx`     | `LiveSessionRunner`, mounted once inside `PlaybackProvider`. Runs `useSessionPlayer`, `useSessionSink`, and `useSessionView` on the caller's session.                                                          |
| `use-current-session.ts`      | The open session the caller is in, or null.                                                                                                                                                                    |
| `use-session-player.ts`       | Plays the session on this phone: always on the host, on a member only in `synced` mode with full playback. Applies each new snapshot version, and on the host reports back.                                    |
| `use-session-sink.ts`         | While in a session, sends the app's player commands to it (see below).                                                                                                                                         |
| `use-session-view.ts`         | Where the session does not play on this phone, shows it in the player anyway, and pauses the phone's own music.                                                                                                |
| `session-commands.ts`         | Pure. Tracks to session songs (catalog only), and local queue positions to session entries. Tested.                                                                                                            |
| `session-reconciler.ts`       | Pure. `reconcile` turns the session queue into ops on the local queue, replacing it only when the current song differs. Drift math. Tested.                                                                    |
| `use-seed-session.ts`         | Fills a new session with what the phone plays, starting where the phone is in the current song.                                                                                                                |
| `use-live-badge.ts`           | The caller's session name and id, for the player's LIVE line.                                                                                                                                                  |
| `LiveButton.tsx`              | The player's live icon: asks to go live (with the settings form), or opens the session menu (settings, listen mode, hand over, leave, end).                                                                    |
| `LiveSessionBar.tsx`          | The player sheet's bottom bar in a session: Requests (host, controller, queue editor), People, Add or Suggest, Share (host), as the role allows, the bar only as wide as its buttons. People offers Make host. |
| `RequestsSheet.tsx`           | Requests in a `BottomSheet` over the player: suggestions for every reviewer, join requests for the host, each with a red X and a green check.                                                                  |
| `session-parts.tsx`           | Rows and helpers the two above share.                                                                                                                                                                          |
| `LiveSessionScreen.tsx`       | `/live-session/:id`. Hands an open session to `/player`; says so for one that is over.                                                                                                                         |
| `StartSessionScreen.tsx`      | `/live-session/new`, the Go live sheet, and `?edit=1` for settings. Starts a session, or turns a quiet listen along one regular. Has the Ask me first toggle.                                                  |
| `use-join-request-prompts.ts` | Asks the host in the app about each person waiting to join.                                                                                                                                                    |
| `own-music.ts`                | Marks a leave made to play something else, so the old queue is not put back over it.                                                                                                                           |
| `asked-to-join.ts`            | Sessions the caller asked to join, so being let in shows a "You're in".                                                                                                                                        |
| `JoinScreen.tsx`              | `/join` and `/join/:code`. Redeems a code for a session or a shared playlist.                                                                                                                                  |

The session's screen is the now playing sheet; see the media-player README.

How playback stays in step:

- The server keeps an anchor and projects it forward. Controllers' commands are HTTP calls that
  move the anchor; every member refetches on the realtime event. A play, pause, seek, shuffle
  off, or a repeat change that put no songs back (or a host report that kept the song) sends a
  `playback` event carrying the new playback instead, applied straight to the cached snapshot.
  Every write shows before the server answers, as fast as outside a session:
  `lib/session-optimistic.ts` applies the server's own rules to the cached snapshot (songs added
  get negative ids until the real ones land), the phone applies that guess like any snapshot,
  and a failed write refetches, which puts things back. Anything only the server knows, like
  the song before on Back or a shuffle's new order, waits for it. Shuffle and repeat are held in
  `lib/session-modes.ts` until the answer lands, and dropped at once if it fails.
- The host's phone is the speaker and the source of truth. It reports on song change, play or
  pause, a seek, and every 10 s, and skips re-applying versions its own reports made. It
  never reports a guessed entry; the snapshot with the real id reports it. So the
  host's normal player controls work: they show up in the next report. Each report carries the
  last `command_seq` the phone followed, and the server ignores one older than the latest
  command, so a heartbeat in flight cannot undo a member's seek or back.
- The host's phone changes song, play state, or position only when `playback.command_seq` moved
  (someone steered it). A join or queue edit only lines up the songs after the one it plays.
- `reconcile` lines the phone's queue up in as few native calls as it can: songs added go in as
  one batch, next or at the end, so a whole playlist is one call rather than a redraw per song.
  The provider's queue commands read the queue as the last one left it, so back to back ops do
  not work from a stale copy.
- A synced member follows: queue ops from `reconcile`, play or pause matched, and a seek when
  more than 2 s off, at most every 5 s (a new command seeks at once). Members never report.
- Shuffle and repeat are the session's (`playback.shuffle`, `playback.repeat_mode`), the same
  for everyone. A phone playing the session keeps its own shuffle off and repeats only to loop
  one song; the server shuffles the queue and, on repeat all, puts played songs back.
- A member who stops playing along gets their old queue back, paused.
- The host leaving hands the session to another member, whose phone becomes the speaker. With
  nobody left it ends.

The app's player buttons in a session, through `usePlaybackSink` in `@/lib/playback`:

- On the host, queue changes (play a song, play next, add to queue, move, remove), back,
  shuffle, and repeat go to the session. Play, pause, skip, and seek stay on the phone and reach
  the session in its reports. A back that only restarts the song stays on the phone too.
- On a member, synced or remote, everything goes to the session. Play, pause, skip, seek, back,
  and the modes are locked (`controlsLocked`) unless the role is controller.
- Back follows the same rule as outside a session, decided on the phone: past 4 s it restarts the
  song (the host seeks its own player, anyone else sends `seek` 0), otherwise it sends
  `previous`, which always goes to the last song played. The server never re-decides from its
  projection, which can be seconds off and turned early backs into restarts.
- Playing a song plays it now for a controller or the host, queues it next for a queue editor,
  and suggests it for a suggester. A remote member's player shows the session too, and its
  buttons go to the session the same way.
- `useSessionPlayer` drives the phone with `useLocalPlaybackCommands`, past the sink.

Gotchas:

- Only catalog songs can be in a session. The host's library only songs are left out when a
  session is seeded, and leave the host's queue on the first sync.
- With `UIBackgroundModes: audio` a phone playing the session keeps running in the background on
  iOS, and `useRealtimeInBackground` keeps its socket open there, so the host keeps reporting and
  still hears a member's pause. Once paused, iOS suspends the app soon after, and a play from
  someone else waits until the app opens. Android needs the media service described in
  `modules/apple-musickit/README.md`.
- `use-session-notices.ts` tells members when they are let in, the session ends, or it gets a
  new host.
- Joining without a code asks first while `approve_joins` is on (the default, and the Ask me
  first toggle). The host gets an in-app prompt, a Notifications row with Let in / Not now, and
  the person in Requests. A code always joins at once. There are no phone push notifications
  yet, so a closed app sees the request the next time it opens.
- Playing music opens no session. Listening now shows what a friend plays, and their Join
  (`useJoinListening`) makes a listen along session for them on the spot, seeded with what they
  play, then joins it, asking first. Its `listen_along` flag makes joins check the Listen along
  audience, not the Live sessions one.
- A listen along session nobody is in yet runs quietly: `showsAsLive` keeps the host's player
  out of live mode (no live bar, tag, or red progress). It ends on its own when the host says Not
  now to the last request. Once anyone was let in it went live (`went_live`), and stays live for
  the host after they leave. Going live from the player turns it into a
  regular session (`listen_along: false`).
- Once anyone has joined, a session stays open, and on friends' Listening now row, until the host
  ends it or it runs its course on the server: paused 10 minutes, a minute after the host's app
  was closed (its realtime socket closed, or went quiet while playing), or a host alone in one quiet for 30. Members
  get the `ended` event and the Session ended notice.

More:

- The host's phone follows a command only when `command_seq` goes up, so a snapshot fetched
  before a guess cannot steer it back. Play state goes straight to the player after a queue
  replace, never through a toggle with the old song. A phone playing something the session does
  not have still gets the session's songs queued after it (`hostQueueIds`).
- A host whose phone does not play the session (no full playback) has no local queue, so its
  skip, seek, and tap to play go to the session like a controller's (`useSessionSink`'s
  `playsHere`).
- What a phone that does not play the session shows also counts as that member's listening:
  `useSessionView` feeds it to `usePlayRecorder`, credited to the session. Session songs carry
  album and ids (`trackToSessionSong`, `entryToTrack`), so those plays reach the artist and album
  rankings.
- A member whose app was swiped away leaves after a minute, or after 10 quiet, the way a host's
  session ends. The host can make anyone host from People and stays in as a controller.
- One session at a time. In a session, Listening now's Join with code warns first, and a code
  into another session leaves the current one (`JoinScreen`). A member who cannot control the
  session and plays a song or a list is asked: add it to the session as the role allows, or leave
  and play it here. Leaving that way skips putting their old queue back (`own-music.ts`).
