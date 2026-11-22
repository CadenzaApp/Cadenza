import assert from "node:assert/strict";
import test from "node:test";

import { ASSISTANT_SUGGESTIONS, shuffled } from "./suggestions.ts";

test("there are at least 50 suggestions, each once and short enough for a row", () => {
    assert.ok(ASSISTANT_SUGGESTIONS.length >= 50);
    assert.equal(
        new Set(ASSISTANT_SUGGESTIONS).size,
        ASSISTANT_SUGGESTIONS.length,
    );
    for (const suggestion of ASSISTANT_SUGGESTIONS) {
        assert.ok(suggestion.length <= 64, suggestion);
    }
});

test("shuffled keeps every item once and leaves its input alone", () => {
    const items = ["a", "b", "c", "d", "e"];
    let seed = 7;
    const random = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    const out = shuffled(items, random);
    assert.deepEqual([...out].sort(), items);
    assert.deepEqual(items, ["a", "b", "c", "d", "e"]);
});
