import assert from "node:assert/strict";
import test from "node:test";

import {
    HEAT_LEVELS,
    dayKey,
    heatLevel,
    hourKey,
    layoutHeatmap,
    pageOf,
    picksOf,
    type HeatmapGrid,
} from "./heatmap-layout.ts";
import { resolvePeriod } from "./range.ts";

// Saturday 2026-10-03
const NOW = new Date(2026, 9, 3, 12);

function pagesOf(grain: "day" | "week" | "month" | "year" | "all") {
    return layoutHeatmap(resolvePeriod(grain, 0, NOW).heatmap, NOW);
}

function keys(grid: HeatmapGrid) {
    return grid.lines.flat().flatMap((cell) => (cell ? [cell.key] : []));
}

test("keys are local and match the backend's printing", () => {
    const date = new Date(2026, 0, 5);
    assert.equal(dayKey(date), "2026-01-05");
    assert.equal(hourKey(date, 9), "2026-01-05T09:00");
});

test("a day is four rows of six numbered hours, two AM and two PM", () => {
    const [grid] = pagesOf("day");
    assert.deepEqual(grid.rowLabels, ["AM", "", "PM", ""]);
    assert.equal(grid.lines.length, 4);
    assert.ok(grid.lines.every((row) => row.length === 6));
    assert.equal(grid.lines[0][0]?.key, "2026-10-03T00:00");
    assert.equal(grid.lines[0][0]?.caption, "12");
    assert.equal(grid.lines[1][0]?.caption, "6");
    assert.equal(grid.lines[2][2]?.pick?.short, "2 PM");
    assert.equal(grid.lines[3][5]?.key, "2026-10-03T23:00");
    assert.equal(grid.lines[3][5]?.caption, "11");
});

test("a week is seven columns of two hour blocks, each picking its day", () => {
    const [grid] = pagesOf("week");
    assert.ok(grid.columns);
    assert.equal(grid.lines.length, 7);
    assert.ok(grid.lines.every((column) => column.length === 12));
    assert.equal(grid.lines[0][0]?.key, "2026-09-28T00:00");
    assert.equal(grid.lines[6][11]?.key, "2026-10-04T22:00");
    assert.equal(grid.header?.[0], "Mon\n28");
    assert.equal(picksOf([grid]).length, 7);
    assert.equal(grid.lines[4][3]?.pick?.label, "Fri, Oct 2, 2026");
});

test("a month is a Monday-first calendar filled out with faint days", () => {
    const [grid] = pagesOf("month");
    assert.ok(grid.lines.every((row) => row.length === 7));
    // Oct 1 2026 is a Thursday, so Sep 28 to 30 lead it
    assert.deepEqual(
        grid.lines[0].map((cell) => cell?.text),
        ["28", "29", "30", "1", "2", "3", "4"],
    );
    assert.equal(grid.lines[0][0]?.pick, null);
    const picks = picksOf([grid]);
    assert.equal(picks.length, 31);
    assert.equal(dayKey(picks[30].start), "2026-10-31");
    // and Nov 1, a Sunday, ends it
    assert.equal(grid.lines.at(-1)?.at(-1)?.text, "1");
});

test("a year is four rows of three named months", () => {
    const [grid] = pagesOf("year");
    assert.equal(grid.lines.length, 4);
    assert.ok(grid.lines.every((row) => row.length === 3));
    assert.equal(grid.lines[3][2]?.text, "Dec");
    const months = keys(grid);
    assert.equal(months[0], "2026-01-01");
    assert.equal(months[11], "2026-12-01");
    assert.equal(grid.lines[3][0]?.pick?.label, "October 2026");
});

test("all time is a titled year page per year, oldest first", () => {
    const pages = layoutHeatmap({ kind: "all-months" }, NOW, 2024);
    assert.deepEqual(
        pages.map((page) => page.title),
        ["2024", "2025", "2026"],
    );
    assert.equal(pages[0].lines[0][0]?.key, "2024-01-01");
    assert.equal(pages[2].lines[3][0]?.key, "2026-10-01");
});

test("all time with no history is just this year", () => {
    assert.equal(pagesOf("all").length, 1);
});

test("all time opens on the page holding the pick, else the last", () => {
    const all = layoutHeatmap({ kind: "all-months" }, NOW, 2025);
    const march = all[0].lines[0][2]?.pick ?? null;
    assert.equal(march?.label, "March 2025");
    assert.equal(pageOf(all, march), 0);
    assert.equal(pageOf(all, null), 1);
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
        for (const cell of pagesOf(grain)[0].lines.flat()) {
            if (cell?.pick) {
                assert.equal(dayKey(cell.pick.start), cell.key.slice(0, 10));
            }
        }
    }
});
