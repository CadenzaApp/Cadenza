import assert from "node:assert/strict";
import test from "node:test";

import { tradeColor } from "./color-queue.ts";

test("hands the color back and takes the head of the line", () => {
    const { queue, color } = tradeColor(["red", "green", "blue"], "pink");
    assert.equal(color, "red");
    assert.deepEqual(queue, ["green", "blue", "pink"]);
});

test("skips its own color, so a trade changes color", () => {
    const { queue, color } = tradeColor(["pink", "green"], "pink");
    assert.equal(color, "green");
    assert.deepEqual(queue, ["pink", "pink"]);
});

test("keeps its color when the line has nothing else", () => {
    const { queue, color } = tradeColor(["pink"], "pink");
    assert.equal(color, "pink");
    assert.deepEqual(queue, ["pink"]);
});

test("the line never grows or shrinks", () => {
    let queue: readonly string[] = ["a", "b", "c", "d", "e"];
    let held = ["a", "b", "c", "d", "e"];
    for (let turn = 0; turn < 50; turn++) {
        const index = (turn * 3) % held.length;
        const trade = tradeColor(queue, held[index]);
        queue = trade.queue;
        held = held.map((color, at) => (at === index ? trade.color : color));
        assert.equal(queue.length, 5);
    }
});
