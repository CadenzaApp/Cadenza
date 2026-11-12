import type { LiveSessionPlayback } from "./routes/live-sessions";

/**
 * Where a live session's playback is, in ms, at server time `serverNowMs`:
 * the snapshot's position plus the time since it was taken, while playing.
 */
export function playbackPositionMs(
    playback: Pick<LiveSessionPlayback, "position_ms" | "as_of" | "is_playing">,
    serverNowMs: number,
): number {
    if (!playback.is_playing) return playback.position_ms;
    return (
        playback.position_ms +
        Math.max(0, serverNowMs - Date.parse(playback.as_of))
    );
}
