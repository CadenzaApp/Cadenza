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
import {
    isPermanentRejection,
    nextSession,
    onRejectedBatch,
    type Session,
} from "./listening-session";
import type { TrackedEvent } from "./play-tracker";
import { deviceTimezone } from "./routes/analytics";
import { useRecordEvents } from "./routes/events";
import type { TrackMetadata } from "./track-metadata";

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
    // a queue belongs to whoever listened, and is sent under their token, so
    // everything here is scoped to this id. nothing is recorded without one
    const userId = account?.id ?? null;
    const queueRef = useRef<QueuedEvent[]>([]);
    const loadedRef = useRef<string | null>(null);
    const flushingRef = useRef(false);
    // how many events the next flush may send, after a refusal narrowed it
    const retryLimitRef = useRef<number | null>(null);
    const sessionRef = useRef<Session | null>(null);
    const signedIn = userId != null;

    /** Sends what it can, and keeps whatever the backend did not confirm. */
    const flush = useCallback(async () => {
        if (flushingRef.current || !userId) return;
        // narrowed by a previous refusal, so the next attempt isolates the
        // event the backend will not take
        const batch = nextBatch(queueRef.current).slice(
            0,
            retryLimitRef.current ?? undefined,
        );
        if (batch.length === 0) return;

        flushingRef.current = true;
        try {
            const { accepted } = await recordEvents({ events: batch });
            // it went through, so stop narrowing
            retryLimitRef.current = null;
            queueRef.current = dropAccepted(queueRef.current, accepted);
            await saveQueue(userId, queueRef.current);
        } catch (error) {
            if (isPermanentRejection(error)) {
                // the backend validated the batch and will refuse it every time,
                // so keeping it whole would wedge the queue: a flush always
                // sends from the front. but dropping it whole loses every good
                // event with it, and a device whose clock is fast fails
                // validation on all of them. so narrow instead, and only ever
                // discard a batch of one
                const { drop, keep } = onRejectedBatch(batch);
                if (drop.length > 0) {
                    console.warn(
                        "Dropping a listening event the backend refused:",
                        error,
                    );
                    queueRef.current = dropAccepted(
                        queueRef.current,
                        drop.map((event) => event.client_event_id),
                    );
                    await saveQueue(userId, queueRef.current);
                } else {
                    // retry just the front of it next time
                    retryLimitRef.current = keep.length;
                }
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
    }, [recordEvents, userId]);

    /** Writes events down, then tries to send. */
    const enqueueAll = useCallback(
        async (queued: QueuedEvent[]) => {
            // a listen with nobody signed in cannot be attributed to anyone, so
            // it is dropped rather than queued for whoever signs in next
            if (queued.length === 0 || !userId) return;
            queueRef.current = enqueue(queueRef.current, queued);
            await saveQueue(userId, queueRef.current);
            await flush();
        },
        [flush, userId],
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
            sessionRef.current = nextSession(
                sessionRef.current,
                now.getTime(),
                randomUuid,
            );
            const sessionId = sessionRef.current.id;

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
            sessionRef.current = nextSession(
                sessionRef.current,
                now.getTime(),
                randomUuid,
            );
            await enqueueAll([
                {
                    type,
                    song_id: songId,
                    occurred_at: now.toISOString(),
                    client_tz: deviceTimezone(),
                    session_id: sessionRef.current.id,
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

    // pick up anything an earlier run could not send, for this user
    useEffect(() => {
        if (!userId) {
            // a different user's queue must not be flushed under this session
            queueRef.current = [];
            loadedRef.current = null;
            return;
        }
        if (loadedRef.current === userId) return;
        loadedRef.current = userId;
        void (async () => {
            const stored = await loadQueue(userId);
            // anything recorded since the load started stays at the back
            queueRef.current = enqueue(stored, queueRef.current);
            await flush();
        })();
    }, [flush, userId]);

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
