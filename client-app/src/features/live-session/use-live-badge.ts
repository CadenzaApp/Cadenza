import { useShownLiveSession } from "./use-current-session";

/**
 * The caller's live session, for the player's LIVE line. Null when they are
 * not in one, or it is a listen along session nobody joined. Shares the
 * runner's cache, so it costs no extra request.
 */
export function useLiveSessionBadge(): {
    sessionId: string;
    name: string;
} | null {
    const session = useShownLiveSession();
    return session
        ? { sessionId: session.session_id, name: session.name }
        : null;
}
