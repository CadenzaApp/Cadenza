/**
 * Turning raw analytics numbers into what a person reads. Pure and import-free,
 * so it runs under `node --test` (see `format.test.ts`).
 */

/** Milliseconds as `3h 24m`, `24m`, or `48s`. Rounds down, never to nothing. */
export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0m";

    const totalMinutes = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    if (totalMinutes > 0) return `${totalMinutes}m`;
    // under a minute still reads as something, so a first play is not "0m"
    return `${Math.floor(ms / 1000)}s`;
}

/** A 0..1 rate as a whole percent. */
export function formatPercent(rate: number): string {
    if (!Number.isFinite(rate)) return "0%";
    return `${Math.round(rate * 100)}%`;
}

/** Thousands separators, so 1240 reads as 1,240. */
export function formatCount(value: number): string {
    if (!Number.isFinite(value)) return "0";
    return Math.round(value).toLocaleString("en-US");
}

/**
 * A metric's value, formatted by what it means.
 *
 * The unit comes from the backend with the metric, so this works for any metric
 * without a lookup table here. Without it every value renders as a count, and a
 * listening time reads as 71,280,000 rather than 19h 48m.
 */
export function formatMetric(
    value: number,
    unit: "count" | "milliseconds",
): string {
    return unit === "milliseconds" ? formatDuration(value) : formatCount(value);
}

/**
 * An hour of the day as `2 PM`. Index 0 is midnight, matching the backend's
 * `plays_by_hour` array.
 */
export function formatHour(hour: number): string {
    const normalized = ((Math.round(hour) % 24) + 24) % 24;
    if (normalized === 0) return "12 AM";
    if (normalized === 12) return "12 PM";
    return normalized < 12 ? `${normalized} AM` : `${normalized - 12} PM`;
}

/**
 * A `YYYY-MM-DD` bucket as a short axis label, by how wide the bucket is.
 *
 * Parsed by hand rather than with `new Date()`, because that reads a bare date as
 * UTC midnight and then prints it in the device's zone, which moves the label a
 * day west of Greenwich. The bucket is already local to the user.
 */
export function formatBucket(
    bucket: string,
    size: "day" | "week" | "month" | "year",
): string {
    const [year, month, day] = bucket.split("-").map(Number);
    if (!year || !month || !day) return bucket;

    const monthName = MONTHS[month - 1] ?? "";
    switch (size) {
        case "year":
            return String(year);
        case "month":
            return monthName;
        default:
            return `${monthName} ${day}`;
    }
}

const MONTHS = [
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

/**
 * Which bucket labels to show, so an axis never collides with itself: at most
 * `max`, always including the first and last.
 */
export function labelledIndices(count: number, max = 5): Set<number> {
    if (count <= 0) return new Set();
    if (count <= max)
        return new Set(Array.from({ length: count }, (_, i) => i));

    const step = (count - 1) / (max - 1);
    const picked = new Set<number>();
    for (let i = 0; i < max; i++) picked.add(Math.round(i * step));
    return picked;
}
