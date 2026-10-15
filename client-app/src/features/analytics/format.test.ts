import assert from "node:assert/strict";
import test from "node:test";

import {
    formatUpdatedAgo,
    formatCount,
    formatDuration,
    formatPercent,
} from "./format.ts";

test("durations read in the largest unit that fits", () => {
    assert.equal(formatDuration(0), "0m");
    assert.equal(formatDuration(48_000), "48s");
    assert.equal(formatDuration(60_000), "1m");
    assert.equal(formatDuration(24 * 60_000), "24m");
    assert.equal(formatDuration(3 * 3_600_000), "3h");
    assert.equal(formatDuration(3 * 3_600_000 + 24 * 60_000), "3h 24m");
});

test("a duration never rounds away to nothing", () => {
    assert.equal(formatDuration(1_500), "1s");
    assert.equal(formatDuration(-5), "0m");
    assert.equal(formatDuration(Number.NaN), "0m");
});

test("rates read as whole percents", () => {
    assert.equal(formatPercent(0), "0%");
    assert.equal(formatPercent(0.176), "18%");
    assert.equal(formatPercent(1), "100%");
    assert.equal(formatPercent(Number.NaN), "0%");
});

test("counts get thousands separators", () => {
    assert.equal(formatCount(0), "0");
    assert.equal(formatCount(412), "412");
    assert.equal(formatCount(1240), "1,240");
});

test("updated ago reads in the biggest whole unit", () => {
    const now = new Date(2026, 9, 3, 12, 0);
    const ago = (ms: number) =>
        formatUpdatedAgo(new Date(now.getTime() - ms), now);
    assert.equal(ago(20_000), "just now");
    assert.equal(ago(5 * 60_000), "5m ago");
    assert.equal(ago(3 * 3_600_000), "3h ago");
    assert.equal(ago(50 * 3_600_000), "2d ago");
});
