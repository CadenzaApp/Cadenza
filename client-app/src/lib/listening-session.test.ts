import assert from "node:assert/strict";
import test from "node:test";

import {
    isPermanentRejection,
    nextSession,
    onRejectedBatch,
    SESSION_IDLE_MS,
    type Session,
} from "./listening-session.ts";

// ----- sessions -----

test("the first event starts a session", () => {
    const session = nextSession(null, 1_000, () => "s1");
    assert.deepEqual(session, { id: "s1", lastSeenMs: 1_000 });
});

test("an event inside the idle window stays in the session", () => {
    const current: Session = { id: "s1", lastSeenMs: 1_000 };
    const next = nextSession(current, 1_000 + SESSION_IDLE_MS - 1, () => "s2");
    assert.equal(next.id, "s1");
    assert.equal(
        next.lastSeenMs,
        1_000 + SESSION_IDLE_MS - 1,
        "the clock moves",
    );
});

test("an event past the idle window starts a new session", () => {
    const current: Session = { id: "s1", lastSeenMs: 1_000 };
    const next = nextSession(current, 1_000 + SESSION_IDLE_MS, () => "s2");
    assert.equal(next.id, "s2");
});

test("the idle window is measured from the last event, not the first", () => {
    // a long listening stretch is one session however long it runs, as long as
    // there is no gap in it
    let session = nextSession(null, 0, () => "s1");
    for (let i = 1; i <= 20; i++) {
        session = nextSession(
            session,
            i * (SESSION_IDLE_MS - 1),
            () => `s${i + 1}`,
        );
    }
    assert.equal(session.id, "s1", "no gap, so still one sitting");
});

test("a session is half an hour of quiet", () => {
    assert.equal(SESSION_IDLE_MS, 30 * 60 * 1000);
});

// ----- what counts as permanent -----

test("a validation failure is permanent", () => {
    assert.equal(
        isPermanentRejection({
            error_type: "InvalidRequestBody",
            message: "bad",
        }),
        true,
    );
});

test("a server or network failure is not permanent", () => {
    // these say nothing about the batch, so the events have to be kept
    assert.equal(isPermanentRejection({ error_type: "DatabaseError" }), false);
    assert.equal(isPermanentRejection({ status: 500 }), false);
    assert.equal(isPermanentRejection({ status: 503 }), false);
    assert.equal(
        isPermanentRejection(new Error("network request failed")),
        false,
    );
    assert.equal(isPermanentRejection(undefined), false);
    assert.equal(isPermanentRejection(null), false);
    assert.equal(isPermanentRejection("timeout"), false);
});

test("a 401 is not permanent, it just means the token is not ready", () => {
    assert.equal(isPermanentRejection({ status: 401 }), false);
});

test("another 4xx is permanent", () => {
    assert.equal(isPermanentRejection({ status: 400 }), true);
    assert.equal(isPermanentRejection({ status: 404 }), true);
    assert.equal(isPermanentRejection({ status: 422 }), true);
});

test("a non-numeric status is ignored rather than trusted", () => {
    assert.equal(isPermanentRejection({ status: "400" }), false);
});

// ----- what happens to a refused batch -----

test("a refused batch is halved rather than thrown away", () => {
    // the failure this guards: a device clock ten minutes fast fails validation
    // on every event, so dropping the batch would discard all of a user's plays
    const batch = [1, 2, 3, 4, 5, 6];
    const { drop, keep } = onRejectedBatch(batch);
    assert.deepEqual(drop, [], "nothing is lost on the first refusal");
    assert.deepEqual(keep, [1, 2, 3], "a smaller batch is retried");
});

test("splitting narrows to a single event", () => {
    let batch: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];
    let rounds = 0;
    while (batch.length > 1) {
        batch = onRejectedBatch(batch).keep;
        rounds++;
        assert.ok(rounds < 10, "the split has to terminate");
    }
    assert.equal(batch.length, 1);
});

test("only a single refused event is actually dropped", () => {
    const { drop, keep } = onRejectedBatch([42]);
    assert.deepEqual(drop, [42], "the offender, and only the offender");
    assert.deepEqual(keep, []);
});

test("an empty batch drops nothing", () => {
    const { drop, keep } = onRejectedBatch([]);
    assert.deepEqual(drop, []);
    assert.deepEqual(keep, []);
});
