/**
 * Where the listening event queue lives between app launches.
 *
 * Split from `event-queue.ts` so the queue logic there stays import-free and
 * testable under `node --test`. This half is only AsyncStorage.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { QueuedEvent } from "./event-queue";

const STORAGE_KEY = "cadenza.listening-events.v1";

/**
 * The queue as it was left. An unreadable or corrupt store reads as empty
 * rather than throwing: losing the queue is bad, but failing every play from
 * then on is worse.
 */
export async function loadQueue(): Promise<QueuedEvent[]> {
    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isQueuedEvent);
    } catch (error) {
        console.warn("Could not read the listening event queue:", error);
        return [];
    }
}

export async function saveQueue(queue: readonly QueuedEvent[]): Promise<void> {
    try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
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
