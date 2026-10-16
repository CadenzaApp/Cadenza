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

/** How long ago `then` was, for an "Updated" line: `just now`, `5m ago`, `2h ago`. */
export function formatUpdatedAgo(then: Date, now: Date): string {
    const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}
