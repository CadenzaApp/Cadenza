/**
 * Where a friend's song is right now, from the position the backend projected
 * to `as_of`. Pure so `listening-progress.test.ts` runs it under `node --test`.
 *
 * Only for a playing row; a paused one stays where it is.
 */

/** Position in ms at `nowMs`, never below 0 or past the end. */
export function livePositionMs(
    positionMs: number,
    asOf: string,
    durationMs: number | null,
    nowMs: number = Date.now(),
): number {
    const anchor = Date.parse(asOf);
    const elapsed = Number.isFinite(anchor) ? Math.max(0, nowMs - anchor) : 0;
    const position = positionMs + elapsed;
    return durationMs === null ? position : Math.min(position, durationMs);
}

/** `m:ss`, like a player shows it. */
export function formatTrackTime(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
