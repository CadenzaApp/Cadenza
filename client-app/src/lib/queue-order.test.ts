import assert from "node:assert/strict";
import test from "node:test";

import {
    insertQueueEntriesNext,
    jumpToQueueEntry,
    moveQueueEntry,
    nearestQueuePosition,
    removeQueueEntry,
} from "./queue-order.ts";

const queue = { items: ["a", "b", "c", "d"], index: 1 };

test("moving an entry past the playing one pulls the index back", () => {
    assert.deepEqual(moveQueueEntry(queue, 0, 3), {
        items: ["b", "c", "d", "a"],
        index: 0,
    });
});

test("moving an entry before the playing one pushes the index forward", () => {
    assert.deepEqual(moveQueueEntry(queue, 3, 0), {
        items: ["d", "a", "b", "c"],
        index: 2,
    });
});

test("the playing entry keeps playing after it is moved", () => {
    assert.deepEqual(moveQueueEntry(queue, 1, 3), {
        items: ["a", "c", "d", "b"],
        index: 3,
    });
});

test("an out of range move is a no-op", () => {
    assert.equal(moveQueueEntry(queue, 0, 9), queue);
    assert.equal(moveQueueEntry(queue, -1, 0), queue);
});

test("removing ahead of the playing entry leaves the index alone", () => {
    assert.deepEqual(removeQueueEntry(queue, 2), {
        items: ["a", "b", "d"],
        index: 1,
    });
});

test("removing behind the playing entry pulls the index back", () => {
    assert.deepEqual(removeQueueEntry(queue, 0), {
        items: ["b", "c", "d"],
        index: 0,
    });
});

test("emptying the queue clears the index", () => {
    assert.deepEqual(removeQueueEntry({ items: ["a"], index: 0 }, 0), {
        items: [],
        index: -1,
    });
});

test("play next lands directly after the playing entry", () => {
    assert.deepEqual(insertQueueEntriesNext(queue, ["x", "y"]), {
        items: ["a", "b", "x", "y", "c", "d"],
        index: 1,
    });
});

test("jumping forward discards what was skipped over", () => {
    assert.deepEqual(jumpToQueueEntry(queue, 3), {
        items: ["a", "b", "d"],
        index: 2,
    });
});

test("jumping back keeps the whole queue", () => {
    assert.deepEqual(jumpToQueueEntry(queue, 0), {
        items: ["a", "b", "c", "d"],
        index: 0,
    });
});

test("a duplicated track resolves to the copy nearest the known index", () => {
    const items = ["a", "b", "a", "c"];
    const isA = (item: string) => item === "a";
    assert.equal(nearestQueuePosition(items, 2, isA), 2);
    assert.equal(nearestQueuePosition(items, 0, isA), 0);
    assert.equal(nearestQueuePosition(items, 3, isA), 2);
    assert.equal(nearestQueuePosition(items, 1, isA), 2);
});

test("a track that is not queued resolves to nothing", () => {
    assert.equal(nearestQueuePosition(["a", "b"], 0, (i) => i === "z"), -1);
});
