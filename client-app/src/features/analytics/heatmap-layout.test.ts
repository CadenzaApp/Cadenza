import assert from "node:assert/strict";
import test from "node:test";

import {
    HEAT_LEVELS,
    dayKey,
    heatLevel,
    hourKey,
    layoutHeatmap,
    ordinal,
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
    assert.deepEqual(grid.rowLabels, ["AM", "PM"]);
    assert.ok(grid.rows.every((row) => row.length === 12));
    assert.equal(grid.rows[0][0]?.key, "2026-10-03T00:00");
    assert.equal(grid.rows[1][11]?.key, "2026-10-03T23:00");
});

test("a week is one row of seven Monday-first days", () => {
    const grid = layoutHeatmap(shapeOf("week"), NOW);
    assert.equal(grid.rows.length, 1);
    assert.deepEqual(keys(grid), [
        "2026-09-28",
        "2026-09-29",
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
        "2026-10-03",
        "2026-10-04",
    ]);
    assert.equal(grid.rows[0][0]?.text, "Mon\n28th");
    assert.equal(grid.rows[0][6]?.label, "Sun Oct 4");
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
    assert.equal(grid.rows[0][3]?.text, "1st");
});

test("a year is four rows of three named months", () => {
    const grid = layoutHeatmap(shapeOf("year"), NOW);
    assert.equal(grid.rows.length, 4);
    assert.ok(grid.rows.every((row) => row.length === 3));
    assert.equal(grid.rows[3][2]?.text, "Dec");
    const months = keys(grid);
    assert.equal(months.length, 12);
    assert.equal(months[0], "2026-01-01");
    assert.equal(months[11], "2026-12-01");
});

test("ordinals", () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal), [
        "1st",
        "2nd",
        "3rd",
        "4th",
        "11th",
        "12th",
        "13th",
        "21st",
        "22nd",
        "23rd",
        "31st",
    ]);
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

test("every cell's date is the local day its key names", () => {
    const shapes = [
        { kind: "day-hours", start: new Date(2026, 9, 3) },
        { kind: "week-days", start: new Date(2026, 8, 28) },
        { kind: "month-days", start: new Date(2026, 9, 1) },
        { kind: "year-months", start: new Date(2026, 0, 1) },
    ] as const;
    for (const shape of shapes) {
        for (const cell of layoutHeatmap(
            shape,
            new Date(2026, 9, 3),
        ).rows.flat()) {
            if (cell) assert.equal(dayKey(cell.date), cell.key.slice(0, 10));
        }
    }
});
