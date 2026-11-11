import { useLiveSession, useMyLiveSession } from "@/lib/routes/live-sessions";

/**
 * The caller's open live session, for the player's LIVE line. Null when they
 * are not in one. Shares the runner's cache, so it costs no extra request.
 */
export function useLiveSessionBadge(): {
    sessionId: string;
    name: string;
} | null {
    const { mySessionId } = useMyLiveSession();
    const { liveSession } = useLiveSession(mySessionId);
    if (!mySessionId || !liveSession) return null;
    return { sessionId: mySessionId, name: liveSession.name };
}
