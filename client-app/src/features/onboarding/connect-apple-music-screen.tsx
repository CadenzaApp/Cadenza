import Ionicons from "@expo/vector-icons/Ionicons";
import { AuthStatus } from "@apple-musickit";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
    ActivityIndicator,
    Linking,
    Platform,
    Pressable,
    ScrollView,
    View,
} from "react-native";

import { AppleMusicLogo } from "@/components/custom/apple-music-logo";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { useConnectAppleMusic } from "@/features/account/apple-music-connection";
import {
    SettingsPoints,
    type SettingsPoint,
} from "@/features/account/settings-ui";
import { useAccount } from "@/lib/account";
import { APPLE_MUSIC_GRADIENT, useAppTheme } from "@/lib/theme";

import { APPLE_MUSIC_NEBULA, OnboardingBackdrop } from "./onboarding-backdrop";
import { ONBOARDING_HREF } from "./onboarding-step";
import { useOnboarding } from "./use-onboarding";

/**
 * - `onboarding`: step two after login. Back signs out, skipping finishes the
 *   step and the app runs on previews.
 * - `connect`: a modal from a gated screen, like Library without Apple Music.
 * - `reconnect`: a modal after Apple drops the connection.
 *
 * In both modals, close and "Not now" just dismiss it.
 */
export type ConnectMode = "onboarding" | "connect" | "reconnect";

type ModeCopy = { title: string; body: string; skip: string; modal: boolean };

const COPY: Record<ConnectMode, ModeCopy> = {
    onboarding: {
        title: "Connect Apple Music",
        body: "Cadenza reads your library and plays through Apple Music. Without it you can still search, tag, and hear 30 second previews.",
        skip: "Try Cadenza with previews",
        modal: false,
    },
    connect: {
        title: "Connect Apple Music",
        body: "Bring in your library and playlists, and play full songs with a subscription.",
        skip: "Not now",
        modal: true,
    },
    reconnect: {
        title: "Reconnect Apple Music",
        body: "Apple ended the saved sign in. Until you reconnect, Cadenza plays previews and your library is hidden.",
        skip: "Keep using previews",
        modal: true,
    },
};

const WHAT_IT_UNLOCKS: SettingsPoint[] = [
    {
        icon: "library-outline",
        title: "Your library",
        body: "Tag the songs, albums, and playlists you already have.",
    },
    {
        icon: "play-circle-outline",
        title: "Full songs",
        body: "Play whole songs with an Apple Music subscription.",
    },
    {
        icon: "list-outline",
        title: "Playlists",
        body: "Save any query back to Apple Music as a playlist.",
    },
];

/** Apple never says which account it is, so say where it comes from. */
const WHICH_ACCOUNT =
    Platform.OS === "android"
        ? "Uses the account signed in to the Apple Music app. To use a different one, switch it there."
        : "Uses the Apple Music account on this iPhone. To use a different one, switch it in Settings > Media & Purchases.";

export function ConnectAppleMusicScreen({ mode }: { mode: ConnectMode }) {
    const router = useRouter();
    const { colors } = useAppTheme();
    const { signOut } = useAccount();
    const { step, finishConnectStep } = useOnboarding();
    const { connectAppleMusic, isConnecting, message, lastStatus } =
        useConnectAppleMusic();
    const [leaving, setLeaving] = useState(false);

    // onboarding follows the step: signing out or connecting moves it on
    if (mode === "onboarding" && step !== "connect" && step !== "pending") {
        return <Redirect href={ONBOARDING_HREF[step]} />;
    }

    const copy = COPY[mode];

    async function connect() {
        const result = await connectAppleMusic();
        const connected =
            result?.status === AuthStatus.Authorized && result.userToken;
        if (connected && copy.modal) router.back();
    }

    async function skip() {
        if (copy.modal) {
            router.back();
            return;
        }
        setLeaving(true);
        try {
            await finishConnectStep();
        } finally {
            setLeaving(false);
        }
    }

    async function back() {
        if (copy.modal) {
            router.back();
            return;
        }
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
                    accessibilityLabel={copy.modal ? "Close" : "Back to login"}
                    onPress={() => void back()}
                    disabled={busy}
                >
                    <Ionicons
                        name={copy.modal ? "close" : "chevron-back"}
                        size={22}
                        color={colors.foreground}
                    />
                </GlassIconButton>
            </View>

            <ScrollView contentContainerClassName="flex-grow justify-center gap-8 px-6 py-6">
                <View className="items-center gap-3">
                    <AppleMusicLogo size={96} />
                    <Text className="mt-2 text-center text-3xl font-bold tracking-tight">
                        {copy.title}
                    </Text>
                    <Text className="text-center text-base leading-6 text-muted-foreground">
                        {copy.body}
                    </Text>
                </View>

                <View className="gap-3">
                    <SettingsPoints points={WHAT_IT_UNLOCKS} />
                </View>

                <View className="gap-3">
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
                        onPress={() => void connect()}
                        disabled={busy}
                    >
                        {isConnecting ? (
                            <ActivityIndicator />
                        ) : (
                            <Text className="text-base font-semibold">
                                {copy.title}
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
                        className="h-11 items-center justify-center active:opacity-60"
                    >
                        <Text className="text-sm font-semibold text-muted-foreground">
                            {copy.skip}
                        </Text>
                    </Pressable>
                </View>
            </ScrollView>
        </OnboardingBackdrop>
    );
}
