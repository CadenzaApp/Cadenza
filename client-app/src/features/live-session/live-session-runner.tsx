import { useMusicAccess } from "@/lib/use-music-access";
import { useLiveSession, useMyLiveSession } from "@/lib/routes/live-sessions";

import { useSessionPlayer } from "./use-session-player";

/**
 * Keeps this phone's player on the caller's live session, if they are in one.
 * Renders nothing. Mounted once, inside `PlaybackProvider`.
 *
 * Playing along needs full playback; the preview player cannot follow a
 * session, so a member without a subscription stays remote.
 */
export function LiveSessionRunner() {
    const fullPlayback = useMusicAccess().can("fullPlayback");
    const { mySessionId } = useMyLiveSession();
    const { liveSession, liveSessionErr } = useLiveSession(mySessionId);
    // an ended or lost session plays nothing, so the member's queue comes back
    useSessionPlayer(
        liveSessionErr ? null : (liveSession ?? null),
        fullPlayback,
    );
    return null;
}
