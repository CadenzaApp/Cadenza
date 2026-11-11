import { useEffect, useMemo, useRef } from "react";
import { Alert } from "react-native";
import type { MusicItem } from "@apple-musickit";

import {
    useLocalPlaybackCommands,
    usePlayback,
    usePlaybackSink,
    type PlaybackQueue,
    type PlaybackSink,
} from "@/lib/playback";
import {
    MAX_SESSION_ADD,
    sessionCan,
    useLiveSessionWrites,
    type LiveSession,
    type QueueSongBody,
} from "@/lib/routes/live-sessions";

import {
    sessionSongs,
    upcomingEntryAt,
    upcomingPosition,
} from "./session-commands";

function tell(title: string, message: string) {
    Alert.alert(title, message);
}

/**
 * While a live session plays on this phone, the app's player commands go to
 * the session instead of the local player, so every play, queue, and skip
 * button in the app works on the session.
 *
 * On the host only queue changes go to the session. The host's transport
 * stays local: the phone is the speaker, and its reports carry each skip or
 * seek to the session. On a synced member everything goes to the session,
 * and play, pause, skip, and seek are locked unless their role allows them.
 *
 * Songs land as the caller's role allows: played now by a controller, queued
 * by a queue editor, suggested by a suggester. Library only songs are left
 * out, since nobody else could play them.
 */
export function useSessionSink(
    session: LiveSession | null,
    playingHere: boolean,
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

    const role = session?.my_role ?? null;
    const sink = useMemo<PlaybackSink | null>(() => {
        if (!playingHere || role === null) return null;
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
            const songs: QueueSongBody[] = sessionSongs(tracks).slice(
                0,
                MAX_SESSION_ADD,
            );
            if (songs.length === 0) {
                tell(
                    "Live session",
                    "Songs only in your library can't play in a live session.",
                );
                return;
            }
            if (!sessionCan.suggest(role!)) {
                tell("Live session", "Listeners can't add songs.");
                return;
            }
            if (!sessionCan.editQueue(role!)) {
                await run("suggest that", () =>
                    latest.current.writes.addSongs({ songs }),
                );
                tell("Suggested", "The host decides whether it plays.");
                return;
            }
            const playNow = at === "now" && sessionCan.control(role!);
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
                if (!found || !sessionCan.editQueue(role)) return;
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
                if (!found || !sessionCan.editQueue(role)) return;
                await run("remove that song", () =>
                    latest.current.writes.removeEntry(found.entry.entry_id),
                );
            },
        };
        if (isHost) {
            return {
                ...queueCommands,
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

        const canControl = sessionCan.control(role);
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

        return {
            ...queueCommands,
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
            // a session keeps no history, so back restarts the song
            skipToPrevious: () =>
                control("restart the song", () =>
                    send({ kind: "seek", position_ms: 0 }),
                ),
        };
        // the commands read everything else from `latest` at call time
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [local, playingHere, role, session?.session_id]);

    usePlaybackSink(sink);
}
