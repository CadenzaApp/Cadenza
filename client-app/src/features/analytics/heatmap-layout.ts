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
    startOfWeek,
    type HeatmapShape,
} from "./range.ts";

/** One square: its bucket key and what a tap reads out. */
export type LayoutCell = { key: string; label: string };

export type HeatmapGrid = {
    /** Null is a spacer, a slot outside the period, drawn blank. */
    rows: (LayoutCell | null)[][];
    /** One per row, null for none. */
    rowLabels: (string | null)[];
    /** One per column, null for none. */
    colLabels: (string | null)[];
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

/** Hours in one block of a week row. */
const BLOCK_HOURS = 2;

/** 12 AM, 6 AM, Noon and 6 PM over the blocks that start on them. */
const BLOCK_AXIS: (string | null)[] = Array.from(
    { length: 24 / BLOCK_HOURS },
    (_, block) => {
        const hour = block * BLOCK_HOURS;
        if (hour % 6 !== 0) return null;
        return hour === 12 ? "Noon" : hourName(hour);
    },
);

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
        case "week-two-hours":
            return weekBlocks(shape.start);
        case "month-days":
            return monthDays(shape.start);
        case "year-days":
            return yearDays(shape.start);
        case "all-months":
            return allMonths(earliestYear ?? now.getFullYear(), now);
    }
}

/** Two rows, AM and PM, of twelve hours. */
function dayHours(day: Date): HeatmapGrid {
    const rows = [0, 12].map((offset) =>
        Array.from({ length: 12 }, (_, i) => {
            const hour = offset + i;
            return { key: hourKey(day, hour), label: hourName(hour) };
        }),
    );
    return {
        rows,
        rowLabels: ["AM", "PM"],
        colLabels: Array.from({ length: 12 }, (_, i) =>
            i % 3 === 0 ? String(i === 0 ? 12 : i) : null,
        ),
    };
}

/**
 * Monday to Sunday down, two hour blocks across. A block is keyed by its first
 * hour, which is how the backend's `two_hour` bucket prints it.
 */
function weekBlocks(monday: Date): HeatmapGrid {
    const rows = WEEKDAYS_SHORT.map((weekday, i) => {
        const day = addDays(monday, i);
        return Array.from({ length: 24 / BLOCK_HOURS }, (_, block) => {
            const hour = block * BLOCK_HOURS;
            const end = (hour + BLOCK_HOURS) % 24;
            return {
                key: hourKey(day, hour),
                label: `${weekday} ${monthDay(day)}, ${hourName(hour)} - ${hourName(end)}`,
            };
        });
    });
    return { rows, rowLabels: WEEKDAYS_SHORT, colLabels: BLOCK_AXIS };
}

/** A calendar: Monday to Sunday across, one row per week. */
function monthDays(first: Date): HeatmapGrid {
    const rows: (LayoutCell | null)[][] = [];
    let row: (LayoutCell | null)[] = Array(mondayIndex(first)).fill(null);

    for (
        let day = first;
        day.getMonth() === first.getMonth();
        day = addDays(day, 1)
    ) {
        row.push({ key: dayKey(day), label: monthDay(day) });
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

/**
 * A contribution grid: weekdays down, weeks across, from the week holding
 * January 1st to the one holding December 31st. Days outside the year are
 * spacers. A column is labelled with a month when its 1st falls in it.
 */
function yearDays(janFirst: Date): HeatmapGrid {
    const year = janFirst.getFullYear();
    const firstMonday = startOfWeek(janFirst);
    const lastDay = new Date(year, 11, 31);
    const weeks =
        Math.round(
            (startOfWeek(lastDay).getTime() - firstMonday.getTime()) /
                (7 * 24 * 60 * 60 * 1000),
        ) + 1;

    const rows: (LayoutCell | null)[][] = WEEKDAYS_SHORT.map(() => []);
    const colLabels: (string | null)[] = [];

    for (let week = 0; week < weeks; week++) {
        let monthStart: string | null = null;
        for (let weekday = 0; weekday < 7; weekday++) {
            const day = addDays(firstMonday, week * 7 + weekday);
            if (day.getFullYear() !== year) {
                rows[weekday].push(null);
                continue;
            }
            if (day.getDate() === 1) monthStart = MONTHS_SHORT[day.getMonth()];
            rows[weekday].push({ key: dayKey(day), label: monthDay(day) });
        }
        colLabels.push(monthStart);
    }

    return {
        rows,
        rowLabels: WEEKDAYS_SHORT.map((weekday, i) =>
            i % 2 === 0 ? weekday : null,
        ),
        colLabels,
    };
}

/** One row per year, oldest first, January to December across. */
function allMonths(earliestYear: number, now: Date): HeatmapGrid {
    const lastYear = now.getFullYear();
    const firstYear = Math.min(earliestYear, lastYear);
    const rows: LayoutCell[][] = [];
    const rowLabels: string[] = [];

    for (let year = firstYear; year <= lastYear; year++) {
        rows.push(
            MONTHS_SHORT.map((month, i) => ({
                key: dayKey(new Date(year, i, 1)),
                label: `${month} ${year}`,
            })),
        );
        rowLabels.push(String(year));
    }

    return {
        rows,
        rowLabels,
        colLabels: MONTHS_SHORT.map((month) => month.slice(0, 1)),
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
