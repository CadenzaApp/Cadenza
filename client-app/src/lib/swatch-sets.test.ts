import assert from "node:assert/strict";
import test from "node:test";

import {
    MAX_SWATCHES,
    SWATCH_SETS,
    customBackground,
    slotCount,
    swatchSetEdit,
} from "./swatch-sets.ts";
import { BACKGROUND_PRESETS } from "./theme/tokens.ts";

test("every swatch set fits the backend cap and holds its presets", () => {
    for (const [kind, set] of Object.entries(SWATCH_SETS)) {
        assert.ok(slotCount(set) <= MAX_SWATCHES, `${kind} is over the cap`);
        assert.ok(
            set.presets.length <= slotCount(set),
            `${kind} has more presets than slots`,
        );
    }
});

test("slot counts leave room for the fixed circle and the +", () => {
    assert.equal(slotCount(SWATCH_SETS.accent), 10);
    assert.equal(slotCount(SWATCH_SETS.background), 11);
    assert.equal(slotCount(SWATCH_SETS.tagColor), 19);
});

test("removing the picked accent falls back to the fixed default", () => {
    const slots = [null, "#30d158"];
    assert.deepEqual(swatchSetEdit(SWATCH_SETS.accent, slots, null), {
        accent_swatches: slots,
        accent_color: null,
    });
});

test("removing the picked background moves to the first one left", () => {
    const slots = [null, "#222326", "#fbf6e9"];
    assert.deepEqual(swatchSetEdit(SWATCH_SETS.background, slots, null), {
        background_swatches: slots,
        background_color: "#222326",
    });
});

test("a tag color edit saves only the slots", () => {
    const slots = ["#b01843"];
    assert.deepEqual(swatchSetEdit(SWATCH_SETS.tagColor, slots, "#b01843"), {
        tag_color_swatches: slots,
    });
});

test("the custom background falls back to the grid, then the presets", () => {
    assert.equal(
        customBackground({
            background_color: "#123456",
            background_swatches: null,
        }),
        "#123456",
    );
    assert.equal(
        customBackground({
            background_color: null,
            background_swatches: [null, "#fbf6e9"],
        }),
        "#fbf6e9",
    );
    assert.equal(
        customBackground({
            background_color: null,
            background_swatches: [null, null],
        }),
        BACKGROUND_PRESETS[0],
    );
});
