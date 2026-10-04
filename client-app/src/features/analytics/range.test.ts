import assert from "node:assert/strict";
import test from "node:test";

import {
    PERIOD_GRAINS,
    canStepBack,
    canStepForward,
    grainLabel,
    resolvePeriod,
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

// Saturday 2026-10-03
const NOW = local(2026, 10, 3);

// ----- every grain -----

test("every grain has a label", () => {
    for (const grain of PERIOD_GRAINS) {
        assert.ok(grainLabel(grain).length > 0, grain);
    }
});

test("every grain but all is a bounded window", () => {
    for (const grain of PERIOD_GRAINS) {
        const { since, until } = resolvePeriod(grain, 0, NOW);
        if (grain === "all") {
            assert.equal(since, undefined);
            assert.equal(until, undefined);
        } else {
            assert.ok(since && until, grain);
            assert.ok(new Date(since) < new Date(until), `${grain} backwards`);
        }
    }
});

test("a play one minute ago is inside every current window", () => {
    const now = local(2026, 10, 3, 23, 59);
    for (const grain of PERIOD_GRAINS) {
        const { since, until } = resolvePeriod(grain, 0, now);
        if (!since || !until) continue;
        assert.ok(new Date(since) <= now, `${grain} starts after now`);
        assert.ok(new Date(until) > now, `${grain} ends before now`);
    }
});

test("each grain picks its chart and buckets", () => {
    assert.equal(resolvePeriod("day", 0, NOW).chart, "hours");
    assert.equal(resolvePeriod("day", 0, NOW).heatmapBucket, "hour");
    assert.equal(resolvePeriod("week", 0, NOW).trendBucket, "day");
    assert.equal(resolvePeriod("week", 0, NOW).heatmapBucket, "two_hour");
    assert.equal(resolvePeriod("month", 0, NOW).trendBucket, "day");
    assert.equal(resolvePeriod("month", 0, NOW).heatmapBucket, "day");
    assert.equal(resolvePeriod("year", 0, NOW).trendBucket, "month");
    assert.equal(resolvePeriod("year", 0, NOW).heatmapBucket, "day");
    assert.equal(resolvePeriod("all", 0, NOW).trendBucket, "auto");
    assert.equal(resolvePeriod("all", 0, NOW).heatmapBucket, "month");
});

// ----- the boundaries -----

test("a day runs from local midnight to the next", () => {
    const { since, until } = resolvePeriod("day", 0, local(2026, 10, 3, 14));
    assert.deepEqual(localDay(since), [2026, 10, 3]);
    assert.deepEqual(localDay(until), [2026, 10, 4]);
    assert.equal(new Date(since!).getHours(), 0);
});

test("a week runs Monday to Monday", () => {
    const { since, until } = resolvePeriod("week", 0, NOW);
    assert.deepEqual(localDay(since), [2026, 9, 28]);
    assert.deepEqual(localDay(until), [2026, 10, 5]);
    assert.equal(new Date(since!).getDay(), 1, "a Monday");
});

test("a Sunday belongs to the week before it", () => {
    const { since } = resolvePeriod("week", 0, local(2026, 10, 4));
    assert.deepEqual(localDay(since), [2026, 9, 28]);
});

test("a Monday starts its own week", () => {
    const { since } = resolvePeriod("week", 0, local(2026, 10, 5));
    assert.deepEqual(localDay(since), [2026, 10, 5]);
});

test("a month runs from the 1st to the next 1st", () => {
    const { since, until } = resolvePeriod("month", 0, NOW);
    assert.deepEqual(localDay(since), [2026, 10, 1]);
    assert.deepEqual(localDay(until), [2026, 11, 1]);
});

test("a year runs from January 1st", () => {
    const { since, until } = resolvePeriod("year", 0, NOW);
    assert.deepEqual(localDay(since), [2026, 1, 1]);
    assert.deepEqual(localDay(until), [2027, 1, 1]);
});

// ----- stepping -----

test("an offset steps back whole periods", () => {
    assert.deepEqual(
        localDay(resolvePeriod("day", -1, NOW).since),
        [2026, 10, 2],
    );
    assert.deepEqual(
        localDay(resolvePeriod("week", -1, NOW).since),
        [2026, 9, 21],
    );
    assert.deepEqual(
        localDay(resolvePeriod("month", -10, NOW).since),
        [2025, 12, 1],
    );
    assert.deepEqual(
        localDay(resolvePeriod("year", -2, NOW).since),
        [2024, 1, 1],
    );
});

test("a positive offset is clamped to now", () => {
    const period = resolvePeriod("week", 3, NOW);
    assert.equal(period.offset, 0);
    assert.deepEqual(localDay(period.since), [2026, 9, 28]);
});

test("only a past period can step forward", () => {
    assert.equal(canStepForward(resolvePeriod("week", 0, NOW)), false);
    assert.equal(canStepForward(resolvePeriod("week", -1, NOW)), true);
    assert.equal(canStepForward(resolvePeriod("all", 0, NOW)), false);
    assert.equal(canStepBack(resolvePeriod("all", 0, NOW)), false);
    assert.equal(canStepBack(resolvePeriod("day", 0, NOW)), true);
});

test("the current period says this, a past one says that", () => {
    assert.equal(resolvePeriod("week", 0, NOW).phrase, "this week");
    assert.equal(resolvePeriod("week", -1, NOW).phrase, "that week");
    assert.equal(resolvePeriod("day", 0, NOW).phrase, "today");
    assert.equal(resolvePeriod("all", 0, NOW).phrase, "all time");
});

// ----- labels -----

test("a week inside one month names the month once", () => {
    assert.equal(
        resolvePeriod("week", 0, local(2026, 10, 7)).dateLabel,
        "Oct 5 - 11, 2026",
    );
});

test("a week across two months names both", () => {
    assert.equal(
        resolvePeriod("week", 0, NOW).dateLabel,
        "Sep 28 - Oct 4, 2026",
    );
});

test("a week across two years names both years", () => {
    assert.equal(
        resolvePeriod("week", 0, local(2026, 12, 31)).dateLabel,
        "Dec 28, 2026 - Jan 3, 2027",
    );
});

test("a day in this year leaves the year off", () => {
    assert.equal(resolvePeriod("day", -1, NOW).dateLabel, "Friday, Oct 2");
    assert.equal(
        resolvePeriod("day", -365, NOW).dateLabel,
        "Friday, Oct 3, 2025",
    );
});

test("months and years read plainly", () => {
    assert.equal(resolvePeriod("month", 0, NOW).dateLabel, "October 2026");
    assert.equal(resolvePeriod("year", 0, NOW).dateLabel, "2026");
});

// ----- the edges that break naive date maths -----

test("a month step from the 31st lands on the right month", () => {
    const { since } = resolvePeriod("month", -1, local(2026, 3, 31));
    assert.deepEqual(localDay(since), [2026, 2, 1]);
});

test("a leap day is an ordinary day", () => {
    const { since, until } = resolvePeriod("day", 0, local(2028, 2, 29));
    assert.deepEqual(localDay(since), [2028, 2, 29]);
    assert.deepEqual(localDay(until), [2028, 3, 1]);
});

test("a week across a DST change is still local midnight to midnight", () => {
    // US DST ends 2026-11-01, a Sunday, so this week holds the extra hour
    const { since, until } = resolvePeriod("week", 0, local(2026, 10, 29));
    assert.deepEqual(localDay(since), [2026, 10, 26]);
    assert.deepEqual(localDay(until), [2026, 11, 2]);
    assert.equal(new Date(since!).getHours(), 0);
    assert.equal(new Date(until!).getHours(), 0);
});

test("the spring DST week is also local midnight to midnight", () => {
    // US DST starts 2026-03-08, a Sunday
    const { since, until } = resolvePeriod("week", 0, local(2026, 3, 5));
    assert.deepEqual(localDay(since), [2026, 3, 2]);
    assert.deepEqual(localDay(until), [2026, 3, 9]);
    assert.equal(new Date(since!).getHours(), 0);
    assert.equal(new Date(until!).getHours(), 0);
});
