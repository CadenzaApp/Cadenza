import assert from "node:assert/strict";
import test from "node:test";

import {
    applyOps,
    expectedPositionMs,
    hostTarget,
    reconcile,
    shouldCorrectDrift,
    type LocalQueue,
} from "./session-reconciler.ts";

/** Reconciles, applies, and checks the upcoming songs now match. */
function check(local: LocalQueue, target: string[]) {
    const ops = reconcile(local, target);
    assert.ok(!ops.some((op) => op.kind === "replace"), "should not replace");
    const after = applyOps(local, ops);
    assert.deepEqual(after.slice(local.index), target);
    return ops;
}

test("a different current song replaces the queue", () => {
    assert.deepEqual(reconcile({ songIds: ["a", "b"], index: 0 }, ["b", "c"]), [
        { kind: "replace" },
    ]);
    assert.deepEqual(reconcile({ songIds: [], index: -1 }, ["a"]), [
        { kind: "replace" },
    ]);
});

test("an in sync queue needs nothing", () => {
    assert.deepEqual(
        reconcile({ songIds: ["a", "b", "c"], index: 0 }, ["a", "b", "c"]),
        [],
    );
    assert.deepEqual(reconcile({ songIds: ["a"], index: 0 }, []), []);
});

test("songs added, moved, and removed upstream are mirrored", () => {
    check({ songIds: ["a", "b"], index: 0 }, ["a", "b", "c"]);
    check({ songIds: ["a", "b", "c", "d"], index: 0 }, ["a", "d", "b", "c"]);
    check({ songIds: ["a", "b", "c", "d"], index: 0 }, ["a", "c"]);
    check({ songIds: ["a", "b", "c"], index: 0 }, ["a", "x", "c", "y"]);
});

test("a big change is one batch, not a call per song", () => {
    const many = Array.from({ length: 100 }, (_, i) => `s${i}`);
    // a playlist added at the end
    assert.deepEqual(
        check({ songIds: ["a", "b"], index: 0 }, ["a", "b", ...many]),
        [{ kind: "insert", where: "end", songIds: many }],
    );
    // a playlist played next
    assert.deepEqual(
        check({ songIds: ["a", "b"], index: 0 }, ["a", ...many, "b"]),
        [{ kind: "insert", where: "next", songIds: many }],
    );
    // into the middle: the two songs after it come out and go back in
    const ops = check({ songIds: ["a", "b", "c", "d"], index: 0 }, [
        "a",
        "b",
        ...many,
        "c",
        "d",
    ]);
    assert.equal(ops.length, 3);
});

test("one song into the middle moves down instead", () => {
    const ops = check({ songIds: ["a", "b", "c", "d", "e"], index: 0 }, [
        "a",
        "b",
        "x",
        "c",
        "d",
        "e",
    ]);
    assert.deepEqual(ops, [
        { kind: "insert", where: "next", songIds: ["x"] },
        { kind: "move", from: 1, to: 2 },
    ]);
});

test("songs already played before the current one are left alone", () => {
    const ops = check({ songIds: ["old", "a", "b"], index: 1 }, [
        "a",
        "c",
        "b",
    ]);
    assert.ok(ops.every((op) => op.kind !== "remove" || op.index > 1));
});

test("expected position runs while playing only", () => {
    assert.equal(expectedPositionMs(10_000, 1_000, true, 4_000), 13_000);
    assert.equal(expectedPositionMs(10_000, 1_000, false, 4_000), 10_000);
    assert.equal(expectedPositionMs(10_000, 5_000, true, 4_000), 10_000);
});

test("drift is corrected past 2 s, at most every 5 s", () => {
    assert.equal(shouldCorrectDrift(10_000, 11_500, 60_000), false);
    assert.equal(shouldCorrectDrift(10_000, 12_500, 60_000), true);
    assert.equal(shouldCorrectDrift(10_000, 12_500, 1_000), false);
});

test("the host's queue starts on the song its phone plays", () => {
    const entries = [{ song_id: "a" }, { song_id: "b" }, { song_id: "c" }];
    // the phone moved on before its report landed
    assert.deepEqual(hostTarget(entries, "b"), [
        { song_id: "b" },
        { song_id: "c" },
    ]);
    assert.deepEqual(hostTarget(entries, "x"), []);
    assert.deepEqual(hostTarget(entries, null), []);
});
