import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";

import { useRealtimeTopic } from "@/lib/realtime";
import type { LiveSession } from "@/lib/routes/live-sessions";

import { takeAskedToJoin } from "./asked-to-join";

/**
 * Tells a member what happened to their session: that the host let them in,
 * that it ended, or that the host left and handed it to someone else.
 * Whoever did it already knows, so the host ending it and the host handing it
 * over see nothing.
 */
export function useSessionNotices(session: LiveSession | null) {
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
            before.userId === host.user_id
        ) {
            return;
        }
        Alert.alert(
            "New host",
            session.my_role === "host"
                ? `${before.username} left and made you the host. The music plays from this phone now.`
                : `${before.username} left. ${host.username} is the host now.`,
        );
    }, [session]);

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
