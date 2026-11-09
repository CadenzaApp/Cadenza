import Ionicons from "@expo/vector-icons/Ionicons";
import { AuthStatus } from "@apple-musickit";
import { Redirect } from "expo-router";
import { useState } from "react";
import {
    ActivityIndicator,
    Linking,
    Pressable,
    ScrollView,
    View,
} from "react-native";

import { AppleMusicLogo } from "@/components/custom/apple-music-logo";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { useConnectAppleMusic } from "@/features/account/apple-music-connection";
import { SettingsPoints } from "@/features/account/settings-ui";
import { useAccount } from "@/lib/account";
import { APPLE_MUSIC_GRADIENT, useAppTheme } from "@/lib/theme";

import { WHAT_IT_UNLOCKS, WHICH_ACCOUNT } from "./connect-copy";
import { APPLE_MUSIC_NEBULA, OnboardingBackdrop } from "./onboarding-backdrop";
import { ONBOARDING_HREF } from "./onboarding-step";
import { useOnboarding } from "./use-onboarding";

const COPY = {
    title: "Connect Apple Music",
    body: "Cadenza reads your library and plays through Apple Music. Without it you can still search, tag, and hear 30 second previews.",
    skip: "Try Cadenza with previews",
};

/**
 * Step two of onboarding, after login. Back signs out; skipping finishes the
 * step and the app runs on previews. Inside the app, connecting happens on
 * `ConnectAppleMusicSheet` instead.
 */
export function ConnectAppleMusicScreen() {
    const { colors } = useAppTheme();
    const { signOut } = useAccount();
    const { step, finishConnectStep } = useOnboarding();
    const { connectAppleMusic, isConnecting, message, lastStatus } =
        useConnectAppleMusic();
    const [leaving, setLeaving] = useState(false);

    // the page follows the step: signing out or connecting moves it on
    if (step !== "connect" && step !== "pending") {
        return <Redirect href={ONBOARDING_HREF[step]} />;
    }

    async function skip() {
        setLeaving(true);
        try {
            await finishConnectStep();
        } finally {
            setLeaving(false);
        }
    }

    async function back() {
        setLeaving(true);
        try {
            await signOut();
        } catch (error) {
            console.error("Sign out failed:", error);
            setLeaving(false);
        }
    }

    const busy = isConnecting || leaving;

    return (
        <OnboardingBackdrop colors={APPLE_MUSIC_NEBULA}>
            <View className="flex-row px-4 pt-2">
                <GlassIconButton
                    accessibilityLabel="Back to login"
                    onPress={() => void back()}
                    disabled={busy}
                >
                    <Ionicons
                        name="chevron-back"
                        size={22}
                        color={colors.foreground}
                    />
                </GlassIconButton>
            </View>

            {/* the explainer scrolls; the actions below it are pinned, so a
                short sheet never pushes the button out of view */}
            <ScrollView
                className="flex-1"
                contentContainerClassName="flex-grow justify-center gap-6 px-6 py-4"
            >
                <View className="items-center gap-3">
                    <AppleMusicLogo size={96} />
                    <Text className="mt-2 text-center text-3xl font-bold tracking-tight">
                        {COPY.title}
                    </Text>
                    <Text className="text-center text-base leading-6 text-muted-foreground">
                        {COPY.body}
                    </Text>
                </View>

                <View className="gap-3">
                    <SettingsPoints points={WHAT_IT_UNLOCKS} />
                </View>
            </ScrollView>

            <View className="gap-3 px-6 pb-2 pt-3">
                {message ? (
                    <Text
                        accessibilityRole="alert"
                        className="text-center text-sm leading-5 text-muted-foreground"
                    >
                        {message}
                    </Text>
                ) : null}
                {lastStatus === AuthStatus.Denied ? (
                    <Pressable
                        accessibilityRole="link"
                        onPress={() => void Linking.openSettings()}
                        className="active:opacity-60"
                    >
                        <Text className="text-center text-sm font-semibold underline">
                            Allow access in Settings
                        </Text>
                    </Pressable>
                ) : null}

                <GlassButton
                    glassTintColor={APPLE_MUSIC_GRADIENT[0]}
                    onPress={() => void connectAppleMusic()}
                    disabled={busy}
                >
                    {isConnecting ? (
                        <ActivityIndicator />
                    ) : (
                        <Text className="text-base font-semibold">
                            {COPY.title}
                        </Text>
                    )}
                </GlassButton>
                <Text className="px-2 text-center text-xs leading-4 text-muted-foreground">
                    {WHICH_ACCOUNT}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    onPress={() => void skip()}
                    disabled={busy}
                    className="h-10 items-center justify-center active:opacity-60"
                >
                    <Text className="text-sm font-semibold text-muted-foreground">
                        {COPY.skip}
                    </Text>
                </Pressable>
            </View>
        </OnboardingBackdrop>
    );
}
