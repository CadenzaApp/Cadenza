import assert from "node:assert/strict";
import test from "node:test";

import { keyboardOverlap } from "./keyboard-overlap.ts";

test("a sheet that stays in place clears the whole keyboard", () => {
    assert.equal(keyboardOverlap(340, 720, 720), 340);
});

test("native resizing is not counted twice", () => {
    assert.equal(keyboardOverlap(340, 720, 380), 0);
    assert.equal(keyboardOverlap(340, 720, 520), 140);
});

test("a taller sheet and a hidden keyboard never produce negative padding", () => {
    assert.equal(keyboardOverlap(340, 720, 750), 340);
    assert.equal(keyboardOverlap(0, 720, 380), 0);
});
