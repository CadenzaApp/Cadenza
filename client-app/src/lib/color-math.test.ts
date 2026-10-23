import assert from "node:assert/strict";
import test from "node:test";

import { hexToHsv, hsvToHex, normalizeHex } from "./color-math.ts";

test("primaries convert both ways", () => {
    assert.equal(hsvToHex({ h: 0, s: 1, v: 1 }), "#ff0000");
    assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), "#00ff00");
    assert.equal(hsvToHex({ h: 240, s: 1, v: 1 }), "#0000ff");
    assert.deepEqual(hexToHsv("#0000ff"), { h: 240, s: 1, v: 1 });
});

test("a color survives a round trip", () => {
    for (const hex of ["#ff9f0a", "#0a84ff", "#bf5af2", "#30d158", "#808080"]) {
        assert.equal(hsvToHex(hexToHsv(hex)), hex);
    }
});

test("grays and black have no saturation", () => {
    assert.equal(hexToHsv("#000000").s, 0);
    assert.equal(hexToHsv("#ffffff").s, 0);
});

test("hex text normalizes with or without the hash", () => {
    assert.equal(normalizeHex("FF9F0A"), "#ff9f0a");
    assert.equal(normalizeHex(" #0a84ff "), "#0a84ff");
    assert.equal(normalizeHex("#fff"), null);
    assert.equal(normalizeHex("blue"), null);
});
