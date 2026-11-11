import { useCallback } from "react";

import { useStartLiveSession } from "@/lib/routes/live-sessions";
import { useProfile } from "@/lib/routes/profile";

import { useSeedSession } from "./use-seed-session";

/**
 * Starts a live session in one tap, seeded with what is playing. Named after
 * the caller, people join as suggesters, and only with a code. All of it can
 * be changed after from Session settings.
 */
export function useStartSessionNow() {
    const { profile } = useProfile();
    const { startLiveSession, startLiveSessionLoading } = useStartLiveSession();
    const seedSession = useSeedSession();
    const username = profile?.username;

    const start = useCallback(async () => {
        const { session_id } = await startLiveSession({
            name: username ? `${username}'s session` : "My session",
            default_role: "suggester",
            allow_join_without_code: false,
        });
        await seedSession(session_id);
    }, [username, seedSession, startLiveSession]);

    return { startSessionNow: start, startingSession: startLiveSessionLoading };
}
