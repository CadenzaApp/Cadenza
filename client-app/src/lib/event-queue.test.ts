import assert from "node:assert/strict";
import test from "node:test";

import {
    dropAccepted,
    enqueue,
    FLUSH_BATCH_SIZE,
    makeClientEventId,
    MAX_QUEUED_EVENTS,
    nextBatch,
    toQueuedEvent,
    type QueuedEvent,
} from "./event-queue.ts";
import type { TrackedEvent } from "./play-tracker.ts";

const AT = new Date("2026-09-28T18:03:11.000Z");

function queued(id: string): QueuedEvent {
    return {
        type: "play_counted",
        song_id: "a",
        occurred_at: AT.toISOString(),
        client_tz: "UTC",
        session_id: null,
        client_event_id: id,
        payload: {},
    };
}

function convert(event: TrackedEvent) {
    return toQueuedEvent(event, {
        occurredAt: AT,
        clientTz: "America/Denver",
        sessionId: "s1",
        clientEventId: "id1",
    });
}

// ----- the wire shape -----

test("a counted play carries its duration and nothing it does not know", () => {
    const wire = convert({
        type: "play_counted",
        songId: "a",
        positionSeconds: 15,
        durationSeconds: 200,
    });
    assert.equal(wire.type, "play_counted");
    assert.equal(wire.song_id, "a");
    assert.equal(wire.occurred_at, "2026-09-28T18:03:11.000Z");
    assert.equal(wire.client_tz, "America/Denver");
    assert.equal(wire.session_id, "s1");
    assert.deepEqual(wire.payload, { duration_ms: 200_000 });
});

test("a completion carries the listened time the backend sums", () => {
    const wire = convert({
        type: "play_complete",
        songId: "a",
        positionSeconds: 199,
        durationSeconds: 200,
        listenedSeconds: 198.5,
    });
    assert.deepEqual(wire.payload, {
        duration_ms: 200_000,
        listened_ms: 198_500,
    });
});

test("a skip carries position_ms, which is what tells a rejection from a near-play", () => {
    const wire = convert({
        type: "skip",
        songId: "a",
        positionSeconds: 4.2,
        durationSeconds: 200,
        listenedSeconds: 4.2,
    });
    assert.equal(wire.payload.position_ms, 4_200);
    assert.equal(wire.payload.listened_ms, 4_200);
});

test("a seek carries where it went from and to", () => {
    const wire = convert({
        type: "seek",
        songId: "a",
        positionSeconds: 40,
        fromSeconds: 100,
        durationSeconds: 200,
    });
    assert.equal(wire.payload.from_ms, 100_000);
    assert.equal(wire.payload.to_ms, 40_000);
    assert.equal(wire.payload.position_ms, 40_000);
});

test("milliseconds are whole numbers", () => {
    const wire = convert({
        type: "skip",
        songId: "a",
        positionSeconds: 1.23456,
        listenedSeconds: 1.23456,
    });
    assert.equal(wire.payload.position_ms, 1235);
    assert.equal(Number.isInteger(wire.payload.position_ms), true);
});

// ----- ids -----

test("an id is unique per event even for the same song and moment", () => {
    let n = 0;
    const random = () => String(n++);
    const event: TrackedEvent = {
        type: "play_counted",
        songId: "a",
        positionSeconds: 15,
    };
    const first = makeClientEventId(event, AT, random);
    const second = makeClientEventId(event, AT, random);
    assert.notEqual(first, second);
});

test("an id names the event, so a stored one can be read back", () => {
    const id = makeClientEventId(
        { type: "skip", songId: "song-7", positionSeconds: 4 },
        AT,
        () => "r",
    );
    assert.ok(id.includes("skip"));
    assert.ok(id.includes("song-7"));
});

// ----- the queue -----

test("events go on the end, oldest first", () => {
    const queue = enqueue(enqueue([], [queued("a")]), [queued("b")]);
    assert.deepEqual(
        queue.map((e) => e.client_event_id),
        ["a", "b"],
    );
});

test("a full queue drops its oldest, not its newest", () => {
    const many = Array.from({ length: MAX_QUEUED_EVENTS }, (_, i) =>
        queued(`old${i}`),
    );
    const queue = enqueue(many, [queued("new")]);
    assert.equal(queue.length, MAX_QUEUED_EVENTS);
    assert.equal(queue[0].client_event_id, "old1", "the oldest went");
    assert.equal(queue.at(-1)?.client_event_id, "new", "the newest stayed");
});

test("a batch is capped and taken from the front", () => {
    const many = Array.from({ length: FLUSH_BATCH_SIZE + 10 }, (_, i) =>
        queued(`e${i}`),
    );
    const batch = nextBatch(many);
    assert.equal(batch.length, FLUSH_BATCH_SIZE);
    assert.equal(batch[0].client_event_id, "e0");
});

test("a short queue sends all of itself", () => {
    assert.equal(nextBatch([queued("a"), queued("b")]).length, 2);
});

test("confirmed events leave the queue and the rest stay", () => {
    const queue = [queued("a"), queued("b"), queued("c")];
    const left = dropAccepted(queue, ["a", "c"]);
    assert.deepEqual(
        left.map((e) => e.client_event_id),
        ["b"],
    );
});

test("nothing confirmed drops nothing", () => {
    const queue = [queued("a"), queued("b")];
    assert.equal(dropAccepted(queue, []).length, 2);
});

test("an id the backend did not confirm stays for the next flush", () => {
    // a partial success has to be safe: the retry is free because the backend
    // dedupes on client_event_id
    const queue = [queued("a"), queued("b")];
    const left = dropAccepted(queue, ["a"]);
    assert.deepEqual(
        left.map((e) => e.client_event_id),
        ["b"],
    );
});

test("dropping does not mutate the queue it was given", () => {
    const queue = [queued("a")];
    dropAccepted(queue, ["a"]);
    assert.equal(queue.length, 1);
});
