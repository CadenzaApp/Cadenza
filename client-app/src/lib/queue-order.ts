/**
 * Pure index math for the playback queue mirror.
 *
 * The native player owns the real queue; `PlaybackProvider` keeps a mirror of
 * it so the UI can render richer metadata than native hands back. Every
 * mutation therefore happens twice, once natively and once here, and the two
 * have to land on the same order and the same playing entry. Keeping that math
 * in one pure place is what makes them comparable, and testable.
 *
 * Indices address the whole queue, not the upcoming slice, because that is what
 * the native calls take.
 */

export type QueueState<T> = {
    items: T[];
    /** Position of the entry that is playing. -1 when nothing is. */
    index: number;
};

/** True for a position that addresses a real entry. */
export function isQueuePosition<T>(state: QueueState<T>, index: number) {
    return (
        Number.isInteger(index) && index >= 0 && index < state.items.length
    );
}

/**
 * Moves one entry. The entry that is playing keeps playing, so the index
 * follows it rather than staying put.
 */
export function moveQueueEntry<T>(
    state: QueueState<T>,
    from: number,
    to: number,
): QueueState<T> {
    if (!isQueuePosition(state, from) || !isQueuePosition(state, to)) {
        return state;
    }
    if (from === to) return state;

    const items = [...state.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);

    let index = state.index;
    if (from === index) index = to;
    else if (from < index && to >= index) index -= 1;
    else if (from > index && to <= index) index += 1;

    return { items, index };
}

/** Drops one entry, keeping the playing one playing where possible. */
export function removeQueueEntry<T>(
    state: QueueState<T>,
    target: number,
): QueueState<T> {
    if (!isQueuePosition(state, target)) return state;

    const items = [...state.items];
    items.splice(target, 1);

    let index = state.index;
    if (target < index) index -= 1;
    if (items.length === 0) index = -1;
    else index = Math.max(0, Math.min(index, items.length - 1));

    return { items, index };
}

/** Inserts entries directly after the playing one. */
export function insertQueueEntriesNext<T>(
    state: QueueState<T>,
    entries: readonly T[],
): QueueState<T> {
    if (entries.length === 0) return state;

    const items = [...state.items];
    items.splice(state.index + 1, 0, ...entries);
    return { items, index: state.index };
}

/**
 * Jumps to an entry. Skipping forward discards what was skipped over, which is
 * what Apple Music's up-next list does and what the native players do, since
 * neither exposes a way to move the cursor without consuming the queue.
 */
export function jumpToQueueEntry<T>(
    state: QueueState<T>,
    target: number,
): QueueState<T> {
    if (!isQueuePosition(state, target) || target === state.index) return state;
    if (target < state.index) return { items: [...state.items], index: target };

    const items = [...state.items];
    items.splice(state.index + 1, target - state.index - 1);
    return { items, index: state.index + 1 };
}

/**
 * Resolves where a track sits, preferring the position nearest the one already
 * known. A queue holding the same song twice otherwise always resolves to the
 * first copy, which strands the index behind as soon as the second copy plays.
 */
export function nearestQueuePosition<T>(
    items: readonly T[],
    from: number,
    matches: (item: T) => boolean,
): number {
    if (items.length === 0) return -1;

    const start = Math.max(0, Math.min(from, items.length - 1));
    if (matches(items[start])) return start;

    for (let distance = 1; distance < items.length; distance++) {
        const after = start + distance;
        if (after < items.length && matches(items[after])) return after;
        const before = start - distance;
        if (before >= 0 && matches(items[before])) return before;
    }
    return -1;
}
