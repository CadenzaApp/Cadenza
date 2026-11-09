import type { RepeatMode } from "@apple-musickit";

/** The enum's values, so this file needs no runtime import and runs under node tests. */
type Repeat = `${RepeatMode}`;

/**
 * Which queue entry comes after `index`, or null at the end. Entries with no
 * clip are passed over, so a song Apple ships without a preview is never
 * landed on. Follows repeat the way the native player does: one stays on the
 * entry, all wraps to the start.
 */
export function nextPreviewIndex({
    index,
    playable,
    repeatMode,
}: {
    index: number;
    /** Per queue entry, whether it has a clip. */
    playable: readonly boolean[];
    repeatMode: Repeat;
}): number | null {
    if (repeatMode === "one" && playable[index]) return index;

    const length = playable.length;
    for (let step = 1; step <= length; step += 1) {
        const candidate = index + step;
        if (candidate >= length && repeatMode !== "all") return null;
        const wrapped = candidate % length;
        if (playable[wrapped]) return wrapped;
    }
    return null;
}

/** The first entry at or after `index` with a clip, or null. */
export function firstPlayableFrom(
    index: number,
    playable: readonly boolean[],
): number | null {
    for (let candidate = index; candidate < playable.length; candidate += 1) {
        if (playable[candidate]) return candidate;
    }
    return null;
}
