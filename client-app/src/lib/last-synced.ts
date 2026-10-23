/**
 * How long ago a sync finished, for a "Last synced" label. Kept free of
 * imports so it can be unit tested without React Native.
 */
export function formatSyncedAgo(syncedAt: number, now: number): string {
    const minutes = Math.floor(Math.max(0, now - syncedAt) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;

    const days = Math.floor(hours / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
}
