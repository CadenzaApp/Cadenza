import { useMusicAccess } from "@/lib/use-music-access";

import { useCurrentLiveSession } from "./use-current-session";
import { playsHere, useSessionPlayer } from "./use-session-player";
import { useSessionSink } from "./use-session-sink";
import { useSessionView } from "./use-session-view";

/**
 * Keeps this phone's player on the caller's live session, if they are in one,
 * and sends the app's player commands to the session. Where the session does
 * not play on this phone, the player shows it anyway. Renders nothing.
 * Mounted once, inside `PlaybackProvider`.
 *
 * Playing along needs full playback; the preview player cannot follow a
 * session, so a member without a subscription stays remote.
 */
export function LiveSessionRunner() {
    const fullPlayback = useMusicAccess().can("fullPlayback");
    // an ended or lost session plays nothing, so the member's queue comes back
    const session = useCurrentLiveSession();
    useSessionPlayer(session, fullPlayback);
    useSessionSink(session);
    useSessionView(
        session,
        session !== null && !playsHere(session, fullPlayback),
    );
    return null;
}
