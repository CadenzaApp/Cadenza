import assert from "node:assert/strict";
import test from "node:test";

import {
    HEAT_LEVELS,
    dayKey,
    heatLevel,
    hourKey,
    layoutHeatmap,
} from "./heatmap-layout.ts";
import { resolvePeriod } from "./range.ts";

// Saturday 2026-10-03
const NOW = new Date(2026, 9, 3, 12);

function shapeOf(grain: "day" | "week" | "month" | "year" | "all") {
    return resolvePeriod(grain, 0, NOW).heatmap;
}

function keys(grid: ReturnType<typeof layoutHeatmap>) {
    return grid.rows.flat().flatMap((cell) => (cell ? [cell.key] : []));
}

test("keys are local and match the backend's printing", () => {
    const date = new Date(2026, 0, 5);
    assert.equal(dayKey(date), "2026-01-05");
    assert.equal(hourKey(date, 9), "2026-01-05T09:00");
});

test("a day is two rows of twelve hours", () => {
    const grid = layoutHeatmap(shapeOf("day"), NOW);
    assert.equal(grid.rows.length, 2);
    assert.ok(grid.rows.every((row) => row.length === 12));
    assert.equal(grid.rows[0][0]?.key, "2026-10-03T00:00");
    assert.equal(grid.rows[1][11]?.key, "2026-10-03T23:00");
});

test("a week is seven Monday-first rows of twelve two hour blocks", () => {
    const grid = layoutHeatmap(shapeOf("week"), NOW);
    assert.equal(grid.rows.length, 7);
    assert.ok(grid.rows.every((row) => row.length === 12));
    assert.equal(grid.rowLabels[0], "Mon");
    assert.equal(grid.rows[0][0]?.key, "2026-09-28T00:00");
    assert.equal(grid.rows[0][1]?.key, "2026-09-28T02:00");
    assert.equal(grid.rows[6][11]?.key, "2026-10-04T22:00");
    assert.equal(grid.rows[6][11]?.label, "Sun Oct 4, 10 PM - 12 AM");
    assert.equal(new Set(keys(grid)).size, 84);
    assert.deepEqual(grid.colLabels.filter(Boolean), [
        "12 AM",
        "6 AM",
        "Noon",
        "6 PM",
    ]);
});

test("a month is a Monday-first calendar with every day once", () => {
    const grid = layoutHeatmap(shapeOf("month"), NOW);
    const days = keys(grid);
    assert.equal(days.length, 31);
    assert.equal(days[0], "2026-10-01");
    assert.equal(days[30], "2026-10-31");
    // Oct 1 2026 is a Thursday, so three spacers lead the first row
    assert.deepEqual(grid.rows[0].slice(0, 3), [null, null, null]);
    assert.ok(grid.rows.every((row) => row.length === 7));
});

test("a year is one row of its twelve months", () => {
    const grid = layoutHeatmap(shapeOf("year"), NOW);
    assert.equal(grid.rows.length, 1);
    const months = keys(grid);
    assert.equal(months.length, 12);
    assert.equal(months[0], "2026-01-01");
    assert.equal(months[11], "2026-12-01");
    assert.equal(grid.colLabels.length, 12);
});

test("all time is a row per year from the earliest", () => {
    const grid = layoutHeatmap(shapeOf("all"), NOW, 2024);
    assert.deepEqual(grid.rowLabels, ["2024", "2025", "2026"]);
    assert.equal(grid.rows[0][0]?.key, "2024-01-01");
    assert.equal(grid.rows[2][9]?.key, "2026-10-01");
});

test("all time with no history is just this year", () => {
    const grid = layoutHeatmap(shapeOf("all"), NOW);
    assert.deepEqual(grid.rowLabels, ["2026"]);
});

test("heat levels run from empty to full on a square root scale", () => {
    assert.equal(heatLevel(0, 10), 0);
    assert.equal(heatLevel(5, 0), 0);
    assert.equal(heatLevel(10, 10), HEAT_LEVELS);
    assert.equal(heatLevel(1, 100), 1, "a single play is still visible");
    // sqrt keeps a quarter of the peak at half brightness, not a quarter
    assert.equal(heatLevel(25, 100), 2);
});
