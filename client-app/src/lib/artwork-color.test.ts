import assert from "node:assert/strict";
import test from "node:test";

import {
    averageArtworkColors,
    createTintGradient,
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
