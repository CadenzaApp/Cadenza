import assert from "node:assert/strict";
import test from "node:test";

import {
    averageArtworkColors,
    createTrackCollectionGradientColors,
    sampleTrackCollectionGradientColor,
} from "./artwork-color-utils.ts";

test("averages the available artwork colors in Oklab", () => {
    assert.equal(
        averageArtworkColors(["#ff0000", "#00ff00", "#0000ff", "#ffffff"]),
        "#a3acab",
    );
    assert.equal(averageArtworkColors([null, "#204060", undefined]), "#204060");
    assert.equal(averageArtworkColors([null, "invalid"]), null);
});

test("samples dark and light collection gradients in Oklch", () => {
    assert.deepEqual(createTrackCollectionGradientColors("#8c5939", "dark"), [
        "#7b6152",
        "#685144",
        "#574236",
        "#453329",
        "#35261c",
        "#251810",
        "#160c06",
        "#090301",
        "#010000",
    ]);
    assert.deepEqual(createTrackCollectionGradientColors("#8c5939", "light"), [
        "#7b6152",
        "#897163",
        "#998274",
        "#a89386",
        "#b8a498",
        "#c8b6ab",
        "#d8c7be",
        "#e8dad1",
        "#f8ece5",
    ]);
    assert.equal(
        sampleTrackCollectionGradientColor("#8c5939", "dark", 0.5),
        "#35261c",
    );
});
