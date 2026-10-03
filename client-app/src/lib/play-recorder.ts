import { useEffect, useRef } from "react";
import type { MusicItem, PlaybackSnapshot } from "@apple-musickit";

import { useListeningEvents } from "./listening-events";
import {
    INITIAL_PLAY_TRACKER_STATE,
    trackPlay,
    type PlayTrackerState,
} from "./play-tracker";
import { trackMetadata } from "./track-metadata";

/**
 * Turns playback into listening events. What counts as what is
 * `play-tracker.ts`; writing them down and sending them is
 * `listening-events.tsx`. Called once, from `PlaybackProvider`, with the
 * snapshot it already polls.
 *
 * `play_counted` events are also what fill in the My Plays, First Played, and
 * Last Played activity tags; the backend does that in the same transaction that
 * stores the event.
 *
 * Only sees what the provider samples, and the provider only polls in the
 * foreground. A song that starts and finishes entirely in the background is not
 * counted, and a listen spanning a background gap is one listen: the tracker
 * keeps its state, so it is neither re-counted nor ended twice.
 */
export function usePlayRecorder(
    snapshot: PlaybackSnapshot,
    activeTrack: MusicItem | null,
) {
    const { recordPlayback } = useListeningEvents();
    const trackerRef = useRef<PlayTrackerState>(INITIAL_PLAY_TRACKER_STATE);

    // tags key on the catalog id, so a library copy and a catalog copy of a song
    // count as the same song
    const songId = activeTrack
        ? (activeTrack.catalogId ?? activeTrack.id)
        : null;

    useEffect(() => {
        const { state, events } = trackPlay(trackerRef.current, {
            songId,
            isPlaying: snapshot.isPlaying,
            progress: snapshot.progress,
            duration: snapshot.duration,
        });
        trackerRef.current = state;
        void recordPlayback(
            events,
            songId,
            activeTrack ? trackMetadata(activeTrack) : null,
        );
    }, [
        activeTrack,
        recordPlayback,
        songId,
        snapshot.isPlaying,
        snapshot.progress,
        snapshot.duration,
    ]);
}
