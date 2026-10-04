/**
 * Where the listening event queue lives between app launches.
 *
 * Split from `event-queue.ts` so the queue logic there stays import-free and
 * testable under `node --test`. This half is only AsyncStorage.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { QueuedEvent } from "./event-queue";

const STORAGE_PREFIX = "cadenza.listening-events.v1";

/**
 * Where one user's queue lives.
 *
 * Keyed by user, because a queue is a list of things *this* user listened to and
 * it is sent under whoever's token is current. One shared key meant a user whose
 * events failed to send could have them flushed under the next user to sign in
 * on the device, landing in their history and moving their My Plays.
 */
function storageKey(userId: string): string {
    return `${STORAGE_PREFIX}.${userId}`;
}

/**
 * The queue as this user left it. An unreadable or corrupt store reads as empty
 * rather than throwing: losing the queue is bad, but failing every play from
 * then on is worse.
 */
export async function loadQueue(userId: string): Promise<QueuedEvent[]> {
    try {
        const raw = await AsyncStorage.getItem(storageKey(userId));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isQueuedEvent);
    } catch (error) {
        console.warn("Could not read the listening event queue:", error);
        return [];
    }
}

export async function saveQueue(
    userId: string,
    queue: readonly QueuedEvent[],
): Promise<void> {
    try {
        await AsyncStorage.setItem(storageKey(userId), JSON.stringify(queue));
    } catch (error) {
        console.warn("Could not write the listening event queue:", error);
    }
}

/**
 * Whether a stored entry still looks like an event. Guards against a queue
 * written by an older build whose shape has since changed.
 */
function isQueuedEvent(value: unknown): value is QueuedEvent {
    if (typeof value !== "object" || value === null) return false;
    const event = value as Partial<QueuedEvent>;
    return (
        typeof event.type === "string" &&
        typeof event.occurred_at === "string" &&
        typeof event.client_event_id === "string" &&
        event.client_event_id.length > 0
    );
}
