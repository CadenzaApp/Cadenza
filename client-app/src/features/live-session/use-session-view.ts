import { useEffect, useMemo, useState } from "react";
import { Playback } from "@apple-musickit";

import {
    useLocalPlaybackState,
    usePlaybackView,
    type PlaybackView,
} from "@/lib/playback";
import { serverNow } from "@/lib/realtime";
import type { LiveSession } from "@/lib/routes/live-sessions";

import { expectedPositionMs } from "./session-reconciler";
import { entryToTrack, sessionTarget } from "./use-session-player";

/** How often the shown position moves while the session plays. */
const TICK_MS = 750;

/**
 * For a member whose phone does not play the session (Remote, or no
 * subscription): every player surface shows the session instead. Its song,
 * progress, and queue, projected on the server's clock. The buttons reach the
 * session through `useSessionSink`.
 *
 * The member's own music is paused when this starts, since it would keep
 * playing with nothing on screen to stop it.
 */
export function useSessionView(session: LiveSession | null, showing: boolean) {
    const local = useLocalPlaybackState();
    const playing = showing && (session?.playback.is_playing ?? false);

    const [now, setNow] = useState(() => serverNow());
    useEffect(() => {
        if (!playing) return;
        const timer = setInterval(() => setNow(serverNow()), TICK_MS);
        return () => clearInterval(timer);
    }, [playing]);

    useEffect(() => {
        if (!showing || !local.isPlaying) return;
        Playback.pause().catch((error: unknown) =>
            console.warn("Could not pause for the live session:", error),
        );
        // only on the way in
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showing]);

    const target = useMemo(
        () => (session ? sessionTarget(session) : []),
        [session],
    );
    const queue = useMemo(() => target.map(entryToTrack), [target]);

    const view = useMemo<PlaybackView | null>(() => {
        if (!showing || !session) return null;
        const current = target[0];
        const positionMs = expectedPositionMs(
            session.playback.position_ms,
            Date.parse(session.playback.as_of),
            session.playback.is_playing,
            now,
        );
        const durationMs = current?.duration_ms ?? null;
        return {
            queue,
            queueIndex: current ? 0 : -1,
            isPlaying: Boolean(current) && session.playback.is_playing,
            progress:
                (durationMs ? Math.min(positionMs, durationMs) : positionMs) /
                1000,
        };
    }, [now, queue, session, showing, target]);

    usePlaybackView(view);
}
