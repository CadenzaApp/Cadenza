import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    CSS_TOKENS,
    PALETTE,
    BACKGROUND_PRESETS,
    cssVarName,
    paletteCssVars,
    resolvePalette,
    schemeForBackground,
} from "./tokens.ts";

/** The `--name: value;` pairs inside the first block that opens with `selector {`. */
function cssBlockVars(css: string, selector: string): Map<string, string> {
    const start = css.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `global.css has no ${selector} block`);
    const body = css.slice(start, css.indexOf("}", start));
    const vars = new Map<string, string>();
    for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
        vars.set(match[1], match[2].trim());
    }
    return vars;
}

const css = readFileSync(
    new URL("../../../global.css", import.meta.url).pathname,
    "utf8",
);

test("global.css mirrors every CSS token in both schemes", () => {
    for (const [scheme, selector] of [
        ["light", ":root"],
        ["dark", ".dark:root"],
    ] as const) {
        const vars = cssBlockVars(css, selector);
        for (const token of CSS_TOKENS) {
            assert.equal(
                vars.get(cssVarName(token)),
                PALETTE[scheme][token],
                `${selector} ${cssVarName(token)}`,
            );
        }
    }
});

test("css var names are kebab case", () => {
    assert.equal(cssVarName("cardForeground"), "--card-foreground");
    assert.equal(cssVarName("brand"), "--brand");
});

test("an accent override replaces only brand", () => {
    const palette = resolvePalette("dark", { accent: "#3a81f6" });
    assert.equal(palette.brand, "#3a81f6");
    assert.equal(palette.card, PALETTE.dark.card);
    assert.equal(resolvePalette("light", { accent: null }), PALETTE.light);
});

test("palette css vars cover every css token", () => {
    const vars = paletteCssVars(PALETTE.light);
    assert.equal(Object.keys(vars).length, CSS_TOKENS.length);
    assert.equal(vars["--brand"], PALETTE.light.brand);
});

test("a background picks light or dark text by its brightness", () => {
    assert.equal(schemeForBackground("#101a2f"), "dark");
    assert.equal(schemeForBackground("#fbf6e9"), "light");
    assert.equal(schemeForBackground("#000000"), "dark");
    assert.equal(schemeForBackground("#ffffff"), "light");
});

test("a custom background is drawn and every surface moves off it", () => {
    for (const background of BACKGROUND_PRESETS) {
        const scheme = schemeForBackground(background);
        const palette = resolvePalette(scheme, { accent: null, background });
        assert.equal(palette.background, background);
        assert.notEqual(palette.card, background);
        assert.notEqual(palette.border, background);
        assert.equal(palette.foreground, PALETTE[scheme].foreground);
    }
});
