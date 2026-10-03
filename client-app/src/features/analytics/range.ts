/**
 * The time range the Analytics tab is filtered to, and the window and bucket it
 * resolves to.
 *
 * The range owns the bucket. That is what fixes the chart: an all-time window at
 * weekly buckets gives a user with under a week of history exactly one bar, so
 * each range picks a bucket that gives it a sensible number of them.
 *
 * Pure and import-free, so `range.test.ts` runs it under `node --test`. `now` is
 * injected rather than read from the clock so a test can pin it.
 */

export type AnalyticsRange = "today" | "week" | "month" | "year" | "all";

/** Every range, in the order the filter row shows them. */
export const ANALYTICS_RANGES: AnalyticsRange[] = [
    "today",
    "week",
    "month",
    "year",
    "all",
];

/** What the backend's `bucket` param accepts. `auto` lets it pick. */
export type TrendBucket = "day" | "week" | "month" | "year" | "auto";

export type ResolvedRange = {
    range: AnalyticsRange;
    /** ISO instant, or undefined for all time. */
    since?: string;
    /** ISO instant, exclusive, or undefined for all time. */
    until?: string;
    bucket: TrendBucket;
    /**
     * Which chart the range wants. `hours` is the 24-hour histogram, which says
     * far more about a single day than a one-bar trend would.
     */
    chart: "hours" | "trend";
    /** What the range is called on screen. */
    label: string;
};

/** Short label for the filter chip. */
export function rangeLabel(range: AnalyticsRange): string {
    switch (range) {
        case "today":
            return "Today";
        case "week":
            return "Week";
        case "month":
            return "Month";
        case "year":
            return "Year";
        case "all":
            return "All";
    }
}

/** What the window covers, for a heading. */
export function rangeDescription(range: AnalyticsRange): string {
    switch (range) {
        case "today":
            return "Today";
        case "week":
            return "Last 7 days";
        case "month":
            return "Last 30 days";
        case "year":
            return "Last 12 months";
        case "all":
            return "All time";
    }
}

/** Local midnight on the day `date` falls in. */
function startOfDay(date: Date): Date {
    // the three-argument constructor resolves the device's own offset, so this
    // is DST-safe in a way subtracting 24 hours is not
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local midnight `days` before the day `date` falls in. */
function startOfDayBefore(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - days);
}

/** Local midnight on the 1st of the month `months` before `date`. */
function startOfMonthBefore(date: Date, months: number): Date {
    return new Date(date.getFullYear(), date.getMonth() - months, 1);
}

/**
 * The window and bucket a range means right now.
 *
 * Every window's upper bound is exclusive and sits at the start of the *next*
 * day or month, so a play from one minute ago is inside it. Boundaries are
 * local, which is the same zone the hooks send as `tz`, so the buckets the
 * backend cuts line up with the window the client asked for.
 */
export function resolveRange(range: AnalyticsRange, now: Date): ResolvedRange {
    const label = rangeDescription(range);

    switch (range) {
        case "today":
            return {
                range,
                since: startOfDay(now).toISOString(),
                until: startOfDayBefore(now, -1).toISOString(),
                // unused by the hours chart, but a sensible value for anything
                // that reads it anyway
                bucket: "day",
                chart: "hours",
                label,
            };
        case "week":
            return {
                range,
                since: startOfDayBefore(now, 6).toISOString(),
                until: startOfDayBefore(now, -1).toISOString(),
                bucket: "day",
                chart: "trend",
                label,
            };
        case "month":
            return {
                range,
                since: startOfDayBefore(now, 29).toISOString(),
                until: startOfDayBefore(now, -1).toISOString(),
                bucket: "day",
                chart: "trend",
                label,
            };
        case "year":
            return {
                range,
                since: startOfMonthBefore(now, 11).toISOString(),
                until: startOfMonthBefore(now, -1).toISOString(),
                bucket: "month",
                chart: "trend",
                label,
            };
        case "all":
            return {
                range,
                // no bounds: the backend runs it from the user's first event, and
                // picks the bucket, since it is the side that knows the span
                bucket: "auto",
                chart: "trend",
                label,
            };
    }
}
