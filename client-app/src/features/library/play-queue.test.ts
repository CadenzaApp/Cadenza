import assert from "node:assert/strict";
import test from "node:test";

import { concatUnique, mapInOrder } from "./play-queue.ts";

test("answers come back in input order, not landing order", async () => {
    const delays = [30, 5, 15, 0];
    const results = await mapInOrder(delays, 2, async (delay) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return delay;
    });
    assert.deepEqual(results, delays);
});

test("never runs more than the limit at once", async () => {
    let running = 0;
    let most = 0;
    await mapInOrder([1, 2, 3, 4, 5, 6], 3, async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
    });
    assert.equal(most, 3);
});

test("an empty list reads nothing", async () => {
    assert.deepEqual(await mapInOrder([], 4, async () => 1), []);
});

test("a repeat keeps its first place", () => {
    assert.deepEqual(
        concatUnique([["a", "b"], ["b", "c", "a"], ["d"]], (item) => item),
        ["a", "b", "c", "d"],
    );
});
