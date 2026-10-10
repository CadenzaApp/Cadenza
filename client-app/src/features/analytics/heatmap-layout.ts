/**
 * Turns a period's heatmap shape into a grid of cells, each keyed the way the
 * backend prints a bucket start, so the sparse cells from
 * `/analytics/heatmap` drop straight into place.
 *
 * Keys: an hour is `YYYY-MM-DDTHH:00`, a day `YYYY-MM-DD`, a month its 1st as a
 * day. Built from local dates by hand, never through `toISOString`, which would
 * shift them into UTC.
 *
 * Pure, so `heatmap-layout.test.ts` runs it under `node --test`.
 */

import {
    MONTHS_SHORT,
    WEEKDAYS_SHORT,
    addDays,
    mondayIndex,
    type HeatmapShape,
} from "./range.ts";

/**
 * One square: its bucket key, what a tap reads out, what is printed inside it
 * if anything, and the local midnight of the day it falls in (a month's 1st for
 * a month), which is what it opens into.
 */
export type LayoutCell = {
    key: string;
    label: string;
    text?: string;
    date: Date;
};

export type HeatmapGrid = {
    /** Null is a spacer, a slot outside the period, drawn blank. */
    rows: (LayoutCell | null)[][];
    /** One per row, null for none. */
    rowLabels: (string | null)[];
    /** One per column, under the grid, null for none. Empty for no row. */
    colLabels: (string | null)[];
    /**
     * Keep squares square rather than stretching them to fill the box. Set
     * where rows can be few and wide, so they would stretch into stripes.
     */
    square?: boolean;
};

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

/** `YYYY-MM-DD` of a local date. */
export function dayKey(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DDTHH:00` of a local date and hour. */
export function hourKey(date: Date, hour: number): string {
    return `${dayKey(date)}T${pad(hour)}:00`;
}

/** `9 PM`. */
function hourName(hour: number): string {
    if (hour === 0) return "12 AM";
    if (hour === 12) return "12 PM";
    return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function monthDay(date: Date): string {
    return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** `1st`, `2nd`, `3rd`, `11th`, `22nd`. */
export function ordinal(day: number): string {
    const teen = day % 100 >= 11 && day % 100 <= 13;
    const suffix = teen ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
    return `${day}${suffix}`;
}

/** `items` cut into rows of `width`. */
function chunk<T>(items: T[], width: number): T[][] {
    return Array.from({ length: Math.ceil(items.length / width) }, (_, i) =>
        items.slice(i * width, (i + 1) * width),
    );
}

/**
 * The grid for `shape`. `earliestYear` is only read by `all-months`, which has
 * no bounds of its own and runs from the user's first year to `now`'s.
 */
export function layoutHeatmap(
    shape: HeatmapShape,
    now: Date,
    earliestYear?: number,
): HeatmapGrid {
    switch (shape.kind) {
        case "day-hours":
            return dayHours(shape.start);
        case "week-days":
            return weekDays(shape.start);
        case "month-days":
            return monthDays(shape.start);
        case "year-months":
            return yearMonths(shape.start);
        case "all-months":
            return allMonths(earliestYear ?? now.getFullYear(), now);
    }
}

/** Two rows, AM and PM, of twelve hours. Squares, like all time. */
function dayHours(day: Date): HeatmapGrid {
    const rows = [0, 12].map((offset) =>
        Array.from({ length: 12 }, (_, i) => {
            const hour = offset + i;
            return {
                key: hourKey(day, hour),
                label: hourName(hour),
                date: day,
            };
        }),
    );
    return {
        rows,
        rowLabels: ["AM", "PM"],
        colLabels: Array.from({ length: 12 }, (_, i) =>
            i % 3 === 0 ? String(i === 0 ? 12 : i) : null,
        ),
        square: true,
    };
}

/** Monday to Sunday, one square a day, each named with its date. */
function weekDays(monday: Date): HeatmapGrid {
    const row = WEEKDAYS_SHORT.map((weekday, i) => {
        const day = addDays(monday, i);
        return {
            key: dayKey(day),
            label: `${weekday} ${monthDay(day)}`,
            text: `${weekday}\n${ordinal(day.getDate())}`,
            date: day,
        };
    });
    return { rows: [row], rowLabels: [null], colLabels: [], square: true };
}

/** A calendar: Monday to Sunday across, one row per week, each day numbered. */
function monthDays(first: Date): HeatmapGrid {
    const rows: (LayoutCell | null)[][] = [];
    let row: (LayoutCell | null)[] = Array(mondayIndex(first)).fill(null);

    for (
        let day = first;
        day.getMonth() === first.getMonth();
        day = addDays(day, 1)
    ) {
        row.push({
            key: dayKey(day),
            label: monthDay(day),
            text: ordinal(day.getDate()),
            date: day,
        });
        if (row.length === 7) {
            rows.push(row);
            row = [];
        }
    }
    if (row.length > 0) {
        rows.push([...row, ...Array(7 - row.length).fill(null)]);
    }

    return {
        rows,
        rowLabels: rows.map(() => null),
        colLabels: WEEKDAYS_SHORT.map((weekday) => weekday.slice(0, 1)),
    };
}

/** The year's months, four rows of three, each named in its square. */
function yearMonths(janFirst: Date): HeatmapGrid {
    const months = monthRow(janFirst.getFullYear()).map((cell, i) => ({
        ...cell,
        text: MONTHS_SHORT[i],
    }));
    const rows = chunk(months, 3);
    return { rows, rowLabels: rows.map(() => null), colLabels: [] };
}

/** January to December of `year`, each keyed by its 1st. */
function monthRow(year: number): LayoutCell[] {
    return MONTHS_SHORT.map((month, i) => {
        const first = new Date(year, i, 1);
        return { key: dayKey(first), label: `${month} ${year}`, date: first };
    });
}

/**
 * One row per year, oldest first, January to December across. Squares, never
 * stretched, so a short history does not turn into tall stripes.
 */
function allMonths(earliestYear: number, now: Date): HeatmapGrid {
    const lastYear = now.getFullYear();
    const firstYear = Math.min(earliestYear, lastYear);
    const rows: LayoutCell[][] = [];
    const rowLabels: string[] = [];

    for (let year = firstYear; year <= lastYear; year++) {
        rows.push(monthRow(year));
        rowLabels.push(String(year));
    }

    return {
        rows,
        rowLabels,
        colLabels: MONTHS_SHORT.map((month) => month.slice(0, 1)),
        square: true,
    };
}

/** How many steps of brightness a cell can have, past empty. */
export const HEAT_LEVELS = 4;

/**
 * A cell's brightness step, 0 for empty through `HEAT_LEVELS`. On a square root
 * scale, so one huge night does not flatten every other cell into the bottom
 * step.
 */
export function heatLevel(plays: number, maxPlays: number): number {
    if (plays <= 0 || maxPlays <= 0) return 0;
    const ratio = Math.min(1, plays / maxPlays);
    return Math.max(1, Math.ceil(Math.sqrt(ratio) * HEAT_LEVELS));
}
