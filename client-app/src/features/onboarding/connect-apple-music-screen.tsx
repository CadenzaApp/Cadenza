import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import {
    AppleMusicBlurb,
    AppleMusicHero,
    AppleMusicUnlocks,
    ConnectAppleMusicActions,
    WhichAccountNote,
} from "@/features/account/apple-music-connect-ui";
import { useConnectAppleMusic } from "@/features/account/apple-music-connection";
import { useAccount } from "@/lib/account";
import { logHandledError } from "@/lib/log";
import { APPLE_MUSIC_NEBULA, useAppTheme } from "@/lib/theme";

import { OnboardingBackdrop } from "./onboarding-backdrop";
import { ONBOARDING_HREF } from "./onboarding-step";
import { useOnboarding } from "./use-onboarding";

/** Room at the top for the floating back button, below the status bar. */
const HEADER_ROOM = 64;

/**
 * Step two of onboarding, after login. Back signs out; skipping finishes the
 * step and the app runs on previews. Inside the app, connecting happens on
 * `GatedFeature` and `ReconnectAppleMusicSheet`, built from the same parts.
 */
export function ConnectAppleMusicScreen() {
    const { colors } = useAppTheme();
    const { signOut } = useAccount();
    const { step, finishConnectStep } = useOnboarding();
    const { connectAppleMusic, isConnecting, message, lastStatus } =
        useConnectAppleMusic();
    const [leaving, setLeaving] = useState(false);
    const [footerHeight, setFooterHeight] = useState(0);
    const insets = useSafeAreaInsets();

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
            logHandledError("Sign out failed", error);
            setLeaving(false);
        }
    }

    return (
        <OnboardingBackdrop colors={APPLE_MUSIC_NEBULA} edgeToEdge>
            {/* the page scrolls edge to edge, under the floating back button
                and actions, so there is no band where it gets cut off. the
                padding keeps it clear of both at rest */}
            <ScrollView
                className="flex-1"
                contentContainerClassName="flex-grow justify-center gap-6 px-6"
                contentContainerStyle={{
                    paddingTop: insets.top + HEADER_ROOM,
                    paddingBottom: insets.bottom + footerHeight + 16,
                }}
                showsVerticalScrollIndicator={false}
            >
                <AppleMusicHero title="Connect Apple Music">
                    <AppleMusicBlurb>
                        Cadenza reads your library and plays through Apple
                        Music. Without it you can still search, tag, and hear 30
                        second previews.
                    </AppleMusicBlurb>
                </AppleMusicHero>
                <AppleMusicUnlocks />
                <WhichAccountNote />
            </ScrollView>

            <View className="absolute left-4" style={{ top: insets.top + 8 }}>
                <GlassIconButton
                    accessibilityLabel="Back to login"
                    onPress={() => void back()}
                    disabled={isConnecting || leaving}
                >
                    <Ionicons
                        name="chevron-back"
                        size={22}
                        color={colors.foreground}
                    />
                </GlassIconButton>
            </View>

            <View
                className="absolute inset-x-0 bottom-0 px-6"
                style={{ paddingBottom: insets.bottom + 8 }}
                onLayout={(event) =>
                    setFooterHeight(event.nativeEvent.layout.height)
                }
            >
                <ConnectAppleMusicActions
                    label="Connect Apple Music"
                    onConnect={() => void connectAppleMusic()}
                    isConnecting={isConnecting}
                    disabled={leaving}
                    message={message}
                    lastStatus={lastStatus}
                    secondary={{
                        label: "Try Cadenza with previews",
                        onPress: () => void skip(),
                    }}
                />
            </View>
        </OnboardingBackdrop>
    );
}
