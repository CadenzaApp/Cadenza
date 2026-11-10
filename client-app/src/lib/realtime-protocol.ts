/**
 * The pure parts of the realtime socket: topics, messages, reconnect backoff,
 * and the server clock offset. The socket itself is `realtime.ts`.
 *
 * Import-free, so `realtime-protocol.test.ts` runs it under `node --test`.
 */

/** What a subscriber listens to. Mirrors the backend's `Topic`. */
export type RealtimeTopic =
    | { kind: "user"; id: string }
    | { kind: "live_session"; id: string }
    | { kind: "shared_playlist"; id: number };

/**
 * One change. `kind` is `now_playing`, `playlist`, `session`, or `ended`
 * from the backend, or `resync` from this client after a reconnect or a lag,
 * when events may have been missed and the subscriber should refetch.
 */
export type RealtimeEvent = {
    topic: RealtimeTopic;
    version: number;
    kind: string;
};

export type ServerMessage =
    | { type: "ready"; user_id: string }
    | { type: "subscribed"; topic: RealtimeTopic }
    | { type: "unsubscribed"; topic: RealtimeTopic }
    | { type: "error"; message: string; topic: RealtimeTopic | null }
    | { type: "pong"; id: number | null; server_time_ms: number }
    | ({ type: "event" } & RealtimeEvent)
    | { type: "lagged"; topic: RealtimeTopic };

/** A stable string for a topic, for maps and for comparing two topics. */
export function topicKey(topic: RealtimeTopic): string {
    return `${topic.kind}:${topic.id}`;
}

/** Reads one frame, or null when it is not a message this client knows. */
export function parseServerMessage(text: string): ServerMessage | null {
    try {
        const value: unknown = JSON.parse(text);
        if (typeof value !== "object" || value === null) return null;
        const type = (value as { type?: unknown }).type;
        if (typeof type !== "string") return null;
        return value as ServerMessage;
    } catch {
        return null;
    }
}

/** Waits between reconnects: 1 s, 2 s, 4 s, up to 30 s. */
export function reconnectDelayMs(attempt: number): number {
    return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
}

/** Samples of the clock offset kept, newest last. */
export const CLOCK_SAMPLES = 5;

/**
 * One offset sample from a ping: what to add to the local clock to get the
 * server's. Assumes the server answered halfway through the round trip.
 */
export function clockOffsetSample(
    sentAt: number,
    receivedAt: number,
    serverTimeMs: number,
): number {
    const midpoint = sentAt + (receivedAt - sentAt) / 2;
    return serverTimeMs - midpoint;
}

/** The median of the samples, which one slow round trip cannot skew. */
export function medianOffset(samples: readonly number[]): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** `samples` with `sample` added, keeping the newest `CLOCK_SAMPLES`. */
export function addSample(
    samples: readonly number[],
    sample: number,
): number[] {
    return [...samples, sample].slice(-CLOCK_SAMPLES);
}

/** The backend's http url as its websocket url. */
export function socketUrl(backendUrl: string): string {
    return `${backendUrl.replace(/^http/, "ws")}/realtime/ws`;
}
