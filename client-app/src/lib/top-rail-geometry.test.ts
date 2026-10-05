import assert from "node:assert/strict";
import test from "node:test";

import { nextRailShown } from "./top-rail-geometry.ts";

/** Runs a scroller through `offsets` from `start`, returning the last target. */
function run(offsets: number[], start = 1): number {
    let shown = start;
    for (let i = 1; i < offsets.length; i++) {
        shown = nextRailShown(shown, offsets[i - 1], offsets[i]);
    }
    return shown;
}

test("a scroll down off the top hides the rail", () => {
    assert.equal(run([0, 10, 30]), 0);
});

test("a scroll up partway down leaves it hidden", () => {
    assert.equal(run([800, 600, 300, 20], 0), 0);
});

test("reaching the top shows it again", () => {
    assert.equal(run([300, 100, 2], 0), 1);
    assert.equal(run([300, -40, -10, 0], 0), 1, "the bounce at the top");
});

test("a scroll up partway down does not hide a shown rail either", () => {
    assert.equal(run([0, -30, -5]), 1);
});
