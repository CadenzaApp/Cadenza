import { useLocalSearchParams } from "expo-router";

import {
    LoginScreen,
    type LoginMode,
} from "@/features/onboarding/login-screen";

export default function AuthRoute() {
    const { initialMode } = useLocalSearchParams<{ initialMode?: LoginMode }>();
    return <LoginScreen initialMode={initialMode} />;
}
