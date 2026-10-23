import assert from "node:assert/strict";
import test from "node:test";

import { withoutExplicit } from "./explicit-filter.ts";

type Item = { id: string; isExplicit?: boolean };

const clean: Item = { id: "a" };
const explicit: Item = { id: "b", isExplicit: true };
const rated: Item = { id: "c", isExplicit: false };

test("keeps everything when not hiding", () => {
    const items = [clean, explicit];
    assert.equal(withoutExplicit(items, false), items);
});

test("drops only items rated explicit", () => {
    assert.deepEqual(withoutExplicit([clean, explicit, rated], true), [
        clean,
        rated,
    ]);
});

test("returns the same array when nothing is dropped", () => {
    const items = [clean, rated];
    assert.equal(withoutExplicit(items, true), items);
});
