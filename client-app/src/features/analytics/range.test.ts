import assert from "node:assert/strict";
import test from "node:test";

import {
    ANALYTICS_RANGES,
    rangeDescription,
    rangeLabel,
    resolveRange,
} from "./range.ts";

/** A local-time moment, so the boundaries are the device's own. */
function local(
    year: number,
    month: number,
    day: number,
    hour = 12,
    minute = 0,
) {
    return new Date(year, month - 1, day, hour, minute);
}

/** The local Y-M-D a resolved bound lands on, for asserting boundaries. */
function localDay(iso?: string) {
    assert.ok(iso, "expected a bound");
    const date = new Date(iso);
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()] as const;
}

// ----- every range -----

test("every range has a label and a description", () => {
    for (const range of ANALYTICS_RANGES) {
        assert.ok(rangeLabel(range).length > 0, range);
        assert.ok(rangeDescription(range).length > 0, range);
    }
});

test("there are five ranges, Today through All", () => {
    assert.deepEqual(ANALYTICS_RANGES, [
        "today",
        "week",
        "month",
        "year",
        "all",
    ]);
});

test("every range but all is a bounded window", () => {
    const now = local(2026, 10, 3);
    for (const range of ANALYTICS_RANGES) {
        const resolved = resolveRange(range, now);
        if (range === "all") {
            assert.equal(resolved.since, undefined);
            assert.equal(resolved.until, undefined);
        } else {
            assert.ok(resolved.since, range);
            assert.ok(resolved.until, range);
            assert.ok(
                new Date(resolved.since) < new Date(resolved.until),
                `${range} window is backwards`,
            );
        }
    }
});

test("a play one minute ago is inside every bounded window", () => {
    const now = local(2026, 10, 3, 23, 59);
    for (const range of ANALYTICS_RANGES) {
        const { since, until } = resolveRange(range, now);
        if (!since || !until) continue;
        assert.ok(new Date(since) <= now, `${range} starts after now`);
        assert.ok(new Date(until) > now, `${range} ends before now`);
    }
});

// ----- the bucket each range picks -----

test("each range picks the bucket that gives it a readable number of bars", () => {
    const now = local(2026, 10, 3);
    assert.equal(resolveRange("week", now).bucket, "day");
    assert.equal(resolveRange("month", now).bucket, "day");
    assert.equal(resolveRange("year", now).bucket, "month");
    assert.equal(resolveRange("all", now).bucket, "auto");
});

test("today uses the hours chart, everything else a trend", () => {
    const now = local(2026, 10, 3);
    assert.equal(resolveRange("today", now).chart, "hours");
    for (const range of ["week", "month", "year", "all"] as const) {
        assert.equal(resolveRange(range, now).chart, "trend", range);
    }
});

// ----- the boundaries -----

test("today runs from local midnight to the next", () => {
    const { since, until } = resolveRange("today", local(2026, 10, 3, 14, 30));
    assert.deepEqual(localDay(since), [2026, 10, 3]);
    assert.deepEqual(localDay(until), [2026, 10, 4]);
    assert.equal(new Date(since!).getHours(), 0);
});

test("week covers seven local days, today included", () => {
    const { since, until } = resolveRange("week", local(2026, 10, 3));
    assert.deepEqual(localDay(since), [2026, 9, 27]);
    assert.deepEqual(localDay(until), [2026, 10, 4]);
});

test("month covers thirty local days", () => {
    const { since, until } = resolveRange("month", local(2026, 10, 3));
    assert.deepEqual(localDay(since), [2026, 9, 4]);
    assert.deepEqual(localDay(until), [2026, 10, 4]);
});

test("year covers twelve months, from the 1st", () => {
    const { since, until } = resolveRange("year", local(2026, 10, 3));
    assert.deepEqual(localDay(since), [2025, 11, 1]);
    assert.deepEqual(localDay(until), [2026, 11, 1]);
});

// ----- the edges that break naive date maths -----

test("a week spanning a month end still covers seven days", () => {
    const { since, until } = resolveRange("week", local(2026, 3, 2));
    assert.deepEqual(localDay(since), [2026, 2, 24]);
    assert.deepEqual(localDay(until), [2026, 3, 3]);
});

test("a year range on the 31st of December rolls over cleanly", () => {
    const { since, until } = resolveRange("year", local(2026, 12, 31));
    assert.deepEqual(localDay(since), [2026, 1, 1]);
    assert.deepEqual(localDay(until), [2027, 1, 1]);
});

test("a year range on the 1st of January looks back across the year", () => {
    const { since, until } = resolveRange("year", local(2026, 1, 1));
    assert.deepEqual(localDay(since), [2025, 2, 1]);
    assert.deepEqual(localDay(until), [2026, 2, 1]);
});

test("today on the 31st rolls into the next month", () => {
    const { until } = resolveRange("today", local(2026, 1, 31));
    assert.deepEqual(localDay(until), [2026, 2, 1]);
});

test("a leap day is an ordinary day", () => {
    const { since, until } = resolveRange("today", local(2028, 2, 29));
    assert.deepEqual(localDay(since), [2028, 2, 29]);
    assert.deepEqual(localDay(until), [2028, 3, 1]);
});

test("a week across a DST change is still seven local midnights", () => {
    // US DST ends 2026-11-01, so this week contains the extra hour
    const { since, until } = resolveRange("week", local(2026, 11, 4));
    assert.deepEqual(localDay(since), [2026, 10, 29]);
    assert.deepEqual(localDay(until), [2026, 11, 5]);
    // every bound is local midnight, whatever the offset did in between
    assert.equal(new Date(since!).getHours(), 0);
    assert.equal(new Date(until!).getHours(), 0);
});

test("a week across the spring DST change is also seven local midnights", () => {
    // US DST starts 2026-03-08
    const { since, until } = resolveRange("week", local(2026, 3, 11));
    assert.deepEqual(localDay(since), [2026, 3, 5]);
    assert.deepEqual(localDay(until), [2026, 3, 12]);
    assert.equal(new Date(since!).getHours(), 0);
    assert.equal(new Date(until!).getHours(), 0);
});
