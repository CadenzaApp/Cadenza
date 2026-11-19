import { useEffect } from "react";

import { usePlayback } from "@/lib/playback";

type Playback = ReturnType<typeof usePlayback>;

let latest: Playback | null = null;

/**
 * Keeps `currentPlayback()` up to date while the assistant sheet is open. It
 * renders nothing. Its own re-render on every progress tick is cheap, and it
 * spares the chat and every song card from re-rendering with it.
 */
export function PlaybackSnapshotBridge() {
    const playback = usePlayback();
    useEffect(() => {
        latest = playback;
    }, [playback]);
    return null;
}

/**
 * What is playing and queued as of the last render of
 * `PlaybackSnapshotBridge`, for a tap or a phone tool to read at the moment it
 * runs. Null before the assistant sheet first opens.
 */
export function currentPlayback(): Playback | null {
    return latest;
}
