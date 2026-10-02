import assert from "node:assert/strict";
import test from "node:test";

import { converter, wcagContrast } from "culori";

import {
    TAG_CHROMATIC_COLOR_OPTIONS,
    TAG_COLOR_OPTIONS,
    TAG_NEUTRAL_COLOR_OPTIONS,
    TAG_YELLOW_COLOR,
} from "./tag-color-palette.ts";

const toOklch = converter("oklch");
const toRgb = converter("rgb");
const black = { mode: "rgb", r: 0, g: 0, b: 0 } as const;
const white = { mode: "rgb", r: 1, g: 1, b: 1 } as const;
test("tag palette spans the hue wheel and preserves brown and gray neutrals", () => {
    assert.equal(TAG_COLOR_OPTIONS.length, 15);
    assert.equal(TAG_CHROMATIC_COLOR_OPTIONS.length, 13);
    assert.deepEqual(TAG_NEUTRAL_COLOR_OPTIONS, ["#8c5939", "#6b7281"]);

    const hues = TAG_CHROMATIC_COLOR_OPTIONS.map((hex) => {
        const color = toOklch(hex);
        assert.ok(color, `${hex} should parse as a color`);
        assert.ok(color.c >= 0.08, `${hex} should remain visibly chromatic`);
        return color.h ?? 0;
    }).sort((left, right) => left - right);

    const hueGaps = hues.map(
        (hue, index) => (hues[(index + 1) % hues.length] - hue + 360) % 360,
    );
    assert.ok(Math.max(...hueGaps) <= 61, "no large gap in the hue range");
});

test("chromatic tag colors are sorted by hue before the neutrals", () => {
    const hues = TAG_CHROMATIC_COLOR_OPTIONS.map((hex) => {
        const color = toOklch(hex);
        assert.ok(color?.h !== undefined, `${hex} should have a hue`);
        return color.h;
    });

    assert.deepEqual(
        hues,
        [...hues].sort((left, right) => left - right),
    );
    assert.deepEqual(
        TAG_COLOR_OPTIONS.slice(-TAG_NEUTRAL_COLOR_OPTIONS.length),
        TAG_NEUTRAL_COLOR_OPTIONS,
    );
});

test("tag palette has usable contrast against black and white", () => {
    for (const hex of TAG_COLOR_OPTIONS) {
        const color = toRgb(hex);
        assert.ok(color, `${hex} should parse as a color`);

        const blackContrast = wcagContrast(color, black);
        const whiteContrast = wcagContrast(color, white);

        const dualBackgroundMinimum = hex === TAG_YELLOW_COLOR ? 2.5 : 3;
        assert.ok(
            Math.min(blackContrast, whiteContrast) >= dualBackgroundMinimum,
            `${hex} needs at least ${dualBackgroundMinimum}:1 against black and white`,
        );
        assert.ok(
            Math.max(blackContrast, whiteContrast) >= 4.5,
            `${hex} needs at least 4.5:1 contrast against one text color`,
        );
    }
});

test("yellow stays brighter and saturated", () => {
    const yellow = toOklch(TAG_YELLOW_COLOR);
    assert.ok(yellow, "yellow should parse as a color");
    assert.ok(yellow.l >= 0.7, "yellow should stay bright");
    assert.ok(yellow.c >= 0.15, "yellow should stay saturated");
});
