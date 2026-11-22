import assert from "node:assert/strict";
import test from "node:test";

import {
    pageOffsetAtBarX,
    playerPillMask,
    releasedPageIndex,
} from "./player-bar-drag.ts";

test("the pill jumps to the thumb position and follows it instead of applying a delta", () => {
    assert.equal(pageOffsetAtBarX(52, 100, 400, 3, 2), 0);
    assert.equal(pageOffsetAtBarX(102, 100, 400, 3, 2), 200);
    assert.equal(pageOffsetAtBarX(152, 100, 400, 3, 2), 400);
    assert.equal(pageOffsetAtBarX(252, 100, 400, 3, 2), 800);
});

test("thumb positions clamp at both ends of the bar", () => {
    assert.equal(pageOffsetAtBarX(-50, 100, 400, 3, 2), 0);
    assert.equal(pageOffsetAtBarX(500, 100, 400, 3, 2), 800);
});

test("the glyph masks share the exact pill boundary, including between tabs", () => {
    for (const position of [0, 0.25, 0.5, 1, 1.5, 2]) {
        const mask = playerPillMask(position, 300, 58, 3);
        assert.ok(mask.left >= 0);
        assert.ok(mask.left + mask.width <= 300);
        assert.equal(mask.outside, `M0,0H300V58H0Z${mask.inside}`);
    }
    assert.equal(playerPillMask(0.5, 300, 58, 3).width, 112);
});

test("a slow release chooses the nearest tab and a flick projects forward", () => {
    assert.equal(releasedPageIndex(560, 0, 100, 400, 3), 1);
    assert.equal(releasedPageIndex(640, 0, 100, 400, 3), 2);
    assert.equal(releasedPageIndex(560, 200, 100, 400, 3), 2);
    assert.equal(releasedPageIndex(400, -500, 100, 400, 3), 0);
    assert.equal(releasedPageIndex(800, 1000, 100, 400, 3), 2);
});

test("a drag before layout has safe offsets", () => {
    assert.equal(pageOffsetAtBarX(20, 0, 400, 3), 0);
    assert.equal(releasedPageIndex(0, 0, 0, 0, 3), 0);
});
