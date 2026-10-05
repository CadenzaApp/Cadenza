/**
 * The offline queue for listening events.
 *
 * Playback happens whether or not the network does, and a play that fails to
 * send is gone for good unless it is written down first. So every event lands
 * here before it is sent, survives a restart in AsyncStorage, and is only
 * dropped once the backend confirms it stored it.
 *
 * This file is the queue logic, pure and import-free apart from a type, so
 * `event-queue.test.ts` can run it under `node --test`. Persistence is
 * `event-queue-store.ts`, and `play-recorder.ts` drives both.
 */

import type { TrackedEvent } from "./play-tracker";
import type { TrackMetadata } from "./track-metadata";

/**
 * How many events the queue holds. A user offline for a long time stops
 * recording rather than growing the store without limit; the oldest go first,
 * since a recent play is worth more than a stale one.
 */
export const MAX_QUEUED_EVENTS = 2_000;

/** How many events one request sends, matching the backend's batch cap. */
export const FLUSH_BATCH_SIZE = 500;

/**
 * Every event type `POST /events` accepts, mirroring the backend's `EventType`.
 *
 * Wider than `TrackedEvent["type"]` on purpose: the playback tracker only
 * produces the five it can observe, and the rest are recorded by whichever
 * screen knows about them. See `listening-events.tsx`.
 */
export type ListeningEventType =
    | TrackedEvent["type"]
    | "query_run"
    | "query_play"
    | "tag_applied"
    | "tag_removed";

/** One event as `POST /events` takes it. */
export type QueuedEvent = {
    type: ListeningEventType;
    song_id: string | null;
    occurred_at: string;
    client_tz: string;
    session_id: string | null;
    client_event_id: string;
    payload: Record<string, number | string>;
};

/**
 * Turns a tracked event into the wire shape, stamping it with when and where it
 * happened and the id that makes re-sending it free.
 *
 * `occurredAt` is passed in rather than read from the clock here so the caller
 * can keep it pure and so a test can pin it.
 *
 * `metadata` is the artist, album and source, which is what lets the backend
 * rank them.
 * It is optional because the caller only has it for the song that is playing;
 * see the song id guard in `play-recorder.ts`.
 */
export function toQueuedEvent(
    event: TrackedEvent,
    {
        occurredAt,
        clientTz,
        sessionId,
        clientEventId,
        metadata,
    }: {
        occurredAt: Date;
        clientTz: string;
        sessionId: string | null;
        clientEventId: string;
        metadata?: TrackMetadata | null;
    },
): QueuedEvent {
    const payload: Record<string, number | string> = {};
    if (event.durationSeconds != null) {
        payload.duration_ms = Math.round(event.durationSeconds * 1000);
    }
    if (event.listenedSeconds != null) {
        payload.listened_ms = Math.round(event.listenedSeconds * 1000);
    }
    // the backend needs position_ms on a skip to tell a rejection from a song
    // that almost finished
    if (event.type === "skip" || event.type === "seek") {
        payload.position_ms = Math.round(event.positionSeconds * 1000);
    }
    if (event.type === "seek" && event.fromSeconds != null) {
        payload.from_ms = Math.round(event.fromSeconds * 1000);
        payload.to_ms = Math.round(event.positionSeconds * 1000);
    }

    // what the backend groups the artist and album rankings by. the names are
    // the group key and the ids only decorate it, so a track with a name and no
    // id still ranks
    if (metadata?.artistName) payload.artist_name = metadata.artistName;
    if (metadata?.artistId) payload.artist_id = metadata.artistId;
    if (metadata?.albumName) payload.album_name = metadata.albumName;
    if (metadata?.albumId) payload.album_id = metadata.albumId;
    // what the playlist and query rankings group by
    if (metadata?.source) {
        payload.source_kind = metadata.source.kind;
        payload.source_id = metadata.source.id;
        payload.source_name = metadata.source.name;
    }

    return {
        type: event.type,
        song_id: event.songId,
        occurred_at: occurredAt.toISOString(),
        client_tz: clientTz,
        session_id: sessionId,
        client_event_id: clientEventId,
        payload,
    };
}

/**
 * Adds events to the queue, dropping the oldest if that would take it over
 * `MAX_QUEUED_EVENTS`.
 *
 * Pure: hands back a new queue rather than mutating the one it was given.
 */
export function enqueue(
    queue: readonly QueuedEvent[],
    events: readonly QueuedEvent[],
): QueuedEvent[] {
    const next = [...queue, ...events];
    if (next.length <= MAX_QUEUED_EVENTS) return next;
    return next.slice(next.length - MAX_QUEUED_EVENTS);
}

/** The next events to send, oldest first. */
export function nextBatch(queue: readonly QueuedEvent[]): QueuedEvent[] {
    return queue.slice(0, FLUSH_BATCH_SIZE);
}

/**
 * Removes the events the backend confirmed, by id.
 *
 * Anything not confirmed stays queued, which is what makes a partial success
 * safe: the next flush re-sends it and the backend's idempotency makes that a
 * no-op if it was in fact stored.
 */
export function dropAccepted(
    queue: readonly QueuedEvent[],
    accepted: readonly string[],
): QueuedEvent[] {
    if (accepted.length === 0) return [...queue];
    const done = new Set(accepted);
    return queue.filter((event) => !done.has(event.client_event_id));
}

/**
 * A unique id for one event. The backend dedupes on it, so it has to be stable
 * for a given event and never reused.
 *
 * `random` is injected so this stays pure and a test can pin it.
 */
export function makeClientEventId(
    event: TrackedEvent,
    occurredAt: Date,
    random: () => string,
): string {
    return makeEventId(
        event.type,
        event.songId,
        occurredAt,
        Math.round(event.positionSeconds * 1000),
        random,
    );
}

/**
 * The same, for an event that has no playback position: one a screen records
 * because it knows something the tracker cannot see, like a play starting from
 * a query's results.
 */
export function makeEventId(
    type: ListeningEventType,
    songId: string | null,
    occurredAt: Date,
    positionMs: number,
    random: () => string,
): string {
    return [type, songId, occurredAt.getTime(), positionMs, random()].join(":");
}
