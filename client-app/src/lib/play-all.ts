import { ShuffleMode, type MusicItem } from "@apple-musickit";
import { useCallback, useRef, useState } from "react";

import type { PlaySource } from "./play-source";
import { usePlaybackCommands } from "./playback";

type PlayAllOptions = {
    /**
     * The tracks to queue, in order. Async, since a list's queue often reaches
     * past what it has loaded.
     */
    resolveQueue: () => Promise<MusicItem[]>;
    /** What a play from here is credited to in the analytics rankings. */
    source?: PlaySource;
    /** Runs with the song that starts, before it plays. */
    onStart?: (track: MusicItem) => void;
};

/**
 * Play and Shuffle for a whole list. Play queues from the top with shuffle
 * off. Shuffle turns Apple's shuffle on and starts somewhere random. A second
 * tap while the queue resolves is ignored, and `pending` says one is running.
 */
export function usePlayAll({ resolveQueue, source, onStart }: PlayAllOptions) {
    const { playQueue, setShuffleMode } = usePlaybackCommands();
    // a ref rather than state, so two taps in one frame cannot both start
    const running = useRef(false);
    const [pending, setPending] = useState(false);

    const start = useCallback(
        async (shuffle: boolean) => {
            if (running.current) return;
            running.current = true;
            setPending(true);
            try {
                const tracks = await resolveQueue();
                if (tracks.length === 0) return;
                const startIndex = shuffle
                    ? Math.floor(Math.random() * tracks.length)
                    : 0;
                onStart?.(tracks[startIndex]);
                await setShuffleMode(
                    shuffle ? ShuffleMode.Songs : ShuffleMode.Off,
                );
                await playQueue({ tracks, startIndex, source });
            } finally {
                running.current = false;
                setPending(false);
            }
        },
        [onStart, playQueue, resolveQueue, setShuffleMode, source],
    );

    const play = useCallback(() => start(false), [start]);
    const shuffle = useCallback(() => start(true), [start]);
    return { play, shuffle, pending };
}
