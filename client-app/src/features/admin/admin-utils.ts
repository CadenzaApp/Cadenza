import { converter, formatHex } from "culori";
export type ChartField = "plays" | "active_users" | "posts" | "listening_ms";
export type ChartDay = {
    day: string;
    plays?: number;
    active_users?: number;
    posts?: number;
    listening_ms?: number;
    snapshot?: boolean;
    source_cutoff?: string;
};

/** Missing days retain their calendar position, without inventing zero activity. */
export function calendarChartDays(
    days: readonly ChartDay[],
    since: string,
    until: string,
) {
    const byDay = new Map(days.map((day) => [day.day, day]));
    const result: (ChartDay & { missing: boolean })[] = [];
    for (
        let time = Date.parse(since);
        time < Date.parse(until);
        time += 86_400_000
    ) {
        const day = new Date(time).toISOString().slice(0, 10);
        result.push({ ...byDay.get(day), day, missing: !byDay.has(day) });
    }
    return result;
}

export function averageDailyUsers(days: readonly ChartDay[]) {
    const observed = days.filter((day) => day.active_users !== undefined);
    return observed.length
        ? observed.reduce((sum, day) => sum + day.active_users!, 0) /
              observed.length
        : 0;
}

export function chartSegments(days: readonly ChartDay[], field: ChartField) {
    const segments: { index: number; value: number }[][] = [];
    let segment: { index: number; value: number }[] = [];
    days.forEach((day, index) => {
        const value = day[field];
        if (value === undefined) {
            if (segment.length) segments.push(segment);
            segment = [];
        } else segment.push({ index, value });
    });
    if (segment.length) segments.push(segment);
    return segments;
}

/** Display a UTC bucket without a device-timezone date shift. */
export function chartDate(day: string) {
    const date = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return day;
    return `${date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function chartExtrema(days: readonly ChartDay[], field: ChartField) {
    const values = days.flatMap((day) =>
        day[field] === undefined ? [] : [day[field]!],
    );
    return values.length
        ? { min: Math.min(...values), max: Math.max(...values) }
        : { min: 0, max: 0 };
}

const toOklab = converter("oklab");

/** Mix perceptually toward the theme's neutral endpoint, preserving the accent. */
export function adminNebulaPalette(accent: string, scheme: "light" | "dark") {
    const color = toOklab(accent);
    if (!color) return [accent];
    const target = scheme === "dark" ? 0 : 1;
    return [
        accent,
        ...[0.3, 0.7].map(
            (amount) =>
                formatHex({
                    mode: "oklab",
                    l: color.l * (1 - amount) + target * amount,
                    a: color.a * (1 - amount),
                    b: color.b * (1 - amount),
                }) ?? accent,
        ),
    ];
}

export type SongEndings = {
    day: string;
    completed: number;
    early_skips: number;
    skips: number;
};
/** Early skips and other skips are disjoint, so the chart totals exactly 100%. */
export function summarizeEndings(
    rows: readonly SongEndings[],
    day: string | null,
) {
    return rows.reduce(
        (sum, row) =>
            day && row.day !== day
                ? sum
                : {
                      completed: sum.completed + row.completed,
                      early_skips: sum.early_skips + row.early_skips,
                      skips: sum.skips + row.skips,
                  },
        { completed: 0, early_skips: 0, skips: 0 },
    );
}

export function reportingBoundary(iso: string) {
    const date = new Date(iso);
    return new Date(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    ).toISOString();
}
