import { useMusicAccess } from "@/lib/use-music-access";
import { useLiveSession, useMyLiveSession } from "@/lib/routes/live-sessions";

import { playsHere, useSessionPlayer } from "./use-session-player";
import { useSessionSink } from "./use-session-sink";

/**
 * Keeps this phone's player on the caller's live session, if they are in one,
 * and sends the app's player commands to the session while it plays here.
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
    const session = liveSessionErr ? null : (liveSession ?? null);
    useSessionPlayer(session, fullPlayback);
    useSessionSink(session, playsHere(session, fullPlayback));
    return null;
}
