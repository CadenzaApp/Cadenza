import { useCallback, useEffect, useRef } from "react";

import { useLocalPlaybackState } from "@/lib/playback";
import { useSeedSessionQueue } from "@/lib/routes/live-sessions";

import { sessionSongs, trackToSessionSong } from "./session-commands";

/** The most of the host's own queue a new session starts with. */
const SEED_LIMIT = 50;

/**
 * Fills a session the caller just started with what this phone is playing:
 * the current song and what is after it, catalog songs only. When the
 * current song is one of them, the session starts where the phone is, so the
 * host's phone is not sent back to the top of the song.
 *
 * A failed seed leaves an empty session, which still works; songs can be
 * added from its screen.
 */
export function useSeedSession() {
    const playback = useLocalPlaybackState();
    const { seedSessionQueue } = useSeedSessionQueue();
    const latest = useRef(playback);
    useEffect(() => {
        latest.current = playback;
    });

    return useCallback(
        async (sessionId: string) => {
            const { queue, queueIndex, activeTrack, progress, isPlaying } =
                latest.current;
            const from = Math.max(0, queueIndex);
            const songs = sessionSongs(queue.slice(from, from + SEED_LIMIT));
            if (songs.length === 0) return;
            const current = activeTrack
                ? trackToSessionSong(activeTrack)
                : null;
            const startsHere = current?.song_id === songs[0].song_id;
            try {
                await seedSessionQueue({
                    session_id: sessionId,
                    songs,
                    ...(startsHere
                        ? {
                              start_position_ms: Math.round(progress * 1000),
                              start_playing: isPlaying,
                          }
                        : {}),
                });
            } catch (error) {
                console.warn("Could not seed the session queue:", error);
            }
        },
        [seedSessionQueue],
    );
}
