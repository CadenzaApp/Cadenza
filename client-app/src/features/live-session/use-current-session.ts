import { useLiveSession, useMyLiveSession } from "@/lib/routes/live-sessions";

/**
 * The open live session the caller is in, or null. An ended or lost session
 * is null too, so everything built on it falls back to the plain player.
 */
export function useCurrentLiveSession() {
    const { mySessionId } = useMyLiveSession();
    const { liveSession, liveSessionErr } = useLiveSession(mySessionId);
    return liveSessionErr ? null : (liveSession ?? null);
}
