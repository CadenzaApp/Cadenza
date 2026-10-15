import assert from "node:assert/strict";
import test from "node:test";

import { nextAction, previousAction } from "./transport.ts";

test("back restarts after four seconds, otherwise goes back", () => {
    assert.equal(previousAction({ index: 2, progress: 4.5 }), "restart");
    assert.equal(previousAction({ index: 2, progress: 3 }), "previous");
});

test("back with nothing before restarts", () => {
    assert.equal(previousAction({ index: 0, progress: 1 }), "restart");
    assert.equal(previousAction({ index: -1, progress: 1 }), "restart");
});

test("forward with a next entry always goes to it", () => {
    for (const repeatMode of ["off", "one", "all"] as const) {
        assert.equal(nextAction({ index: 0, length: 2, repeatMode }), "next");
    }
});

test("forward at the end follows the repeat mode", () => {
    const end = { index: 2, length: 3 };
    assert.equal(nextAction({ ...end, repeatMode: "off" }), "rewind");
    assert.equal(nextAction({ ...end, repeatMode: "one" }), "replay");
    assert.equal(nextAction({ ...end, repeatMode: "all" }), "wrap");
});

test("forward on a one song queue with repeat all replays it", () => {
    assert.equal(
        nextAction({ index: 0, length: 1, repeatMode: "all" }),
        "replay",
    );
});
