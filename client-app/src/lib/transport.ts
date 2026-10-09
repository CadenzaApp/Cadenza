import type { RepeatMode } from "@apple-musickit";

/**
 * Pure decisions behind the back and forward buttons, so the provider only
 * carries them out.
 */

/** Past this many seconds in, back restarts the song instead of leaving it. */
export const RESTART_THRESHOLD_SECONDS = 4;

type TransportPosition = {
    /** Position of the playing entry in the queue. -1 when unknown. */
    index: number;
    /** Entries in the queue. */
    length: number;
};

/**
 * What back does: restart the song once it has played a few seconds, or with
 * nothing before it. Otherwise go to the previous entry.
 */
export function previousAction({
    index,
    progress,
}: Pick<TransportPosition, "index"> & { progress: number }) {
    if (progress > RESTART_THRESHOLD_SECONDS || index <= 0) return "restart";
    return "previous";
}

/**
 * What forward does. With an entry after this one it always goes there,
 * whatever the repeat mode. At the end of the queue:
 * - repeat one, or repeat all on a one song queue: replay this song
 * - repeat all: wrap to the first entry
 * - repeat off: back to the start of this song, paused
 */
export function nextAction({
    index,
    length,
    repeatMode,
}: TransportPosition & { repeatMode: `${RepeatMode}` }) {
    if (index >= 0 && index < length - 1) return "next";
    if (repeatMode === "all" && length > 1) return "wrap";
    if (repeatMode === "off") return "rewind";
    return "replay";
}
