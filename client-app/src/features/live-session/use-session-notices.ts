import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";

import { useAccount } from "@/lib/account";
import { useRealtimeTopic } from "@/lib/realtime";
import type { LiveSession } from "@/lib/routes/live-sessions";

import { takeAskedToJoin } from "./asked-to-join";

/**
 * Tells a member what happened to their session: that the host let them in,
 * that it ended, or that it has a new host, because the host left and handed
 * it over or made someone else host and stayed. Whoever did it already knows,
 * so the host ending it, handing it over, or making someone host sees nothing.
 */
export function useSessionNotices(session: LiveSession | null) {
    const { account } = useAccount();
    // the host before this snapshot, to tell a hand over from a refetch
    const lastHost = useRef<{
        sessionId: string;
        userId: string;
        username: string;
    } | null>(null);

    useEffect(() => {
        if (!session) return;
        if (takeAskedToJoin(session.session_id)) {
            Alert.alert(
                "You're in",
                `${session.host.username} let you into ${session.name}.`,
                [
                    { text: "Later", style: "cancel" },
                    { text: "Open", onPress: () => router.push("/player") },
                ],
            );
        }
        const before = lastHost.current;
        const host = session.host;
        lastHost.current = {
            sessionId: session.session_id,
            userId: host.user_id,
            username: host.username,
        };
        if (
            !before ||
            before.sessionId !== session.session_id ||
            before.userId === host.user_id ||
            // the old host made someone else host, and knows
            before.userId === account?.id
        ) {
            return;
        }
        // still in it: made someone else host rather than leaving
        const stayed = session.members.some(
            (member) => member.user_id === before.userId,
        );
        const isNewHost = session.my_role === "host";
        Alert.alert(
            "New host",
            stayed
                ? isNewHost
                    ? `${before.username} made you the host. The music plays from this phone now.`
                    : `${before.username} made ${host.username} the host.`
                : isNewHost
                  ? `${before.username} left and made you the host. The music plays from this phone now.`
                  : `${before.username} left. ${host.username} is the host now.`,
        );
    }, [account?.id, session]);

    // only a member still in it hears the end; leaving unsubscribes
    useRealtimeTopic(
        session ? { kind: "live_session", id: session.session_id } : null,
        (event) => {
            if (event.kind !== "ended" || session?.my_role === "host") return;
            const host = session?.host.username ?? "The host";
            // the server ending it says why; the host ending it says nothing
            const reason = (event.data as { reason?: string } | null)?.reason;
            Alert.alert(
                "Session ended",
                reason === "host_gone"
                    ? `${host} closed the app, so the live session ended.`
                    : reason === "paused"
                      ? "The live session was paused for 10 minutes, so it ended."
                      : `${host} ended the live session.`,
            );
        },
    );
}
