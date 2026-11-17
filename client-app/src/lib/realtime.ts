import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { BACKEND_URL } from "./backend";
import {
    addSample,
    clockOffsetSample,
    medianOffset,
    parseServerMessage,
    reconnectDelayMs,
    socketUrl,
    topicKey,
    type RealtimeEvent,
    type RealtimeTopic,
} from "./realtime-protocol";
import { getAccessToken } from "./supabase";

export type { RealtimeEvent, RealtimeTopic };

type Listener = (event: RealtimeEvent) => void;

/** Keepalive, and a fresh clock offset sample each time. */
const PING_INTERVAL_MS = 25_000;

/**
 * The app's one realtime socket (`GET /realtime/ws` on the backend). Push
 * only: it says a topic changed and at what version, and subscribers refetch
 * through their normal SWR reads. Mutations stay on HTTP.
 *
 * It opens while anything is subscribed and the app is in the foreground,
 * closes in the background unless something holds it open there (a live
 * session playing on this phone, which iOS keeps running for its audio), and
 * reconnects with backoff. After any reconnect
 * every subscriber gets a `resync` event, since changes made while it was
 * down were never pushed.
 *
 * Not SWR: it is a subscription to a changing external store, which the
 * client conventions keep out of SWR. Read it through `useRealtimeTopic`.
 */
class RealtimeClient {
    private socket: WebSocket | null = null;
    private ready = false;
    private listeners = new Map<
        string,
        { topic: RealtimeTopic; set: Set<Listener> }
    >();
    private attempt = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private pingTimer: ReturnType<typeof setInterval> | null = null;
    private pings = new Map<number, number>();
    private nextPingId = 1;
    private offsets: number[] = [];
    private foreground = AppState.currentState === "active";
    /** Holders that keep the socket open in the background. */
    private backgroundHolds = 0;
    /** Bumped on reset, so a socket from a signed out account cannot linger. */
    private generation = 0;

    constructor() {
        AppState.addEventListener("change", (state: AppStateStatus) => {
            const foreground = state === "active";
            if (foreground === this.foreground) return;
            this.foreground = foreground;
            if (this.awake) this.connectIfNeeded();
            else this.close();
        });
    }

    /** Foreground, or held open in the background. */
    private get awake() {
        return this.foreground || this.backgroundHolds > 0;
    }

    /** Keeps the socket open in the background until the returned release. */
    holdInBackground(): () => void {
        this.backgroundHolds += 1;
        this.connectIfNeeded();
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.backgroundHolds -= 1;
            if (!this.awake) this.close();
        };
    }

    /** The server's clock, in ms, from the median of recent pings. */
    serverNow(): number {
        return Date.now() + medianOffset(this.offsets);
    }

    subscribe(topic: RealtimeTopic, listener: Listener): () => void {
        const key = topicKey(topic);
        let entry = this.listeners.get(key);
        if (!entry) {
            entry = { topic, set: new Set() };
            this.listeners.set(key, entry);
            this.send({ type: "subscribe", topic });
        }
        entry.set.add(listener);
        this.connectIfNeeded();

        return () => {
            const current = this.listeners.get(key);
            if (!current) return;
            current.set.delete(listener);
            if (current.set.size > 0) return;
            this.listeners.delete(key);
            this.send({ type: "unsubscribe", topic });
            if (this.listeners.size === 0) this.close();
        };
    }

    /** Drops the socket. The next subscriber opens a new one with a fresh token. */
    reset() {
        this.generation += 1;
        this.close();
    }

    private send(message: unknown) {
        if (this.socket && this.ready)
            this.socket.send(JSON.stringify(message));
    }

    private connectIfNeeded() {
        if (this.socket || this.reconnectTimer) return;
        if (!this.awake || this.listeners.size === 0) return;
        void this.connect();
    }

    private async connect() {
        const generation = this.generation;
        const token = await getAccessToken();
        if (!token || generation !== this.generation) return;
        if (this.socket || !this.awake || this.listeners.size === 0) return;

        const socket = new WebSocket(socketUrl(BACKEND_URL));
        this.socket = socket;
        this.ready = false;

        socket.onopen = () => {
            socket.send(JSON.stringify({ type: "auth", token }));
        };
        socket.onmessage = (frame) => {
            if (socket !== this.socket) return;
            const message = parseServerMessage(String(frame.data));
            if (message) this.handle(message);
        };
        socket.onclose = () => {
            if (socket !== this.socket) return;
            this.socket = null;
            this.ready = false;
            this.stopPinging();
            this.scheduleReconnect();
        };
        socket.onerror = () => {
            // onclose follows and handles it
        };
    }

    private handle(
        message: NonNullable<ReturnType<typeof parseServerMessage>>,
    ) {
        switch (message.type) {
            case "ready": {
                this.ready = true;
                const reconnected = this.attempt > 0;
                this.attempt = 0;
                for (const { topic } of this.listeners.values()) {
                    this.send({ type: "subscribe", topic });
                }
                this.startPinging();
                if (reconnected) this.resyncAll();
                break;
            }
            case "event":
                this.emit(message.topic, message);
                break;
            case "lagged":
                this.emit(message.topic, {
                    topic: message.topic,
                    version: 0,
                    kind: "resync",
                });
                break;
            case "pong": {
                const sentAt =
                    message.id === null
                        ? undefined
                        : this.pings.get(message.id);
                if (sentAt === undefined || message.id === null) break;
                this.pings.delete(message.id);
                this.offsets = addSample(
                    this.offsets,
                    clockOffsetSample(
                        sentAt,
                        Date.now(),
                        message.server_time_ms,
                    ),
                );
                break;
            }
            case "error":
                console.warn("Realtime:", message.message);
                break;
            default:
                break;
        }
    }

    private emit(topic: RealtimeTopic, event: RealtimeEvent) {
        const entry = this.listeners.get(topicKey(topic));
        if (!entry) return;
        for (const listener of entry.set) listener(event);
    }

    private resyncAll() {
        for (const { topic } of this.listeners.values()) {
            this.emit(topic, { topic, version: 0, kind: "resync" });
        }
    }

    private startPinging() {
        this.stopPinging();
        const ping = () => {
            const id = this.nextPingId++;
            this.pings.set(id, Date.now());
            this.send({ type: "ping", id });
        };
        ping();
        this.pingTimer = setInterval(ping, PING_INTERVAL_MS);
    }

    private stopPinging() {
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = null;
        this.pings.clear();
    }

    private scheduleReconnect() {
        if (!this.awake || this.listeners.size === 0) return;
        const delay = reconnectDelayMs(this.attempt);
        this.attempt += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connectIfNeeded();
        }, delay);
    }

    private close() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.stopPinging();
        const socket = this.socket;
        this.socket = null;
        this.ready = false;
        // a planned close is not a drop, so the next connect is not a reconnect.
        // subscribers still resync then, since the foreground is new data
        this.attempt = this.listeners.size > 0 ? 1 : 0;
        socket?.close();
    }
}

const client = new RealtimeClient();

/** The server's clock in ms. Falls back to the local one before any ping. */
export function serverNow(): number {
    return client.serverNow();
}

/**
 * Keeps the socket open while the app is in the background, as long as
 * `enabled`. For something that must still hear changes there, like a live
 * session playing on this phone. iOS only keeps the app running while audio
 * plays, so a paused phone still goes quiet.
 */
export function useRealtimeInBackground(enabled: boolean) {
    useEffect(() => {
        if (!enabled) return;
        return client.holdInBackground();
    }, [enabled]);
}

/** Drops the socket, for an account change. */
export function resetRealtime() {
    client.reset();
}

/**
 * Calls `onEvent` for every change to `topic` while mounted. A null topic
 * subscribes to nothing. `onEvent` can change between renders without
 * resubscribing.
 */
export function useRealtimeTopic(
    topic: RealtimeTopic | null,
    onEvent: (event: RealtimeEvent) => void,
) {
    const onEventRef = useRef(onEvent);
    useEffect(() => {
        onEventRef.current = onEvent;
    });
    const key = topic ? topicKey(topic) : null;

    useEffect(() => {
        if (!topic) return;
        return client.subscribe(topic, (event) => onEventRef.current(event));
        // the key covers the topic's contents
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
}

/** Subscribes to several topics at once, like every friend on a list. */
export function useRealtimeTopics(
    topics: readonly RealtimeTopic[],
    onEvent: (event: RealtimeEvent) => void,
) {
    const onEventRef = useRef(onEvent);
    useEffect(() => {
        onEventRef.current = onEvent;
    });
    const keys = topics.map(topicKey).sort().join(",");

    useEffect(() => {
        const unsubscribes = topics.map((topic) =>
            client.subscribe(topic, (event) => onEventRef.current(event)),
        );
        return () => {
            for (const unsubscribe of unsubscribes) unsubscribe();
        };
        // keys covers the topics' contents
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keys]);
}
