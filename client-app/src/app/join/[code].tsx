import { useLocalSearchParams } from "expo-router";

import { JoinScreen } from "@/features/live-session/JoinScreen";

/** `cadenza://join/CODE`: the join sheet with the code filled in, redeeming. */
export default function JoinCodeRoute() {
    const { code } = useLocalSearchParams<{ code: string }>();
    return <JoinScreen initialCode={Array.isArray(code) ? code[0] : code} />;
}
