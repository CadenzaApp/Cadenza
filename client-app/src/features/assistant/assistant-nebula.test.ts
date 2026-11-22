import assert from "node:assert/strict";
import test from "node:test";

import { hexToHsv } from "../../lib/color-math.ts";
import { assistantNebulaColors } from "./assistant-nebula.ts";

test("the accent leads, followed by two companions", () => {
    const colors = assistantNebulaColors("#ff6467");
    assert.equal(colors.length, 3);
    assert.equal(colors[0], "#ff6467");
    for (const color of colors) assert.match(color, /^#[0-9a-f]{6}$/);
});

test("companions turn the accent's hue", () => {
    const [accent, warm, cool] = assistantNebulaColors("#4f9dff").map(hexToHsv);
    const turned = (from: number, to: number) => (to - from + 360) % 360;
    assert.ok(Math.abs(turned(accent.h, warm.h) - 40) < 2);
    assert.ok(Math.abs(turned(accent.h, cool.h) - 250) < 2);
});

test("a gray accent stays gray", () => {
    for (const color of assistantNebulaColors("#808080")) {
        assert.equal(hexToHsv(color).s, 0);
    }
});
