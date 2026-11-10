/**
 * What to do to the phone's queue so it plays the live session's queue.
 *
 * Works on song ids only. The local queue is `PlaybackProvider`'s mirror of
 * the native one; the target is the session's current song then its upcoming
 * songs. The whole native queue is replaced only when the current song
 * differs, since that restarts playback; otherwise a few moves, inserts, and
 * removes bring the upcoming songs in line without a hiccup in what is
 * playing.
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
    /** Insert `songId` so it lands at `at`. */
    | { kind: "insert"; at: number; songId: string }
    | { kind: "remove"; index: number };

export function reconcile(
    local: LocalQueue,
    target: readonly string[],
): QueueOp[] {
    if (target.length === 0) return [];
    const current = local.index >= 0 ? local.songIds[local.index] : undefined;
    if (current !== target[0]) return [{ kind: "replace" }];

    const ops: QueueOp[] = [];
    const items = [...local.songIds];
    const base = local.index + 1;
    const want = target.slice(1);

    for (let i = 0; i < want.length; i += 1) {
        const at = base + i;
        if (items[at] === want[i]) continue;
        const found = items.indexOf(want[i], at + 1);
        if (found >= 0) {
            ops.push({ kind: "move", from: found, to: at });
            const [moved] = items.splice(found, 1);
            items.splice(at, 0, moved);
        } else {
            ops.push({ kind: "insert", at, songId: want[i] });
            items.splice(at, 0, want[i]);
        }
    }
    // anything past the session's last song goes, from the end so indices hold
    for (
        let index = items.length - 1;
        index >= base + want.length;
        index -= 1
    ) {
        ops.push({ kind: "remove", index });
    }
    return ops;
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
                items.splice(op.at, 0, op.songId);
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
