import assert from "node:assert/strict";
import test from "node:test";

import { sortTagSelectorItems, visibleTagSelectorItems } from "./sort-tags.ts";

const tags = [
    { id: 1, name: "ambient" },
    { id: 2, name: "rock" },
    { id: 3, name: "indie" },
    { id: 4, name: "metal" },
];
const metadata = {
    1: { count: 2 },
    2: { count: 100 },
    3: { count: 20 },
    4: { count: 1 },
};

test("single-song order is chosen, suggestion match, then frequency", () => {
    assert.deepEqual(
        sortTagSelectorItems(
            tags,
            {
                kind: "single",
                initiallyChosenIds: new Set([4]),
                suggestedNames: new Set(["indie"]),
            },
            metadata,
        ).map((tag) => tag.id),
        [4, 3, 2, 1],
    );
});

test("multi-song order is present on any song, then frequency", () => {
    assert.deepEqual(
        sortTagSelectorItems(
            tags,
            { kind: "multiple", initiallyPresentIds: new Set([1, 4]) },
            metadata,
        ).map((tag) => tag.id),
        [1, 4, 2, 3],
    );
});

test("pagination reveals one page while keeping adopted tags visible", () => {
    const manyTags = Array.from({ length: 45 }, (_, index) => ({
        id: index + 1,
    }));
    assert.deepEqual(
        visibleTagSelectorItems(manyTags, 20, [41]).map((tag) => tag.id),
        [...Array.from({ length: 20 }, (_, index) => index + 1), 41],
    );
    assert.equal(visibleTagSelectorItems(manyTags, 40).length, 40);
});
