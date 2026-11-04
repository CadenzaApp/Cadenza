import assert from "node:assert/strict";
import { converter } from "culori";
import test from "node:test";

import {
    averageArtworkColors,
    distinctColors,
    nebulaColor,
    randomImageRegions,
} from "./artwork-color-utils.ts";

test("averages the available artwork colors in Oklab", () => {
    assert.equal(
        averageArtworkColors(["#ff0000", "#00ff00", "#0000ff", "#ffffff"]),
        "#a3acab",
    );
    assert.equal(averageArtworkColors([null, "#204060", undefined]), "#204060");
    assert.equal(averageArtworkColors([null, "invalid"]), null);
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

test("random image regions repeat for a seed and stay inside the image", () => {
    const first = randomImageRegions("https://example.com/a.jpg", 8, 0.2);
    assert.deepEqual(
        randomImageRegions("https://example.com/a.jpg", 8, 0.2),
        first,
    );
    assert.notDeepEqual(
        randomImageRegions("https://example.com/b.jpg", 8, 0.2),
        first,
    );
    for (const region of first) {
        assert.ok(region.x >= 0 && region.x + region.width <= 1);
        assert.ok(region.y >= 0 && region.y + region.height <= 1);
    }
});
