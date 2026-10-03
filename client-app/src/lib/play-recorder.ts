import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { MusicItem, PlaybackSnapshot } from "@apple-musickit";

import { useAccount } from "./account";
import {
    dropAccepted,
    enqueue,
    makeClientEventId,
    nextBatch,
    toQueuedEvent,
    type QueuedEvent,
} from "./event-queue";
import { loadQueue, saveQueue } from "./event-queue-store";
import {
    INITIAL_PLAY_TRACKER_STATE,
    trackPlay,
    type PlayTrackerState,
    type TrackedEvent,
} from "./play-tracker";
import { deviceTimezone } from "./routes/analytics";
import { trackMetadata, type TrackMetadata } from "./track-metadata";
import { useRecordEvents } from "./routes/events";

/**
 * A gap this long between samples ends the listening session, so the next play
 * counts as a new sitting. Session ids are what make "played it six times in a
 * row" answerable, and without a reset every play for the life of the install
 * would be one session.
 */
const SESSION_IDLE_MS = 30 * 60 * 1000;

/** How often a queue with something in it tries again. */
const FLUSH_INTERVAL_MS = 15_000;

/**
 * Watches playback, writes down every listening event, and ships them to the
 * backend. What counts as what is `play-tracker.ts`; the queue is
 * `event-queue.ts`. Called once, from `PlaybackProvider`, with the snapshot it
 * already polls.
 *
 * Events are queued to storage before they are sent and only dropped once the
 * backend confirms it stored them, so a play survives a dead network, a failed
 * request, and the app being killed. The backend dedupes on `client_event_id`,
 * which is what makes re-sending free.
 *
 * `play_counted` events are also what fill in the My Plays, First Played, and
 * Last Played activity tags; the backend does that in the same transaction that
 * stores the event.
 *
 * Only sees what the provider samples, and the provider only polls in the
 * foreground. A song that starts and finishes entirely in the background is not
 * counted, and a listen spanning a background gap is one listen: the tracker
 * keeps its state, so it is neither re-counted nor ended twice.
 */
export function usePlayRecorder(
    snapshot: PlaybackSnapshot,
    activeTrack: MusicItem | null,
) {
    const { account } = useAccount();
    const { recordEvents } = useRecordEvents();
    const trackerRef = useRef<PlayTrackerState>(INITIAL_PLAY_TRACKER_STATE);
    const queueRef = useRef<QueuedEvent[]>([]);
    const loadedRef = useRef(false);
    const flushingRef = useRef(false);
    const sessionRef = useRef<{ id: string; lastSeenMs: number } | null>(null);

    // tags key on the catalog id, so a library copy and a catalog copy of a song
    // count as the same song
    const songId = activeTrack
        ? (activeTrack.catalogId ?? activeTrack.id)
        : null;
    const signedIn = account != null;

    /** Sends what it can, and keeps whatever the backend did not confirm. */
    const flush = useCallback(async () => {
        if (flushingRef.current || !signedIn) return;
        const batch = nextBatch(queueRef.current);
        if (batch.length === 0) return;

        flushingRef.current = true;
        try {
            const { accepted } = await recordEvents({ events: batch });
            queueRef.current = dropAccepted(queueRef.current, accepted);
            await saveQueue(queueRef.current);
        } catch (error) {
            if (isPermanentRejection(error)) {
                // the backend validated the batch and will refuse it every time.
                // keeping it would wedge the queue, which always sends from the
                // front, so one bad event would block every play behind it
                console.warn(
                    "Dropping listening events the backend refused:",
                    error,
                );
                queueRef.current = dropAccepted(
                    queueRef.current,
                    batch.map((event) => event.client_event_id),
                );
                await saveQueue(queueRef.current);
            } else {
                // a network or server failure says nothing about the batch, so
                // keep it. the next flush re-sends it, and the backend's
                // idempotency makes that harmless if it did land
                console.warn(
                    "Could not send listening events, keeping them:",
                    error,
                );
            }
        } finally {
            flushingRef.current = false;
        }
    }, [recordEvents, signedIn]);

    /**
     * Writes events down, then tries to send.
     *
     * `metadata` describes `forSongId` and nothing else, so it is attached only
     * to the events about that song. This is the whole guard against
     * mis-attribution: the event that ends a listen is emitted on the sample
     * where the *next* song is already active (see the song-change tests in
     * `play-tracker.test.ts`), so taking the metadata from whatever is playing
     * would file the previous song's skip under the next song's artist.
     *
     * The upshot is that terminal events ship without artist and album. Nothing
     * groups off them, and `play_counted` always describes the current song, so
     * every ranking still has what it needs.
     */
    const record = useCallback(
        async (
            events: TrackedEvent[],
            forSongId: string | null,
            metadata: TrackMetadata | null,
        ) => {
            if (events.length === 0) return;

            const now = new Date();
            const tz = deviceTimezone();
            const sessionId = currentSession(sessionRef, now.getTime());
            const queued = events.map((event) =>
                toQueuedEvent(event, {
                    occurredAt: now,
                    clientTz: tz,
                    sessionId,
                    clientEventId: makeClientEventId(event, now, randomSuffix),
                    metadata: event.songId === forSongId ? metadata : null,
                }),
            );

            queueRef.current = enqueue(queueRef.current, queued);
            await saveQueue(queueRef.current);
            await flush();
        },
        [flush],
    );

    // pick up anything an earlier run could not send
    useEffect(() => {
        if (loadedRef.current) return;
        loadedRef.current = true;
        void (async () => {
            const stored = await loadQueue();
            // anything recorded since the load started stays at the back
            queueRef.current = enqueue(stored, queueRef.current);
            await flush();
        })();
    }, [flush]);

    // a queue that could not be sent keeps trying, so a play recorded offline
    // lands once the network is back without waiting for the next song
    useEffect(() => {
        if (!signedIn) return;
        const timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [flush, signedIn]);

    useEffect(() => {
        const { state, events } = trackPlay(trackerRef.current, {
            songId,
            isPlaying: snapshot.isPlaying,
            progress: snapshot.progress,
            duration: snapshot.duration,
        });
        trackerRef.current = state;
        void record(
            events,
            songId,
            activeTrack ? trackMetadata(activeTrack) : null,
        );
    }, [
        activeTrack,
        record,
        songId,
        snapshot.isPlaying,
        snapshot.progress,
        snapshot.duration,
    ]);

    // coming back to the foreground is the best moment to retry: the network is
    // usually up and the user is here. the tracker is deliberately left alone,
    // since the listen in flight has not ended, and iOS reports "inactive" for
    // transient things like notification centre
    useEffect(() => {
        const onChange = (status: AppStateStatus) => {
            if (status === "active") void flush();
        };
        const subscription = AppState.addEventListener("change", onChange);
        return () => subscription.remove();
    }, [flush]);
}

/**
 * The session id for an event happening now, starting a new one after
 * `SESSION_IDLE_MS` of nothing.
 */
function currentSession(
    ref: { current: { id: string; lastSeenMs: number } | null },
    nowMs: number,
): string {
    const session = ref.current;
    if (session && nowMs - session.lastSeenMs < SESSION_IDLE_MS) {
        ref.current = { id: session.id, lastSeenMs: nowMs };
        return session.id;
    }
    const id = randomUuid();
    ref.current = { id, lastSeenMs: nowMs };
    return id;
}

/** Enough entropy to keep two events in the same millisecond apart. */
function randomSuffix(): string {
    return Math.random().toString(36).slice(2, 10);
}

/**
 * A uuid, which is what the `session_id` column is. `crypto.randomUUID` is not
 * on every React Native runtime, so fall back to assembling one.
 */
function randomUuid(): string {
    const native = globalThis.crypto?.randomUUID;
    if (typeof native === "function") return native.call(globalThis.crypto);

    const hex = Array.from({ length: 36 }, () => "0");
    const chars = "0123456789abcdef";
    for (let i = 0; i < 36; i++) {
        hex[i] = chars[Math.floor(Math.random() * 16)];
    }
    hex[8] = hex[13] = hex[18] = hex[23] = "-";
    // version 4, variant 1
    hex[14] = "4";
    hex[19] = chars[(Math.floor(Math.random() * 16) & 0x3) | 0x8];
    return hex.join("");
}

/**
 * Whether the backend refused this batch for what is in it, rather than failing
 * to answer. A refusal is permanent, so re-sending it forever would wedge the
 * queue; anything else is worth retrying.
 *
 * `api-actions.ts` throws the backend's `{ error_type, message }` body straight
 * through on a non-2xx, so there is no status to read for those, and `/events`
 * rejects a malformed batch as `InvalidRequestBody`. A plain-text failure does
 * carry a status, and 401 is excluded because it only means the token is not
 * ready yet.
 */
function isPermanentRejection(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const { error_type: errorType, status } = error as {
        error_type?: string;
        status?: number;
    };

    if (errorType === "InvalidRequestBody") return true;
    return (
        typeof status === "number" &&
        status >= 400 &&
        status < 500 &&
        status !== 401
    );
}
