import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { useAccount } from "@/lib/account";
import { useUserSettings } from "@/lib/routes/settings";
import { logHandledError } from "@/lib/log";

import {
    CADENZA_NEBULA,
    OnboardingBackdrop,
    Wordmark,
} from "./onboarding-backdrop";
import { ONBOARDING_HREF } from "./onboarding-step";
import { useOnboarding } from "./use-onboarding";

/**
 * The first screen. Restores the Supabase session here rather than in
 * `AccountProvider`, so no other screen has to handle an account that is still
 * loading. Moves on once the session, the Apple Music tokens, and the saved
 * settings are in, so the next screen opens in the user's own theme.
 */
export function SplashScreen() {
    const router = useRouter();
    const { tryRestoreSession } = useAccount();
    const { settingsReady } = useUserSettings();
    const { step } = useOnboarding();
    const [restored, setRestored] = useState(false);

    useEffect(() => {
        async function restore() {
            try {
                await tryRestoreSession();
            } catch (error) {
                // no session to restore lands on login, same as signed out
                logHandledError("Error restoring session", error);
            } finally {
                setRestored(true);
            }
        }
        void restore();
    }, [tryRestoreSession]);

    useEffect(() => {
        if (!restored || !settingsReady || step === "pending") return;
        router.replace(ONBOARDING_HREF[step]);
    }, [restored, settingsReady, step, router]);

    return (
        <OnboardingBackdrop colors={CADENZA_NEBULA}>
            <View className="flex-1 items-center justify-center gap-8">
                <Wordmark />
                <ActivityIndicator accessibilityLabel="Loading" />
            </View>
        </OnboardingBackdrop>
    );
}
