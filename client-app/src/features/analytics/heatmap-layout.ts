/**
 * Turns a period's heatmap shape into a grid of keyed cells, each keyed the way
 * the backend prints a bucket start, so the sparse cells from
 * `/analytics/heatmap` drop straight into place.
 *
 * Keys: an hour or two hour block is `YYYY-MM-DDTHH:00`, a day `YYYY-MM-DD`, a
 * month its 1st as a day. Built from local dates by hand, never through
 * `toISOString`, which would shift them into UTC.
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

const MONTHS_LONG = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/**
 * What a tap selects: a span of local time, `start` inclusive and `end`
 * exclusive. `label` heads the detail under the grid, `short` follows the
 * level in the breadcrumb.
 */
export type HeatmapPick = {
    start: Date;
    end: Date;
    label: string;
    short: string;
};

/**
 * One square: the bucket it draws, what a tap on it picks, and what is printed
 * in it or under it. A null pick is a day outside the period, drawn faint.
 */
export type LayoutCell = {
    key: string;
    pick: HeatmapPick | null;
    text?: string;
    caption?: string;
};

/** A level's squares. */
export type HeatmapGrid = {
    /** Rows of squares, or columns when `columns` is set. Null is a spacer. */
    lines: (LayoutCell | null)[][];
    /**
     * Lay `lines` out as columns, top to bottom. Every square in a column
     * picks the same span, so a tap anywhere picks the whole column.
     */
    columns?: boolean;
    /** One label per column, over it. May run two lines. */
    header?: string[];
    /** One label per row, left of it. Rows only. */
    rowLabels?: string[];
    /**
     * Keep squares square rather than stretching them to fill the box. Set
     * where rows are few and wide, so they would stretch into stripes.
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

/** `Fri, Oct 9, 2026`. */
function fullDay(date: Date): string {
    return `${WEEKDAYS_SHORT[mondayIndex(date)]}, ${monthDay(date)}, ${date.getFullYear()}`;
}

/** `items` cut into rows of `width`. */
function chunk<T>(items: T[], width: number): T[][] {
    return Array.from({ length: Math.ceil(items.length / width) }, (_, i) =>
        items.slice(i * width, (i + 1) * width),
    );
}

function dayPick(day: Date): HeatmapPick {
    return {
        start: day,
        end: addDays(day, 1),
        label: fullDay(day),
        short: monthDay(day),
    };
}

function monthPick(first: Date): HeatmapPick {
    return {
        start: first,
        end: new Date(first.getFullYear(), first.getMonth() + 1, 1),
        label: `${MONTHS_LONG[first.getMonth()]} ${first.getFullYear()}`,
        short: MONTHS_LONG[first.getMonth()],
    };
}

/** The grid for `shape`. */
export function layoutHeatmap(shape: HeatmapShape): HeatmapGrid {
    switch (shape.kind) {
        case "day-hours":
            return dayHours(shape.start);
        case "week-days":
            return weekDays(shape.start);
        case "month-days":
            return monthDays(shape.start);
        case "year-months":
            return yearMonths(shape.start.getFullYear());
    }
}

/**
 * Four rows of six hours, two AM and two PM, each numbered under its square.
 * Each half is named on its first row.
 */
function dayHours(day: Date): HeatmapGrid {
    const lines = [0, 6, 12, 18].map((offset) =>
        Array.from({ length: 6 }, (_, i) => {
            const hour = offset + i;
            return {
                key: hourKey(day, hour),
                pick: {
                    start: atHour(day, hour),
                    end: atHour(day, hour + 1),
                    label: `${fullDay(day)}, ${hourName(hour)}`,
                    short: hourName(hour),
                },
                caption: hourName(hour),
            };
        }),
    );
    return { lines, rowLabels: ["AM", "", "PM", ""], square: true };
}

/** Local `hour` o'clock on `day`. Past 23 rolls into the next day. */
function atHour(day: Date, hour: number): Date {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
}

/**
 * Monday to Sunday, one day bucket per column. Each column picks its day and is headed with its name and date.
 */
function weekDays(monday: Date): HeatmapGrid {
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    return {
        lines: days.map((day) => {
            const pick = dayPick(day);
            return [{ key: dayKey(day), pick }];
        }),
        columns: true,
        header: days.map(
            (day) => `${WEEKDAYS_SHORT[mondayIndex(day)]}\n${day.getDate()}`,
        ),
    };
}

/**
 * A calendar, Monday to Sunday across, one row per week, each day numbered.
 * The first and last weeks are filled out with the months either side, drawn
 * faint and never picked.
 */
function monthDays(first: Date): HeatmapGrid {
    const start = addDays(first, -mondayIndex(first));
    // Reserve six weeks even when this month would fit in four or five.
    const end = addDays(start, 42);

    const cells: LayoutCell[] = [];
    for (let day = start; day < end; day = addDays(day, 1)) {
        const inside =
            day.getFullYear() === first.getFullYear() &&
            day.getMonth() === first.getMonth();
        cells.push({
            key: dayKey(day),
            pick: inside ? dayPick(day) : null,
            text: String(day.getDate()),
        });
    }
    return { lines: chunk(cells, 7), header: [...WEEKDAYS_SHORT] };
}

/** The year's months, four rows of three, each named in its square. */
function yearMonths(year: number): HeatmapGrid {
    const months = MONTHS_SHORT.map((month, i) => {
        const first = new Date(year, i, 1);
        return { key: dayKey(first), pick: monthPick(first), text: month };
    });
    return { lines: chunk(months, 3) };
}

export function samePick(a: HeatmapPick, b: HeatmapPick): boolean {
    return (
        a.start.getTime() === b.start.getTime() &&
        a.end.getTime() === b.end.getTime()
    );
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
