import { useSyncExternalStore } from "react";

/**
 * Sessions the caller asked to join and is waiting on, for this run of the
 * app, with whose they are. The Join button marks one; being let in is noticed
 * off it, so the caller gets a "You're in" rather than a session showing up
 * unexplained. Watchers hear every change, so a Join button stops saying it is
 * waiting once the mark is taken.
 */
const asked = new Map<string, string>();
const listeners = new Set<() => void>();

function changed() {
    for (const listener of listeners) listener();
}

export function markAskedToJoin(sessionId: string, hostId: string) {
    asked.set(sessionId, hostId);
    changed();
}

/** True once per let-in: the mark is cleared when read. */
export function takeAskedToJoin(sessionId: string) {
    const had = asked.delete(sessionId);
    if (had) changed();
    return had;
}

/** Whether the caller is waiting to be let in with `userId`. */
export function hasAskedToJoin(userId: string) {
    return [...asked.values()].includes(userId);
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** `hasAskedToJoin`, kept current as marks are made and taken. */
export function useHasAskedToJoin(userId: string) {
    return useSyncExternalStore(subscribe, () => hasAskedToJoin(userId));
}
