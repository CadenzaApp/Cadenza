import assert from "node:assert/strict";
import test from "node:test";

import { firstPlayableFrom, nextPreviewIndex } from "./preview-queue.ts";

test("moves to the next entry and stops at the end", () => {
    const playable = [true, true, true];
    assert.equal(
        nextPreviewIndex({ index: 0, playable, repeatMode: "off" }),
        1,
    );
    assert.equal(
        nextPreviewIndex({ index: 2, playable, repeatMode: "off" }),
        null,
    );
});

test("passes over songs with no clip", () => {
    assert.equal(
        nextPreviewIndex({
            index: 0,
            playable: [true, false, false, true],
            repeatMode: "off",
        }),
        3,
    );
});

test("repeat one replays, repeat all wraps", () => {
    const playable = [true, true];
    assert.equal(
        nextPreviewIndex({ index: 1, playable, repeatMode: "one" }),
        1,
    );
    assert.equal(
        nextPreviewIndex({ index: 1, playable, repeatMode: "all" }),
        0,
    );
});

test("a queue with no clips at all stops instead of looping", () => {
    assert.equal(
        nextPreviewIndex({
            index: 0,
            playable: [false, false],
            repeatMode: "all",
        }),
        null,
    );
});

test("starting on a song with no clip starts on the next one that has one", () => {
    assert.equal(firstPlayableFrom(0, [false, true]), 1);
    assert.equal(firstPlayableFrom(1, [true, false]), null);
});
