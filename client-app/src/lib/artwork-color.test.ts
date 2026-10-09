import assert from "node:assert/strict";
import { converter } from "culori";
import test from "node:test";

import {
    averageArtworkColors,
    createTintGradient,
    distinctColors,
    nebulaColor,
    tintFadeAt,
} from "./artwork-color-utils.ts";

test("averages the available artwork colors in Oklab", () => {
    assert.equal(
        averageArtworkColors(["#ff0000", "#00ff00", "#0000ff", "#ffffff"]),
        "#a3acab",
    );
    assert.equal(averageArtworkColors([null, "#204060", undefined]), "#204060");
    assert.equal(averageArtworkColors([null, "invalid"]), null);
});

test("the tint fades as 1/x down the page, x running 1 to 2", () => {
    assert.equal(tintFadeAt(0), 0);
    assert.equal(tintFadeAt(1), 0.5);
    assert.ok(Math.abs(tintFadeAt(0.5) - 1 / 3) < 1e-12);
    // clamped either side
    assert.equal(tintFadeAt(-1), 0);
    assert.equal(tintFadeAt(3), 0.5);
});

test("a page's tint starts at the top color and stops halfway to the end", () => {
    const dark = createTintGradient("#8c5939", "dark").colors;
    assert.equal(dark[0], "#7e5f4d");
    // halfway between the top color and the end color
    assert.equal(dark[dark.length - 1], "#37251a");
    const light = createTintGradient("#8c5939", "light").colors;
    assert.equal(light[0], "#cca289");
    assert.equal(light[light.length - 1], "#e3c7b6");
});

test("a nebula color holds to its mode's lightness band and caps chroma", () => {
    const toOklch = converter("oklch");
    for (const [hex, scheme, minL, maxL, maxC] of [
        ["#050510", "dark", 0.5, 0.68, 0.16],
        ["#ff00ff", "dark", 0.5, 0.68, 0.16],
        ["#050510", "light", 0.72, 0.86, 0.12],
        ["#ffff00", "light", 0.72, 0.86, 0.12],
    ] as const) {
        const color = toOklch(nebulaColor(hex, scheme));
        assert.ok(color);
        assert.ok(color.l > minL - 0.01 && color.l < maxL + 0.01, hex);
        assert.ok(color.c < maxC + 0.01, hex);
    }
});

test("distinct colors keeps order, drops repeats and near repeats", () => {
    assert.deepEqual(
        distinctColors(
            [
                "#ff0000",
                "#00ff00",
                "#FF0000",
                "#fe0101",
                null,
                "bad",
                "#0000ff",
            ],
            5,
        ),
        ["#ff0000", "#00ff00", "#0000ff"],
    );
});

test("distinct colors stops at the count", () => {
    assert.deepEqual(distinctColors(["#ff0000", "#00ff00", "#0000ff"], 2), [
        "#ff0000",
        "#00ff00",
    ]);
});
