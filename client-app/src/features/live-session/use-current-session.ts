import {
    showsAsLive,
    useLiveSession,
    useMyLiveSession,
} from "@/lib/routes/live-sessions";

/**
 * The open live session the caller is in, or null. An ended or lost session
 * is null too, so everything built on it falls back to the plain player.
 */
export function useCurrentLiveSession() {
    const { mySessionId } = useMyLiveSession();
    const { liveSession, liveSessionErr } = useLiveSession(mySessionId);
    return liveSessionErr ? null : (liveSession ?? null);
}

/** The caller's session while it shows as live (see `showsAsLive`), or null. */
export function useShownLiveSession() {
    const session = useCurrentLiveSession();
    return session && showsAsLive(session) ? session : null;
}
