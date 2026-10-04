/**
 * The two decisions inside the listening event queue that can lose a user's
 * plays, pulled out so they can be tested.
 *
 * `isPermanentRejection` decides when queued events are thrown away, and
 * `nextSession` decides where a listening session ends, which is what the
 * "on repeat" ranking is built from. Both were inline in the provider, where
 * nothing could reach them.
 *
 * Pure and import-free, so `listening-session.test.ts` runs it under
 * `node --test`.
 */

/**
 * A gap this long between events ends the session, so the next play counts as a
 * new sitting. Without a reset every play for the life of the install would be
 * one session and nothing would ever read as a replay.
 */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

export type Session = { id: string; lastSeenMs: number };

/**
 * The session an event happening at `nowMs` belongs to: the current one if it is
 * still live, otherwise a fresh one from `newId`.
 *
 * Returns the session rather than mutating, so the caller decides what to keep.
 */
export function nextSession(
    current: Session | null,
    nowMs: number,
    newId: () => string,
): Session {
    if (current && nowMs - current.lastSeenMs < SESSION_IDLE_MS) {
        return { id: current.id, lastSeenMs: nowMs };
    }
    return { id: newId(), lastSeenMs: nowMs };
}

/**
 * Whether the backend refused this batch for what is in it, rather than failing
 * to answer.
 *
 * This is the call that discards a user's queued plays, so it has to be tight in
 * both directions. Too loose and plays vanish; too tight and one bad event
 * wedges the queue, since a flush always sends from the front.
 *
 * `api-actions.ts` throws the backend's `{ error_type, message }` body straight
 * through on a non-2xx, so a validation failure has no status to read and is
 * matched by `error_type`. A plain-text failure does carry a status. 401 is
 * excluded: it only means the token is not ready yet.
 */
export function isPermanentRejection(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const { error_type: errorType, status } = error as {
        error_type?: unknown;
        status?: unknown;
    };

    if (errorType === "InvalidRequestBody") return true;
    return (
        typeof status === "number" &&
        status >= 400 &&
        status < 500 &&
        status !== 401
    );
}

/**
 * What to do with a batch the backend refused.
 *
 * Dropping the whole batch would lose every good event in it, and a device whose
 * clock is fast fails validation on *every* event, so that would silently
 * discard all of a user's listening. Splitting it instead isolates the offender
 * over a few flushes: each half is retried, and only a batch of one that is
 * still refused is actually dropped.
 */
export function onRejectedBatch<T>(batch: readonly T[]): {
    drop: readonly T[];
    keep: readonly T[];
} {
    if (batch.length <= 1) return { drop: batch, keep: [] };
    const half = Math.ceil(batch.length / 2);
    // keep the front half queued so the next flush retries a smaller batch
    return { drop: [], keep: batch.slice(0, half) };
}
