/** Apple release dates are UTC calendar days, not local timestamps. */
export function formatReleaseMonthYear(timestamp: number | undefined) {
    if (timestamp == null || !Number.isFinite(timestamp)) return undefined;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    });
}
