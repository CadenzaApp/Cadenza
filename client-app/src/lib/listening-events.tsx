import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useAccount } from "./account";
import {
    dropAccepted,
    enqueue,
    makeClientEventId,
    makeEventId,
    nextBatch,
    toQueuedEvent,
    type ListeningEventType,
    type QueuedEvent,
} from "./event-queue";
import { loadQueue, saveQueue } from "./event-queue-store";
import type { TrackedEvent } from "./play-tracker";
import { deviceTimezone } from "./routes/analytics";
import { useRecordEvents } from "./routes/events";
import type { TrackMetadata } from "./track-metadata";

/**
 * A gap this long between events ends the listening session, so the next play
 * counts as a new sitting. Session ids are what make "played it six times in a
 * row" answerable, and without a reset every play for the life of the install
 * would be one session.
 */
const SESSION_IDLE_MS = 30 * 60 * 1000;

/** How often a queue with something in it tries again. */
const FLUSH_INTERVAL_MS = 15_000;

type ListeningEventsApi = {
    /**
     * Records what the playback tracker saw. `metadata` describes `forSongId`
     * only; see the guard below.
     */
    recordPlayback: (
        events: TrackedEvent[],
        forSongId: string | null,
        metadata: TrackMetadata | null,
    ) => Promise<void>;
    /**
     * Records one event a screen knows about that the tracker cannot see, like a
     * play starting from a query's results.
     */
    recordEvent: (
        type: ListeningEventType,
        songId: string | null,
        payload?: Record<string, number | string>,
    ) => Promise<void>;
};

const ListeningEventsContext = createContext<ListeningEventsApi | null>(null);

/**
 * Owns the listening event queue: the one thing that writes events down and
 * ships them to `POST /events`.
 *
 * It is a provider rather than a hook because more than one place records
 * events. `play-recorder.ts` records what playback does, and a screen records
 * what only it knows, like a play coming out of a query. Two independent
 * owners would race on the one AsyncStorage key.
 *
 * Events are queued to storage before they are sent and dropped only once the
 * backend confirms each id, so a play survives a dead network, a failed
 * request, and the app being killed. The backend dedupes on `client_event_id`,
 * which is what makes re-sending free.
 *
 * Mounted above `PlaybackProvider`, since the play recorder it feeds runs
 * inside that.
 */
export function ListeningEventProvider({ children }: { children: ReactNode }) {
    const { account } = useAccount();
    const { recordEvents } = useRecordEvents();
    const queueRef = useRef<QueuedEvent[]>([]);
    const loadedRef = useRef(false);
    const flushingRef = useRef(false);
    const sessionRef = useRef<{ id: string; lastSeenMs: number } | null>(null);
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

    /** Writes events down, then tries to send. */
    const enqueueAll = useCallback(
        async (queued: QueuedEvent[]) => {
            if (queued.length === 0) return;
            queueRef.current = enqueue(queueRef.current, queued);
            await saveQueue(queueRef.current);
            await flush();
        },
        [flush],
    );

    /**
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
    const recordPlayback = useCallback(
        async (
            events: TrackedEvent[],
            forSongId: string | null,
            metadata: TrackMetadata | null,
        ) => {
            if (events.length === 0) return;

            const now = new Date();
            const tz = deviceTimezone();
            const sessionId = currentSession(sessionRef, now.getTime());

            await enqueueAll(
                events.map((event) =>
                    toQueuedEvent(event, {
                        occurredAt: now,
                        clientTz: tz,
                        sessionId,
                        clientEventId: makeClientEventId(
                            event,
                            now,
                            randomSuffix,
                        ),
                        metadata: event.songId === forSongId ? metadata : null,
                    }),
                ),
            );
        },
        [enqueueAll],
    );

    const recordEvent = useCallback(
        async (
            type: ListeningEventType,
            songId: string | null,
            payload: Record<string, number | string> = {},
        ) => {
            const now = new Date();
            await enqueueAll([
                {
                    type,
                    song_id: songId,
                    occurred_at: now.toISOString(),
                    client_tz: deviceTimezone(),
                    session_id: currentSession(sessionRef, now.getTime()),
                    client_event_id: makeEventId(
                        type,
                        songId,
                        now,
                        0,
                        randomSuffix,
                    ),
                    payload,
                },
            ]);
        },
        [enqueueAll],
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

    // coming back to the foreground is the best moment to retry: the network is
    // usually up and the user is here
    useEffect(() => {
        const onChange = (status: AppStateStatus) => {
            if (status === "active") void flush();
        };
        const subscription = AppState.addEventListener("change", onChange);
        return () => subscription.remove();
    }, [flush]);

    const api = useMemo(
        () => ({ recordPlayback, recordEvent }),
        [recordEvent, recordPlayback],
    );

    return (
        <ListeningEventsContext.Provider value={api}>
            {children}
        </ListeningEventsContext.Provider>
    );
}

export function useListeningEvents(): ListeningEventsApi {
    const api = useContext(ListeningEventsContext);
    if (!api) {
        throw new Error(
            "useListeningEvents must be used inside a ListeningEventProvider",
        );
    }
    return api;
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
