import { useEffect, useRef } from "react";
import { Alert } from "react-native";

import {
    useLiveSessionWrites,
    type LiveSession,
} from "@/lib/routes/live-sessions";

/**
 * Asks the host, in the app, about each person waiting to join: let them in
 * or not now. Runs for a quiet listen along session too, which is where most
 * asks land. Each request is asked about once; it also waits on the
 * Notifications screen and in the session's Requests.
 */
export function useJoinRequestPrompts(session: LiveSession | null) {
    const writes = useLiveSessionWrites(session?.session_id ?? "none");
    const asked = useRef(new Set<string>());

    useEffect(() => {
        if (!session || session.my_role !== "host") return;
        for (const request of session.join_requests) {
            const key = `${session.session_id}:${request.user_id}:${request.requested_at}`;
            if (asked.current.has(key)) continue;
            asked.current.add(key);

            async function answer(accept: boolean) {
                try {
                    await writes.answerJoinRequest(request.user_id, accept);
                } catch {
                    // answered somewhere else already, or the session is over
                }
            }
            Alert.alert(
                `${request.username} wants to join`,
                session.listen_along
                    ? "They'd like to listen along with you."
                    : `They'd like to join ${session.name}.`,
                [
                    {
                        text: "Not now",
                        style: "cancel",
                        onPress: () => void answer(false),
                    },
                    { text: "Let in", onPress: () => void answer(true) },
                ],
            );
        }
    }, [session, writes]);
}
