import assert from "node:assert/strict";
import test from "node:test";

import { shareOf, sharePercent } from "./tag-share.ts";

const MIN = 60_000;

// 60 minutes of listening, three tags overlapping on the same songs
const TOTAL = 60 * MIN;
const TAGS = [
    { id: 3, listening_ms: 42 * MIN },
    { id: 1, listening_ms: 30 * MIN },
    { id: 2, listening_ms: 24 * MIN },
];

test("overlapping tags each keep their full share, never normalized", () => {
    const percents = TAGS.map((tag) =>
        sharePercent(shareOf(tag.listening_ms, TOTAL)),
    );
    assert.deepEqual(percents, [70, 50, 40]);
    assert.equal(
        percents.reduce((sum, p) => sum + p, 0),
        160,
        "overlap sums past 100",
    );
});

test("nothing played is a zero share, not a division by zero", () => {
    assert.equal(shareOf(0, 0), 0);
    assert.equal(shareOf(5 * MIN, 0), 0);
});

test("a share never runs past the whole bar", () => {
    assert.equal(shareOf(70 * MIN, TOTAL), 1);
});
