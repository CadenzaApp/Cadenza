import assert from "node:assert/strict";
import test from "node:test";

import {
    HEAT_LEVELS,
    dayKey,
    heatLevel,
    hourKey,
    layoutHeatmap,
    type HeatmapGrid,
    type HeatmapPick,
} from "./heatmap-layout.ts";
import { resolvePeriod, type PeriodGrain } from "./range.ts";

// Saturday 2026-10-03
const NOW = new Date(2026, 9, 3, 12);

function gridOf(grain: PeriodGrain) {
    return layoutHeatmap(resolvePeriod(grain, 0, NOW).heatmap);
}

function keys(grid: HeatmapGrid) {
    return grid.lines.flat().flatMap((cell) => (cell ? [cell.key] : []));
}

/** Every pick on `grid`, once each, in order. */
function picksOf(grid: HeatmapGrid): HeatmapPick[] {
    const picks = new Set<HeatmapPick>();
    for (const cell of grid.lines.flat()) if (cell?.pick) picks.add(cell.pick);
    return [...picks];
}

test("keys are local and match the backend's printing", () => {
    const date = new Date(2026, 0, 5);
    assert.equal(dayKey(date), "2026-01-05");
    assert.equal(hourKey(date, 9), "2026-01-05T09:00");
});

test("a day is four rows of six numbered hours, two AM and two PM", () => {
    const grid = gridOf("day");
    assert.deepEqual(grid.rowLabels, ["AM", "", "PM", ""]);
    assert.equal(grid.lines.length, 4);
    assert.ok(grid.lines.every((row) => row.length === 6));
    assert.equal(grid.lines[0][0]?.key, "2026-10-03T00:00");
    assert.equal(grid.lines[0][0]?.caption, "12 AM");
    assert.equal(grid.lines[1][0]?.caption, "6 AM");
    assert.equal(grid.lines[2][2]?.pick?.short, "2 PM");
    assert.equal(grid.lines[3][5]?.key, "2026-10-03T23:00");
    assert.equal(grid.lines[3][5]?.caption, "11 PM");
});

test("a week is seven additive day columns, each picking its day", () => {
    const grid = gridOf("week");
    assert.ok(grid.columns);
    assert.equal(grid.lines.length, 7);
    assert.ok(grid.lines.every((column) => column.length === 1));
    assert.equal(grid.lines[0][0]?.key, "2026-09-28");
    assert.equal(grid.lines[6][0]?.key, "2026-10-04");
    assert.equal(grid.header?.[0], "Mon\n28");
    assert.equal(picksOf(grid).length, 7);
    assert.equal(grid.lines[4][0]?.pick?.label, "Fri, Oct 2, 2026");
});

test("a month is a Monday-first calendar filled out with faint days", () => {
    const grid = gridOf("month");
    assert.ok(grid.lines.every((row) => row.length === 7));
    // Oct 1 2026 is a Thursday, so Sep 28 to 30 lead it
    assert.deepEqual(
        grid.lines[0].map((cell) => cell?.text),
        ["28", "29", "30", "1", "2", "3", "4"],
    );
    assert.equal(grid.lines[0][0]?.pick, null);
    const picks = picksOf(grid);
    assert.equal(picks.length, 31);
    assert.equal(dayKey(picks[30].start), "2026-10-31");
    // Six reserved weeks end on Nov 8; out-of-month cells never pick.
    assert.equal(grid.lines.length, 6);
    assert.equal(grid.lines.at(-1)?.at(-1)?.text, "8");
    assert.equal(grid.lines.at(-1)?.at(-1)?.pick, null);
});

test("a year is four rows of three named months", () => {
    const grid = gridOf("year");
    assert.equal(grid.lines.length, 4);
    assert.ok(grid.lines.every((row) => row.length === 3));
    assert.equal(grid.lines[3][2]?.text, "Dec");
    const months = keys(grid);
    assert.equal(months[0], "2026-01-01");
    assert.equal(months[11], "2026-12-01");
    assert.equal(grid.lines[3][0]?.pick?.label, "October 2026");
});

test("heat levels run from empty to full on a square root scale", () => {
    assert.equal(heatLevel(0, 10), 0);
    assert.equal(heatLevel(5, 0), 0);
    assert.equal(heatLevel(10, 10), HEAT_LEVELS);
    assert.equal(heatLevel(1, 100), 1, "a single play is still visible");
    // sqrt keeps a quarter of the peak at half brightness, not a quarter
    assert.equal(heatLevel(25, 100), 2);
});

test("every cell's pick starts on the local day its key names", () => {
    for (const grain of ["day", "week", "month", "year"] as const) {
        for (const cell of gridOf(grain).lines.flat()) {
            if (cell?.pick) {
                assert.equal(dayKey(cell.pick.start), cell.key.slice(0, 10));
            }
        }
    }
});
