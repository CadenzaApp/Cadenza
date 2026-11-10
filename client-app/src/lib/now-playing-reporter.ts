import { useEffect, useRef } from "react";
import type { MusicItem, PlaybackSnapshot } from "@apple-musickit";

import {
    nowPlayingAction,
    shareableSongId,
    type NowPlayingSample,
} from "./now-playing-change";
import { useNowPlayingWrites } from "./routes/listening";

/**
 * Waits this long after a change before sending, so skipping through five
 * songs sends the last one, not all five.
 */
const SEND_DELAY_MS = 1_000;

/**
 * Tells the backend what is playing, so friends can see it. Called once, from
 * `PlaybackProvider`, with the snapshot it already polls. What counts as worth
 * sending is `now-playing-change.ts`.
 *
 * `activeTrack` is null for the preview player, so a preview is never shared,
 * same as it is never counted as a play. Who can see the row is the backend's
 * call, from the user's privacy settings.
 *
 * Only runs in the foreground, like the play recorder. A song left playing in
 * the background stays shown until it would have ended.
 */
export function useNowPlayingReporter(
    snapshot: PlaybackSnapshot,
    activeTrack: MusicItem | null,
) {
    const { putNowPlaying, clearNowPlaying } = useNowPlayingWrites();
    const lastSentRef = useRef<NowPlayingSample | null>(null);
    const latestRef = useRef<{
        sample: NowPlayingSample;
        track: MusicItem | null;
        durationMs: number | null;
    } | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const songId = shareableSongId(activeTrack);

    useEffect(() => {
        latestRef.current = {
            sample: {
                songId,
                isPlaying: snapshot.isPlaying,
                positionMs: Math.round(snapshot.progress * 1000),
                at: Date.now(),
            },
            track: activeTrack,
            durationMs: snapshot.duration
                ? Math.round(snapshot.duration * 1000)
                : null,
        };
        if (timerRef.current !== null) return;
        if (
            nowPlayingAction(lastSentRef.current, latestRef.current.sample) ===
            null
        )
            return;

        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            const latest = latestRef.current;
            if (!latest) return;
            const action = nowPlayingAction(lastSentRef.current, latest.sample);
            if (action === null) return;
            lastSentRef.current = latest.sample;

            void (async () => {
                try {
                    if (action === "clear" || !latest.track) {
                        await clearNowPlaying();
                        return;
                    }
                    await putNowPlaying({
                        song_id: latest.sample.songId!,
                        title: latest.track.title,
                        artist: latest.track.artistName ?? null,
                        album: latest.track.albumName ?? null,
                        artwork_url: latest.track.artworkUrl ?? null,
                        duration_ms: latest.durationMs,
                        is_playing: latest.sample.isPlaying,
                        position_ms: latest.sample.positionMs,
                    });
                } catch (error) {
                    // the next change or heartbeat sends again
                    console.warn("Could not report now playing:", error);
                }
            })();
        }, SEND_DELAY_MS);
    }, [
        activeTrack,
        clearNowPlaying,
        putNowPlaying,
        songId,
        snapshot.isPlaying,
        snapshot.progress,
        snapshot.duration,
    ]);

    useEffect(
        () => () => {
            if (timerRef.current !== null) clearTimeout(timerRef.current);
        },
        [],
    );
}
