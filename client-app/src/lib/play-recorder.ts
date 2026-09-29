import { useEffect, useRef } from "react";
import type { MusicItem, PlaybackSnapshot } from "@apple-musickit";

import { useAccount } from "./account";
import {
    INITIAL_PLAY_TRACKER_STATE,
    trackPlay,
    type PlayTrackerState,
} from "./play-tracker";
import { useRecordPlay } from "./routes/songs";

/**
 * Watches playback and tells the backend about each play, which is what fills
 * in the My Plays, First Played and Last Played activity tags. What counts as a
 * play is `play-tracker.ts`. Called once, from `PlaybackProvider`, with the
 * snapshot it already polls.
 *
 * Only sees what the provider samples, and the provider only polls while the
 * app is in the foreground. A song that starts and finishes entirely in the
 * background is not counted.
 */
export function usePlayRecorder(
    snapshot: PlaybackSnapshot,
    activeTrack: MusicItem | null,
) {
    const { account } = useAccount();
    const { recordPlay } = useRecordPlay();
    const stateRef = useRef<PlayTrackerState>(INITIAL_PLAY_TRACKER_STATE);
    // tags key on the catalog id, so a library copy and a catalog copy of a
    // song count as the same song
    const songId = activeTrack
        ? (activeTrack.catalogId ?? activeTrack.id)
        : null;
    const signedIn = account != null;

    useEffect(() => {
        const { state, countedSongId } = trackPlay(stateRef.current, {
            songId,
            isPlaying: snapshot.isPlaying,
            progress: snapshot.progress,
            duration: snapshot.duration,
        });
        stateRef.current = state;

        if (!countedSongId || !signedIn) return;
        void (async () => {
            try {
                await recordPlay({ song_id: countedSongId });
            } catch (error) {
                console.warn("Failed to record a play:", error);
            }
        })();
    }, [
        songId,
        signedIn,
        snapshot.isPlaying,
        snapshot.progress,
        snapshot.duration,
        recordPlay,
    ]);
}
