import assert from "node:assert/strict";
import test from "node:test";

import { touchSavedRead } from "./saved-reads.ts";

test("a new read goes to the front", () => {
    assert.deepEqual(touchSavedRead(["a", "b"], "c", 5), {
        index: ["c", "a", "b"],
        evicted: [],
    });
});

test("a read saved again moves to the front without a duplicate", () => {
    assert.deepEqual(touchSavedRead(["a", "b", "c"], "c", 5), {
        index: ["c", "a", "b"],
        evicted: [],
    });
});

test("past the cap the oldest reads fall off", () => {
    assert.deepEqual(touchSavedRead(["a", "b", "c"], "d", 2), {
        index: ["d", "a"],
        evicted: ["b", "c"],
    });
});
