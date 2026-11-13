import { useEffect, useMemo, useRef } from "react";
import { Alert } from "react-native";
import { RepeatMode, ShuffleMode, type MusicItem } from "@apple-musickit";

import {
    useLocalPlaybackCommands,
    usePlayback,
    usePlaybackSink,
    type PlaybackQueue,
    type PlaybackSink,
} from "@/lib/playback";
import { invalidateAPIData } from "@/lib/api-actions";
import {
    MAX_SESSION_ADD,
    useLiveSessionWrites,
    type LiveSession,
    type QueueSongBody,
} from "@/lib/routes/live-sessions";
import { serverNow } from "@/lib/realtime";
import { playbackPositionMs } from "@/lib/session-playback";
import { RESTART_THRESHOLD_SECONDS } from "@/lib/transport";

import { clearLeavingForOwnMusic, markLeavingForOwnMusic } from "./own-music";
import {
    sessionSongs,
    upcomingEntryAt,
    upcomingPosition,
} from "./session-commands";

function tell(title: string, message: string) {
    Alert.alert(title, message);
}

/** The native mode as the session spells it. */
function sessionRepeat(mode: RepeatMode) {
    return mode === RepeatMode.One
        ? "one"
        : mode === RepeatMode.All
          ? "all"
          : "off";
}

/**
 * While the caller is in a live session, the app's player commands go to the
 * session instead of the local player, so every play, queue, and skip button
 * in the app works on the session.
 *
 * On a host whose phone plays the session (`playsHere`), queue changes,
 * back, shuffle, and repeat go to the session, since only the session knows
 * what played before. Play, pause, skip, and seek stay local: the phone is
 * the speaker, and its reports carry them to the session. A host whose phone
 * does not play it (no full playback) has nothing local to skip in, so
 * everything goes to the session, as for a controller. On a member, synced
 * or remote, everything goes to the session, and play, pause, skip, seek,
 * and the modes are locked unless their role allows them.
 *
 * Songs land as the caller's role allows: played now by a controller, queued
 * by a queue editor, suggested by a suggester. Library only songs are left
 * out, since nobody else could play them.
 *
 * Playing something (a song, or a list from a song) as a member who cannot
 * control the session would be playing outside it, so it asks first: add it
 * to the session as the role allows, or leave the session and play it here.
 */
export function useSessionSink(
    session: LiveSession | null,
    playsHere: boolean,
) {
    const playback = usePlayback();
    const local = useLocalPlaybackCommands();
    const writes = useLiveSessionWrites(session?.session_id ?? "none");

    // the commands read these at call time, so the sink only changes with
    // the role
    const latest = useRef({ session, playback, writes });
    useEffect(() => {
        latest.current = { session, playback, writes };
    });

    // permissions follow the role, so the role keys the sink
    const role = session?.my_role ?? null;
    const permissions = session?.can;
    // the phone is the speaker only on a host that plays it
    const hostSpeaker = role === "host" && playsHere;
    const sink = useMemo<PlaybackSink | null>(() => {
        if (role === null || !permissions) return null;
        const can = permissions;

        async function run(what: string, write: () => Promise<unknown>) {
            try {
                await write();
            } catch (error) {
                console.warn(`Could not ${what} in the live session:`, error);
                tell("Live session", `Couldn't ${what}.`);
            }
        }

        /** Adds songs as far as the role allows, saying so when it is not obvious. */
        async function add(
            tracks: readonly MusicItem[],
            at: "now" | "next" | "end",
        ) {
            const shareable = sessionSongs(tracks);
            const songs: QueueSongBody[] = shareable.slice(0, MAX_SESSION_ADD);
            const trimmed = shareable.length > songs.length;
            if (songs.length === 0) {
                tell(
                    "Live session",
                    "Songs only in your library can't play in a live session.",
                );
                return;
            }
            if (!can.suggest) {
                tell("Live session", "Listeners can't add songs.");
                return;
            }
            if (!can.edit_queue) {
                await run("suggest that", () =>
                    latest.current.writes.addSongs({ songs }),
                );
                tell("Suggested", "The host decides whether it plays.");
                return;
            }
            const playNow = at === "now" && can.control;
            await run("add those songs", () =>
                latest.current.writes.addSongs({
                    songs,
                    ...(playNow
                        ? { play_now: true }
                        : at === "end"
                          ? {}
                          : { position: 0 }),
                }),
            );
            if (trimmed) {
                tell(
                    "Live session",
                    `Added the first ${MAX_SESSION_ADD} songs. One add takes at most ${MAX_SESSION_ADD}.`,
                );
            }
        }

        function entryAt(index: number) {
            const { session, playback } = latest.current;
            return session
                ? upcomingEntryAt(session, playback.queueIndex, index)
                : null;
        }

        const queueCommands: PlaybackSink = {
            playQueue: ({ tracks, startIndex = 0 }: PlaybackQueue) =>
                add(tracks.slice(Math.max(0, startIndex)), "now"),
            addToQueue: (tracks) => add(tracks, "end"),
            playNext: (tracks) => add(tracks, "next"),
            moveQueueItem: async (from, to) => {
                const found = entryAt(from);
                if (!found || !can.edit_queue) return;
                const position = upcomingPosition(
                    latest.current.playback.queueIndex,
                    to,
                );
                await run("move that song", () =>
                    latest.current.writes.moveEntry(
                        found.entry.entry_id,
                        position,
                    ),
                );
            },
            removeQueueItem: async (index) => {
                const found = entryAt(index);
                if (!found || !can.edit_queue) return;
                await run("remove that song", () =>
                    latest.current.writes.removeEntry(found.entry.entry_id),
                );
            },
        };
        const canControl = can.control;
        async function control(what: string, write: () => Promise<unknown>) {
            if (!canControl) {
                tell("Live session", "Only controllers can change playback.");
                return;
            }
            await run(what, write);
        }
        const send: ReturnType<typeof useLiveSessionWrites>["sendPlayback"] = (
            body,
        ) => latest.current.writes.sendPlayback(body);

        /** Leaves the session, then plays on the phone with `playOwn`. */
        async function leaveAndPlay(playOwn: () => Promise<void>) {
            markLeavingForOwnMusic();
            try {
                await latest.current.writes.leaveSession();
                // gone before anything plays, so the session player lets go
                await invalidateAPIData([{ path: "/live-sessions/current" }]);
            } catch (error) {
                clearLeavingForOwnMusic();
                console.warn("Could not leave the live session:", error);
                tell("Live session", "Couldn't leave the session.");
                return;
            }
            await playOwn();
        }

        /**
         * For a member who cannot control the session: playing `tracks`
         * would be outside it, so this asks whether to add them to the
         * session instead, or leave it and play them.
         */
        function offerOwnMusic(
            tracks: readonly MusicItem[],
            playOwn: () => Promise<void>,
        ) {
            const name = latest.current.session?.name ?? "the live session";
            const instead = can.edit_queue
                ? "Add to session"
                : can.suggest
                  ? "Suggest it"
                  : null;
            Alert.alert(
                "Leave your live session?",
                `Playing this yourself takes you out of ${name}.`,
                [
                    { text: "Cancel", style: "cancel" },
                    ...(instead
                        ? [
                              {
                                  text: instead,
                                  onPress: () => void add(tracks, "next"),
                              },
                          ]
                        : []),
                    {
                        text: "Leave and play",
                        style: "destructive" as const,
                        onPress: () => void leaveAndPlay(playOwn),
                    },
                ],
            );
        }

        const sessionCommands: PlaybackSink = {
            ...queueCommands,
            // the same rule as outside a session: a few seconds in, back
            // restarts the song, else it goes to the song before. decided
            // here, from where the session is, and sent as one or the other
            skipToPrevious: () => {
                const live = latest.current.session;
                const at = live
                    ? playbackPositionMs(live.playback, serverNow())
                    : 0;
                return at > RESTART_THRESHOLD_SECONDS * 1000
                    ? control("restart the song", () =>
                          send({ kind: "seek", position_ms: 0 }),
                      )
                    : control("go back", () => send({ kind: "previous" }));
            },
            setShuffleMode: (mode) =>
                control("change shuffle", () =>
                    send({ kind: "shuffle", on: mode !== ShuffleMode.Off }),
                ),
            setRepeatMode: (mode) =>
                control("change repeat", () =>
                    send({ kind: "repeat", mode: sessionRepeat(mode) }),
                ),
        };

        if (hostSpeaker) {
            return {
                ...sessionCommands,
                // a restart is quicker on the phone, and its report tells
                // the session
                skipToPrevious: async () => {
                    if (
                        latest.current.playback.progress >
                        RESTART_THRESHOLD_SECONDS
                    ) {
                        await local.seekTo(0);
                    } else {
                        // the phone's own position decided it, so straight
                        // to the song before
                        await control("go back", () =>
                            send({ kind: "previous" }),
                        );
                    }
                },
                // a new song would replace the phone's queue, so it goes
                // through the session; play or pause stays on the phone
                togglePlayback: async (track, source) => {
                    if (latest.current.playback.activeTrackId === track.id) {
                        await local.togglePlayback(track, source);
                    } else {
                        await add([track], "now");
                    }
                },
            };
        }

        return {
            ...sessionCommands,
            controlsLocked: !canControl,
            // a controller plays it in the session; anyone else is asked
            playQueue: async (queue) => {
                if (canControl) {
                    await sessionCommands.playQueue!(queue);
                    return;
                }
                offerOwnMusic(
                    queue.tracks.slice(Math.max(0, queue.startIndex ?? 0)),
                    () => local.playQueue(queue),
                );
            },
            playQueueItem: async (index) => {
                const found = entryAt(index);
                if (!found) return;
                await control("play that song", () =>
                    send({ kind: "jump", entry_id: found.entry.entry_id }),
                );
            },
            togglePlayback: async (track, source) => {
                const { session, playback } = latest.current;
                if (playback.activeTrackId !== track.id) {
                    if (canControl) await add([track], "now");
                    else
                        offerOwnMusic([track], () =>
                            local.togglePlayback(track, source),
                        );
                    return;
                }
                const playing = session?.playback.is_playing ?? false;
                await control(playing ? "pause" : "play", () =>
                    send({ kind: playing ? "pause" : "play" }),
                );
            },
            seekTo: (time) =>
                control("seek", () =>
                    send({
                        kind: "seek",
                        position_ms: Math.max(0, Math.round(time * 1000)),
                    }),
                ),
            skipToNext: () => control("skip", () => send({ kind: "next" })),
        };
        // the commands read everything else from `latest` at call time
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hostSpeaker, local, role, session?.session_id]);

    usePlaybackSink(sink);
}
