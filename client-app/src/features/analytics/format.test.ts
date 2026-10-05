import assert from "node:assert/strict";
import test from "node:test";

import {
    formatBucket,
    formatUpdatedAgo,
    formatCount,
    formatDuration,
    formatHour,
    formatPercent,
    labelledIndices,
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

test("hours read as a twelve hour clock", () => {
    assert.equal(formatHour(0), "12 AM");
    assert.equal(formatHour(9), "9 AM");
    assert.equal(formatHour(12), "12 PM");
    assert.equal(formatHour(14), "2 PM");
    assert.equal(formatHour(23), "11 PM");
});

test("a bucket label fits how wide the bucket is", () => {
    assert.equal(formatBucket("2026-09-07", "day"), "Sep 7");
    assert.equal(formatBucket("2026-09-07", "week"), "Sep 7");
    assert.equal(formatBucket("2026-09-01", "month"), "Sep");
    assert.equal(formatBucket("2026-01-01", "year"), "2026");
    assert.equal(formatBucket("2026-09-07T21:00", "hour"), "9 PM");
});

test("a bucket that is not a date comes back as it went in", () => {
    assert.equal(formatBucket("nonsense", "day"), "nonsense");
});

test("a short axis labels every bucket", () => {
    assert.deepEqual([...labelledIndices(3)], [0, 1, 2]);
    assert.deepEqual([...labelledIndices(5)], [0, 1, 2, 3, 4]);
});

test("a long axis labels at most five, including both ends", () => {
    const picked = labelledIndices(40);
    assert.ok(picked.size <= 5);
    assert.ok(picked.has(0), "the first bucket is labelled");
    assert.ok(picked.has(39), "so is the last");
});

test("an empty axis labels nothing", () => {
    assert.equal(labelledIndices(0).size, 0);
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
