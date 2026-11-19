import { useLocalSearchParams } from "expo-router";

import { LiveSessionScreen } from "@/features/live-session/LiveSessionScreen";

export default function LiveSessionRoute() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const sessionId = Array.isArray(id) ? id[0] : id;
    if (!sessionId) return null;
    return <LiveSessionScreen sessionId={sessionId} />;
}
