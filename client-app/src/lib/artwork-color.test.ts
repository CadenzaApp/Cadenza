import assert from "node:assert/strict";
import test from "node:test";

import {
    averageArtworkColors,
    createTintGradient,
    sampleTintGradientColor,
} from "./artwork-color-utils.ts";

test("averages the available artwork colors in Oklab", () => {
    assert.equal(
        averageArtworkColors(["#ff0000", "#00ff00", "#0000ff", "#ffffff"]),
        "#a3acab",
    );
    assert.equal(averageArtworkColors([null, "#204060", undefined]), "#204060");
    assert.equal(averageArtworkColors([null, "invalid"]), null);
});

test("samples shared dark and light tint gradients in Oklch", () => {
    assert.deepEqual(createTintGradient("#8c5939", "dark").colors, [
        "#7e5f4d",
        "#6b5040",
        "#594133",
        "#473326",
        "#37251a",
        "#26180f",
        "#170c05",
        "#090301",
        "#010000",
    ]);
    assert.deepEqual(createTintGradient("#8c5939", "light").colors, [
        "#cca289",
        "#d2ab94",
        "#d8b4a0",
        "#ddbdab",
        "#e3c7b6",
        "#e8d0c2",
        "#eed9ce",
        "#f3e3d9",
        "#f8ece5",
    ]);
    assert.equal(sampleTintGradientColor("#8c5939", "dark", 0.5), "#37251a");
});
