import { useLocalSearchParams } from "expo-router";

import { StartSessionScreen } from "@/features/live-session/StartSessionScreen";

export default function StartSessionRoute() {
    const { edit } = useLocalSearchParams<{ edit?: string }>();
    return <StartSessionScreen editId={edit || undefined} />;
}
