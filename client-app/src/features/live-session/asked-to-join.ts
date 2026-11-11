/**
 * Sessions the caller asked to join and is waiting on, for this run of the
 * app, with whose they are. The Join button marks one; being let in is noticed
 * off it, so the caller gets a "You're in" rather than a session showing up
 * unexplained.
 */
const asked = new Map<string, string>();

export function markAskedToJoin(sessionId: string, hostId: string) {
    asked.set(sessionId, hostId);
}

/** True once per let-in: the mark is cleared when read. */
export function takeAskedToJoin(sessionId: string) {
    return asked.delete(sessionId);
}

/** Whether the caller is waiting to be let in with `userId`. */
export function hasAskedToJoin(userId: string) {
    return [...asked.values()].includes(userId);
}
