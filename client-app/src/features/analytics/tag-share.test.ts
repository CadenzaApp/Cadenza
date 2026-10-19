import assert from "node:assert/strict";
import test from "node:test";

import {
    UNTAGGED_TAG_ID,
    formatSharePercent,
    listeningTag,
    shareOf,
    sharePercent,
    withUntagged,
} from "./tag-share.ts";

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

test("a played tag that rounds to nothing reads <1%, never 0%", () => {
    assert.equal(formatSharePercent(3_000, TOTAL), "<1%");
    assert.equal(formatSharePercent(0, TOTAL), "0%");
    assert.equal(formatSharePercent(42 * MIN, TOTAL), "70%");
    assert.equal(formatSharePercent(0, 0), "0%");
});

const tag = (id: number, minutes: number) => ({
    id,
    name: `Tag ${id}`,
    color: "#000000",
    type: "basic" as const,
    listening_ms: minutes * MIN,
});

test("untagged time joins the tags in order of its time", () => {
    // 60 minutes, 45 of them on a tagged song: 15 untagged
    const shown = withUntagged([tag(1, 40), tag(2, 10)], TOTAL, 45 * MIN);
    assert.deepEqual(
        shown.map((each) => each.id),
        [1, UNTAGGED_TAG_ID, 2],
    );
    assert.equal(shown[1].listening_ms, 15 * MIN);
});

test("no untagged time adds no untagged entry", () => {
    assert.equal(withUntagged([tag(1, 60)], TOTAL, TOTAL).length, 1);
    assert.equal(withUntagged([], 0, 0).length, 0);
});

test("untagged goes last when it is the least", () => {
    const shown = withUntagged([tag(1, 50)], TOTAL, 55 * MIN);
    assert.equal(shown.at(-1)?.id, UNTAGGED_TAG_ID);
});

test("the untagged entry filters the reads as untagged", () => {
    assert.equal(listeningTag(null), null);
    assert.equal(listeningTag({ ...tag(7, 0) }), 7);
    assert.equal(
        listeningTag({ ...tag(UNTAGGED_TAG_ID, 0), name: "Untagged" }),
        "untagged",
    );
});
