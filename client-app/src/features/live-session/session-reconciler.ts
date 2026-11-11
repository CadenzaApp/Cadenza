/**
 * What to do to the phone's queue so it plays the live session's queue.
 *
 * Works on song ids only. The local queue is `PlaybackProvider`'s mirror of
 * the native one; the target is the session's current song then its upcoming
 * songs. The whole native queue is replaced only when the current song
 * differs, since that restarts playback. Otherwise the songs after it are
 * brought in line in as few native calls as it takes, so a big change does
 * not redraw the queue song by song:
 *
 * - what both lists start and end with stays put
 * - the songs in between that the session dropped are removed
 * - the songs in between it added go in as one batch, next or at the end,
 *   the only two places the native queue takes a batch. When they belong in
 *   the middle, either the batch goes in next and each song is moved down,
 *   or the songs after it come out and go back in at the end with it,
 *   whichever is fewer calls.
 *
 * Indices address the whole local queue, like `PlaybackProvider`'s commands.
 * Ops are in order: each index assumes the ones before it ran.
 *
 * Pure, so `session-reconciler.test.ts` runs it under `node --test`.
 */

export type LocalQueue = {
    songIds: readonly string[];
    /** The entry playing. -1 when nothing is. */
    index: number;
};

export type QueueOp =
    | { kind: "replace" }
    | { kind: "move"; from: number; to: number }
    /** Insert `songIds`, in order, right after the current song or at the end. */
    | { kind: "insert"; where: "next" | "end"; songIds: string[] }
    | { kind: "remove"; index: number };

export function reconcile(
    local: LocalQueue,
    target: readonly string[],
): QueueOp[] {
    if (target.length === 0) return [];
    const current = local.index >= 0 ? local.songIds[local.index] : undefined;
    if (current !== target[0]) return [{ kind: "replace" }];

    const base = local.index + 1;
    const have = local.songIds.slice(base);
    const want = target.slice(1);

    let prefix = 0;
    while (
        prefix < have.length &&
        prefix < want.length &&
        have[prefix] === want[prefix]
    ) {
        prefix += 1;
    }
    let suffix = 0;
    while (
        suffix < have.length - prefix &&
        suffix < want.length - prefix &&
        have[have.length - 1 - suffix] === want[want.length - 1 - suffix]
    ) {
        suffix += 1;
    }

    let removeEnd = have.length - suffix;
    let adding = want.slice(prefix, want.length - suffix);
    // the batch has to land next or at the end. in the middle, pick the
    // cheaper way there: move each added song down, or take the songs after
    // it out and add them back behind it
    const middle = adding.length > 0 && prefix > 0 && suffix > 0;
    const moveDown = middle && adding.length <= suffix;
    if (middle && !moveDown) {
        removeEnd = have.length;
        adding = want.slice(prefix);
    }

    const ops: QueueOp[] = [];
    // from the end, so earlier indices hold
    for (let i = removeEnd - 1; i >= prefix; i -= 1) {
        ops.push({ kind: "remove", index: base + i });
    }
    if (adding.length === 0) return ops;
    if (prefix === 0 || moveDown) {
        ops.push({ kind: "insert", where: "next", songIds: adding });
        // each move takes the first added song still at the front to just
        // behind the songs that were already there
        if (moveDown) {
            for (let i = 0; i < adding.length; i += 1) {
                ops.push({
                    kind: "move",
                    from: base,
                    to: base + prefix + adding.length - 1,
                });
            }
        }
    } else {
        ops.push({ kind: "insert", where: "end", songIds: adding });
    }
    return ops;
}

/**
 * The session songs the host's phone should hold when nobody steered
 * playback: from the song the phone is playing on, found at or after the
 * session's current song. The phone may be a song ahead of the session, since
 * its report has not landed yet, so the session's own current song is not the
 * start. Empty when the phone plays something the session does not have.
 */
export function hostTarget<T extends { song_id: string }>(
    entries: readonly T[],
    playingSongId: string | null,
): T[] {
    if (playingSongId === null) return [];
    const at = entries.findIndex((entry) => entry.song_id === playingSongId);
    return at >= 0 ? entries.slice(at) : [];
}

/** Applies `ops` to a plain list, the same way the native queue will. */
export function applyOps(local: LocalQueue, ops: readonly QueueOp[]): string[] {
    const items = [...local.songIds];
    for (const op of ops) {
        switch (op.kind) {
            case "replace":
                return items;
            case "move": {
                const [moved] = items.splice(op.from, 1);
                items.splice(op.to, 0, moved);
                break;
            }
            case "insert":
                if (op.where === "end") items.push(...op.songIds);
                else items.splice(local.index + 1, 0, ...op.songIds);
                break;
            case "remove":
                items.splice(op.index, 1);
                break;
        }
    }
    return items;
}

/**
 * Where the local player should be, in ms, at `serverNowMs`: the snapshot's
 * position plus the time since it was taken, while playing.
 */
export function expectedPositionMs(
    positionMs: number,
    asOfMs: number,
    isPlaying: boolean,
    serverNowMs: number,
): number {
    if (!isPlaying) return positionMs;
    return positionMs + Math.max(0, serverNowMs - asOfMs);
}

/** Off by more than this, a synced player seeks to catch up. */
export const DRIFT_TOLERANCE_MS = 2_000;
/** And it seeks at most this often, so a slow buffer does not stutter. */
export const MIN_SEEK_INTERVAL_MS = 5_000;

export function shouldCorrectDrift(
    localMs: number,
    expectedMs: number,
    msSinceLastSeek: number,
): boolean {
    return (
        Math.abs(localMs - expectedMs) > DRIFT_TOLERANCE_MS &&
        msSinceLastSeek >= MIN_SEEK_INTERVAL_MS
    );
}
