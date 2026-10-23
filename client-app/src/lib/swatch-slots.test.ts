import assert from "node:assert/strict";
import test from "node:test";

import {
    firstEmptySlot,
    resolveSwatchSlots,
    selectionAfterEdit,
    setSwatchSlot,
} from "./swatch-slots.ts";

const SWATCH_SLOT_COUNT = 10;

test("no saved slots shows the presets, then empty slots", () => {
    const slots = resolveSwatchSlots(
        null,
        ["#111111", "#222222"],
        SWATCH_SLOT_COUNT,
    );
    assert.equal(slots.length, SWATCH_SLOT_COUNT);
    assert.deepEqual(slots.slice(0, 3), ["#111111", "#222222", null]);
    assert.equal(firstEmptySlot(slots), 2);
});

test("saved slots win over the presets, even when emptied", () => {
    const slots = resolveSwatchSlots(
        [null, "#333333"],
        ["#111111"],
        SWATCH_SLOT_COUNT,
    );
    assert.deepEqual(slots.slice(0, 2), [null, "#333333"]);
});

test("a full list has no empty slot", () => {
    const full = Array.from({ length: SWATCH_SLOT_COUNT }, () => "#000000");
    assert.equal(firstEmptySlot(full), -1);
});

test("setting a slot touches only that slot", () => {
    assert.deepEqual(setSwatchSlot(["#111111", null], 1, "#222222"), [
        "#111111",
        "#222222",
    ]);
});

test("removing the selected color drops the selection", () => {
    assert.equal(
        selectionAfterEdit("#111111", ["#111111", null], 0, null),
        null,
    );
});

test("changing the selected color follows it", () => {
    assert.equal(
        selectionAfterEdit("#111111", ["#111111"], 0, "#222222"),
        "#222222",
    );
});

test("editing another slot, or a duplicate, keeps the selection", () => {
    assert.equal(
        selectionAfterEdit("#111111", ["#111111", "#222222"], 1, null),
        "#111111",
    );
    assert.equal(
        selectionAfterEdit("#111111", ["#111111", "#111111"], 0, null),
        "#111111",
    );
    assert.equal(selectionAfterEdit(null, ["#111111"], 0, null), null);
});
