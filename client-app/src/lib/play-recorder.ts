import { useEffect, useMemo, useRef } from "react";
import type { MusicItem, PlaybackSnapshot } from "@apple-musickit";

import { useListeningEvents } from "./listening-events";
import { useSongInfo } from "./musickit-hooks";
import type { PlaySource } from "./play-source";
import {
    INITIAL_PLAY_TRACKER_STATE,
    trackPlay,
    type PlayTrackerState,
} from "./play-tracker";
import { trackMetadata, withCatalogIds } from "./track-metadata";

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
 * `source` is the playlist or query the active track was queued from, or null.
 * The provider decides it, since only it knows what each queue started with.
 *
 * Only sees what the provider samples. It polls in the background too, every
 * few seconds, for as long as iOS keeps the app running there. Whatever plays
 * after the app is suspended is not counted, and a listen spanning that gap is
 * one listen: the tracker keeps its state, so it is neither re-counted nor
 * ended twice.
 */
export function usePlayRecorder(
    snapshot: PlaybackSnapshot,
    activeTrack: MusicItem | null,
    source: PlaySource | null,
) {
    const { recordPlayback } = useListeningEvents();
    const trackerRef = useRef<PlayTrackerState>(INITIAL_PLAY_TRACKER_STATE);

    // tags key on the catalog id, so a library copy and a catalog copy of a song
    // count as the same song
    const songId = activeTrack
        ? (activeTrack.catalogId ?? activeTrack.id)
        : null;

    // a queued track often carries no artist or album id, depending on the
    // list it came from, so the song is looked up once to fill them in. The
    // artist and album rankings open what these ids point at
    const lookupIds = useMemo(() => (songId ? [songId] : []), [songId]);
    const { songInfo } = useSongInfo(lookupIds);
    const catalog = songInfo.find(
        (song) => song.id === songId || song.catalogId === songId,
    );
    const recordedTrack = useMemo(
        () => (activeTrack ? withCatalogIds(activeTrack, catalog) : null),
        [activeTrack, catalog],
    );

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
            recordedTrack ? trackMetadata(recordedTrack, source) : null,
        );
    }, [
        recordedTrack,
        recordPlayback,
        source,
        songId,
        snapshot.isPlaying,
        snapshot.progress,
        snapshot.duration,
    ]);
}
