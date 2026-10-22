import assert from "node:assert/strict";
import { converter } from "culori";
import test from "node:test";

import {
    averageArtworkColors,
    createArtistGradient,
    contrastPalette,
    gradientColorAt,
    oklabLightness,
    mixSurfaceColor,
    surfaceColorAt,
    tintViewport,
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

test("loading gradients stay pure black in dark mode and pure white in light mode", () => {
    assert.ok(
        createTintGradient("#000000", "dark").colors.every(
            (color) => color === "#000000",
        ),
    );
    assert.ok(
        createTintGradient("#ffffff", "light").colors.every(
            (color) => color === "#ffffff",
        ),
    );
});

const toOklch = converter("oklch");
test("portrait gradients start at the exact sample and approach a mode-aware Oklch shade", () => {
    for (const sample of [
        "#bf7983",
        "#658bab",
        "#e9d9a0",
        "#ffffff",
        "#000000",
    ]) {
        const original = toOklch(sample)!;
        for (const mode of ["dark", "light"] as const) {
            const { colors } = createArtistGradient(sample, mode);
            assert.equal(colors[0], sample);
            assert.equal(colors.length, 9);
            const target = toOklch(colors.at(-1)!)!;
            assert.ok(target.c <= original.c * 0.12 + 0.005);
            const expectedL =
                mode === "dark"
                    ? original.l * 0.15
                    : original.l + (1 - original.l) * 0.92;
            assert.ok(Math.abs(target.l - expectedL) < 0.01);
            let previous = original.l;
            for (const color of colors.slice(1)) {
                const lightness = toOklch(color)!.l;
                assert.ok(
                    mode === "dark"
                        ? lightness <= previous + 0.001
                        : lightness >= previous - 0.001,
                );
                previous = lightness;
            }
        }
    }
});

const toOklab = converter("oklab");
test("portrait alpha-mask sampling reveals the background at the same vertical position", () => {
    const colors = ["#ffffff", "#000000"];
    const artwork = { color: "#ff0000", height: 400, fadeStart: 0.2 };
    assert.equal(surfaceColorAt(colors, 2400, 80, artwork), artwork.color);
    assert.equal(
        surfaceColorAt(colors, 2400, 240, artwork),
        mixSurfaceColor(artwork.color, gradientColorAt(colors, 0.1), 0.5),
    );
    assert.equal(
        surfaceColorAt(colors, 2400, 400, artwork),
        gradientColorAt(colors, 400 / 2400),
    );
});
test("worklet Oklab lightness agrees with culori for neutral and saturated surfaces", () => {
    for (const color of [
        "#ffffff",
        "#000000",
        "#808080",
        "#ff0000",
        "#00ff00",
        "#0000ff",
        "#abcd12",
    ]) {
        assert.ok(
            Math.abs(oklabLightness(color) - toOklab(color)!.l) < 0.000001,
        );
    }
});
test("white artwork gets black ink and black artwork gets white ink regardless of app theme", () => {
    assert.equal(contrastPalette("#ffffff").foreground, "#000000");
    assert.equal(contrastPalette("#000000").foreground, "#ffffff");
    assert.equal(contrastPalette("#ff0000").foreground, "#000000");
    assert.equal(contrastPalette("#0000ff").foreground, "#ffffff");
});
test("secondary text stays on the same contrast side with sufficient perceptual separation", () => {
    for (const color of [
        "#ffffff",
        "#000000",
        "#555555",
        "#999999",
        "#ff0000",
        "#0000ff",
    ]) {
        const palette = contrastPalette(color);
        const primaryDelta = Math.abs(
            oklabLightness(palette.foreground) - oklabLightness(color),
        );
        const secondaryDelta = Math.abs(
            oklabLightness(palette.secondary) - oklabLightness(color),
        );
        assert.ok(secondaryDelta < primaryDelta);
        assert.ok(secondaryDelta >= primaryDelta * 0.73);
    }
});
test("sampling follows native stop interpolation and clamps overscroll", () => {
    const colors = ["#ffffff", "#000000"];
    assert.equal(gradientColorAt(colors, -1), "#ffffff");
    assert.equal(gradientColorAt(colors, 0.5), "#808080");
    assert.equal(gradientColorAt(colors, 2), "#000000");
    assert.equal(
        contrastPalette(surfaceColorAt(colors, 1000, 50)).foreground,
        "#000000",
    );
    assert.equal(
        contrastPalette(surfaceColorAt(colors, 1000, 950)).foreground,
        "#ffffff",
    );
});
test("artist hero uses the image's representative color before blending into the page", () => {
    const colors = ["#ffffff", "#000000"];
    const artwork = { color: "#ffffff", height: 400 };
    assert.equal(surfaceColorAt(colors, 1000, 50, artwork), "#ffffff");
    assert.equal(
        surfaceColorAt(colors, 1000, 400, artwork),
        gradientColorAt(colors, 0.4),
    );
});

test("a longer gradient does not extend actual scroll bounds", () => {
    assert.deepEqual(tintViewport(1200, 800, 600, 2400), {
        height: 2400,
        offset: 400,
    });
    assert.deepEqual(tintViewport(200, 800, -200, 2400), {
        height: 2400,
        offset: 0,
    });
});

test("rubber banding cannot expose a seam or move the gradient away from the top", () => {
    assert.deepEqual(tintViewport(2400, 800, -200), {
        height: 2400,
        offset: 0,
    });
    assert.deepEqual(tintViewport(2400, 800, 300), {
        height: 2400,
        offset: 300,
    });
});
test("bottom overscroll and short content always leave the entire viewport covered", () => {
    assert.deepEqual(tintViewport(2400, 800, 2000), {
        height: 2400,
        offset: 1600,
    });
    assert.deepEqual(tintViewport(200, 800, 50), { height: 800, offset: 0 });
    for (const scroll of [-1000, 0, 500, 1600, 3000]) {
        const { height, offset } = tintViewport(2400, 800, scroll);
        assert.ok(-offset <= 0);
        assert.ok(height - offset >= 800);
    }
});
