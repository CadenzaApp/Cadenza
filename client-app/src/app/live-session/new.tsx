import { useLocalSearchParams } from "expo-router";

import { StartSessionScreen } from "@/features/live-session/StartSessionScreen";

export default function StartSessionRoute() {
    const { edit, openPlayer } = useLocalSearchParams<{
        edit?: string;
        openPlayer?: string;
    }>();
    return (
        <StartSessionScreen
            editing={edit === "1"}
            openPlayer={openPlayer === "1"}
        />
    );
}
