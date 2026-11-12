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
import {
    MAX_SESSION_ADD,
    useLiveSessionWrites,
    type LiveSession,
    type QueueSongBody,
} from "@/lib/routes/live-sessions";
import { RESTART_THRESHOLD_SECONDS } from "@/lib/transport";

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
 * On the host, queue changes, back, shuffle, and repeat go to the session,
 * since only the session knows what played before. Play, pause, skip, and seek
 * stay local: the phone is the speaker, and its reports carry them to the
 * session. On a member, synced or
 * remote, everything goes to the session, and play, pause, skip, seek, and
 * the modes are locked unless their role allows them.
 *
 * Songs land as the caller's role allows: played now by a controller, queued
 * by a queue editor, suggested by a suggester. Library only songs are left
 * out, since nobody else could play them.
 */
export function useSessionSink(session: LiveSession | null) {
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
    const sink = useMemo<PlaybackSink | null>(() => {
        if (role === null || !permissions) return null;
        const can = permissions;
        const isHost = role === "host";

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

        const sessionCommands: PlaybackSink = {
            ...queueCommands,
            skipToPrevious: () =>
                control("go back", () => send({ kind: "previous" })),
            setShuffleMode: (mode) =>
                control("change shuffle", () =>
                    send({ kind: "shuffle", on: mode !== ShuffleMode.Off }),
                ),
            setRepeatMode: (mode) =>
                control("change repeat", () =>
                    send({ kind: "repeat", mode: sessionRepeat(mode) }),
                ),
        };

        if (isHost) {
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
                        await sessionCommands.skipToPrevious!();
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
            playQueueItem: async (index) => {
                const found = entryAt(index);
                if (!found) return;
                await control("play that song", () =>
                    send({ kind: "jump", entry_id: found.entry.entry_id }),
                );
            },
            togglePlayback: async (track) => {
                const { session, playback } = latest.current;
                if (playback.activeTrackId !== track.id) {
                    await add([track], "now");
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
    }, [local, role, session?.session_id]);

    usePlaybackSink(sink);
}
