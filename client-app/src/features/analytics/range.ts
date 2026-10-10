/**
 * The calendar period the Analytics tab is showing, and everything it resolves
 * to: the window, the chart and heatmap buckets, and the words on screen.
 *
 * A period is a grain (day, week, month, or year) plus how many of them
 * back from the current one. Holding an offset rather than a date means offset
 * 0 always follows the clock, so "this week" stays this week when the app comes
 * back the next Monday.
 *
 * Weeks start on Monday. Every boundary is local midnight, built with the
 * three-argument `Date` constructor, which resolves the device's own offset and
 * so is DST safe in a way adding 24 hours is not.
 *
 * Pure and import-free, so `range.test.ts` runs it under `node --test`. `now`
 * is injected rather than read from the clock so a test can pin it.
 */

export type PeriodGrain = "day" | "week" | "month" | "year";

/** Every grain, in the order the picker shows them. */
export const PERIOD_GRAINS: PeriodGrain[] = ["day", "week", "month", "year"];

/** What the backend's trend `bucket` param accepts. `auto` lets it pick. */
export type TrendBucket = "day" | "week" | "month" | "year" | "auto";

/** The buckets a heatmap is cut in. */
export type HeatmapBucket = "hour" | "two_hour" | "day" | "month";

/**
 * How a period's heatmap is laid out. Each carries the local midnight it
 * starts on, which is all the layout needs to place every cell.
 *
 * - `day-hours`: one day, two rows of twelve hours.
 * - `week-blocks`: Monday to Sunday, a column a day of twelve two hour blocks.
 * - `month-days`: a calendar, one cell per day.
 * - `year-months`: the year's twelve months, four rows of three.
 */
export type HeatmapShape =
    | { kind: "day-hours"; start: Date }
    | { kind: "week-blocks"; start: Date }
    | { kind: "month-days"; start: Date }
    | { kind: "year-months"; start: Date };

export type ResolvedPeriod = {
    grain: PeriodGrain;
    /** Periods back from the current one. 0 is now, never positive. */
    offset: number;
    /** ISO instant. */
    since: string;
    /** ISO instant, exclusive. */
    until: string;
    trendBucket: TrendBucket;
    /**
     * Which chart the period wants. `hours` is the 24-hour histogram, which
     * says far more about a single day than a one-bar trend would.
     */
    chart: "hours" | "trend";
    heatmapBucket: HeatmapBucket;
    heatmap: HeatmapShape;
    /** The dates it covers, "Sep 28 - Oct 4, 2026". */
    dateLabel: string;
    /** How a sentence refers to it: "this week", "that month", "today". */
    phrase: string;
    /** True when now falls inside it, so there is nothing later to step to. */
    isCurrent: boolean;
};

/** Short name for the picker. */
export function grainLabel(grain: PeriodGrain): string {
    switch (grain) {
        case "day":
            return "Day";
        case "week":
            return "Week";
        case "month":
            return "Month";
        case "year":
            return "Year";
    }
}

/** Local midnight on the day `date` falls in. */
export function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local midnight `days` after `date`'s day. Negative goes back. */
export function addDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Monday 0 through Sunday 6. `getDay` starts the week on Sunday. */
export function mondayIndex(date: Date): number {
    return (date.getDay() + 6) % 7;
}

/** Local midnight on the Monday of `date`'s week. */
export function startOfWeek(date: Date): Date {
    return addDays(date, -mondayIndex(date));
}

/** The first moment of the period `offset` grains away from the one holding `now`. */
function periodStart(grain: PeriodGrain, offset: number, now: Date): Date {
    switch (grain) {
        case "day":
            return addDays(now, offset);
        case "week":
            return addDays(startOfWeek(now), offset * 7);
        case "month":
            return new Date(now.getFullYear(), now.getMonth() + offset, 1);
        case "year":
            return new Date(now.getFullYear() + offset, 0, 1);
    }
}

/** The first moment after the period starting at `start`. */
function periodEnd(grain: PeriodGrain, start: Date): Date {
    switch (grain) {
        case "day":
            return addDays(start, 1);
        case "week":
            return addDays(start, 7);
        case "month":
            return new Date(start.getFullYear(), start.getMonth() + 1, 1);
        case "year":
            return new Date(start.getFullYear() + 1, 0, 1);
    }
}

export const MONTHS_SHORT = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

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

/** Monday first, matching `mondayIndex`. */
export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const WEEKDAYS_LONG = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];

/** "Oct 2". */
function monthDay(date: Date): string {
    return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/**
 * The dates a period covers, as a person writes them. The year is left off a
 * day in the current year, and said once for a week that stays inside one.
 */
function dateLabelFor(
    grain: PeriodGrain,
    start: Date,
    end: Date,
    now: Date,
): string {
    switch (grain) {
        case "day": {
            const day = `${WEEKDAYS_LONG[mondayIndex(start)]}, ${monthDay(start)}`;
            return start.getFullYear() === now.getFullYear()
                ? day
                : `${day}, ${start.getFullYear()}`;
        }
        case "week": {
            const last = addDays(end, -1);
            if (start.getFullYear() !== last.getFullYear()) {
                return `${monthDay(start)}, ${start.getFullYear()} - ${monthDay(last)}, ${last.getFullYear()}`;
            }
            const tail =
                start.getMonth() === last.getMonth()
                    ? String(last.getDate())
                    : monthDay(last);
            return `${monthDay(start)} - ${tail}, ${last.getFullYear()}`;
        }
        case "month":
            return `${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`;
        case "year":
            return String(start.getFullYear());
    }
}

function heatmapFor(grain: PeriodGrain, start: Date): HeatmapShape {
    switch (grain) {
        case "day":
            return { kind: "day-hours", start };
        case "week":
            return { kind: "week-blocks", start };
        case "month":
            return { kind: "month-days", start };
        case "year":
            return { kind: "year-months", start };
    }
}

/** The bucket the backend cuts a bounded period's heatmap in. Matches the
 * cells `heatmapFor`'s shape lays out. */
function heatmapBucketFor(grain: PeriodGrain): HeatmapBucket {
    switch (grain) {
        case "day":
            return "hour";
        case "week":
            return "two_hour";
        case "month":
            return "day";
        case "year":
            return "month";
    }
}

/** How a sentence names the period, for the current one and for a past one. */
function phraseFor(grain: PeriodGrain, isCurrent: boolean): string {
    if (grain === "day") return isCurrent ? "today" : "that day";
    return `${isCurrent ? "this" : "that"} ${grain}`;
}

/**
 * The period `offset` grains back from the one holding `now`, resolved.
 *
 * Every bounded window's upper end is exclusive and sits on the next period's
 * first local midnight, so a play from one minute ago is inside the current one.
 * Boundaries are local, which is the zone the hooks send as `tz`, so the buckets
 * the backend cuts line up with the window asked for.
 */
export function resolvePeriod(
    grain: PeriodGrain,
    offset: number,
    now: Date,
): ResolvedPeriod {
    // a future period has nothing in it, so the offset never goes positive
    const back = Math.min(0, Math.trunc(offset));
    const start = periodStart(grain, back, now);
    const end = periodEnd(grain, start);
    const isCurrent = back === 0;

    return {
        grain,
        offset: back,
        heatmap: heatmapFor(grain, start),
        dateLabel: dateLabelFor(grain, start, end, now),
        phrase: phraseFor(grain, isCurrent),
        isCurrent,
        since: start.toISOString(),
        until: end.toISOString(),
        trendBucket: grain === "year" ? "month" : "day",
        chart: grain === "day" ? "hours" : "trend",
        heatmapBucket: heatmapBucketFor(grain),
    };
}

/** Whether there is a later period to step to. */
export function canStepForward(period: ResolvedPeriod): boolean {
    return !period.isCurrent;
}

/** Whole local days from `from` to `to`, by calendar date, so DST is no issue. */
function daysBetween(from: Date, to: Date): number {
    const utc = (date: Date) =>
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * The offset of the `grain` period holding `date`, counted from the one holding
 * `now`. The inverse of `resolvePeriod`, so a date can be opened as a period.
 * Positive for a period after now's.
 */
export function offsetOf(grain: PeriodGrain, date: Date, now: Date): number {
    switch (grain) {
        case "day":
            return daysBetween(now, date);
        case "week":
            return daysBetween(startOfWeek(now), startOfWeek(date)) / 7;
        case "month":
            return (
                (date.getFullYear() - now.getFullYear()) * 12 +
                date.getMonth() -
                now.getMonth()
            );
        case "year":
            return date.getFullYear() - now.getFullYear();
    }
}

/**
 * The grain a heatmap pick of `grain` opens into, or null at the bottom. Year
 * to month to week to day, one grain a step. A month opens a day's
 * week, not the day.
 */
export function drillGrain(grain: PeriodGrain): PeriodGrain | null {
    switch (grain) {
        case "year":
            return "month";
        case "month":
            return "week";
        case "week":
            return "day";
        case "day":
            return null;
    }
}
