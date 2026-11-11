/**
 * Sessions the caller asked to join and is waiting on, for this run of the
 * app. The Join button marks one; being let in is noticed off it, so the
 * caller gets a "You're in" rather than a session showing up unexplained.
 */
const asked = new Set<string>();

export function markAskedToJoin(sessionId: string) {
    asked.add(sessionId);
}

/** True once per let-in: the mark is cleared when read. */
export function takeAskedToJoin(sessionId: string) {
    return asked.delete(sessionId);
}

export function hasAskedToJoin(sessionId: string) {
    return asked.has(sessionId);
}
