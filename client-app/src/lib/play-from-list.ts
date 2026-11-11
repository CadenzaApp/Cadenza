import type { MusicItem } from "@apple-musickit";
import { useCallback } from "react";

import type { PlaySource } from "./play-source";
import { usePlaybackCommands, usePlaybackTrackState } from "./playback";

/**
 * Tapping a song in a list, the way Apple Music does it: the whole list is
 * queued and playback starts at that song, so next goes to the song below it
 * and back to the song above it, played or not. Tapping the song already
 * playing plays or pauses it instead.
 *
 * `list` is what the screen shows, in order. A paged list queues what has
 * loaded so far.
 */
export function usePlayFromList() {
    const { playQueue, togglePlayback } = usePlaybackCommands();
    const { activeTrackId } = usePlaybackTrackState();

    return useCallback(
        async (
            list: readonly MusicItem[],
            track: MusicItem,
            source?: PlaySource,
        ) => {
            const startIndex = list.indexOf(track);
            if (track.id === activeTrackId || startIndex < 0) {
                await togglePlayback(track, source);
                return;
            }
            await playQueue({
                tracks: [...list],
                startIndex,
                chosenStart: true,
                source,
            });
        },
        [activeTrackId, playQueue, togglePlayback],
    );
}
