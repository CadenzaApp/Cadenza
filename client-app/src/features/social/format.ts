/**
 * A timestamp as a short relative label (`just now`, `12m`, `3h`, `2d`).
 * Pure so it can run under `node --test`.
 */
export function formatRelativeTime(
    iso: string,
    nowMs: number = Date.now(),
): string {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return "";

    const deltaMs = Math.max(0, nowMs - then);
    const minutes = Math.floor(deltaMs / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;

    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w`;

    return new Date(then).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    });
}

/** Up to two initials from a username. */
export function initialsFromUsername(username: string): string {
    const parts = username
        .trim()
        .split(/[._\-\s]+/)
        .filter(Boolean);
    if (parts.length === 0) return "?";
    return parts
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
}
