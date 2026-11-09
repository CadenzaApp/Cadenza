import { AuthStatus } from "@apple-musickit";
import type { ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, View } from "react-native";

import { AppleMusicLogo } from "@/components/custom/apple-music-logo";
import { GlassButton } from "@/components/ui/glass-button";
import { Text } from "@/components/ui/text";
import { APPLE_MUSIC_GRADIENT } from "@/lib/theme";

import { WHAT_IT_UNLOCKS, WHICH_ACCOUNT } from "./apple-music-copy";
import { SettingsPoints } from "./settings-ui";

/**
 * The pieces every Apple Music page is built from: the onboarding step, the
 * connect and reconnect sheets, and Apple Music settings. Each page arranges
 * them on its own surface, so the three stay one design.
 */

/** The big logo and title, with a line or a status under them. */
export function AppleMusicHero({
    title,
    children,
}: {
    title: string;
    /** Under the title: a sentence, or a status row. */
    children?: ReactNode;
}) {
    return (
        <View className="items-center gap-3">
            <AppleMusicLogo size={96} />
            <Text className="mt-2 text-center text-3xl font-bold tracking-tight">
                {title}
            </Text>
            {children}
        </View>
    );
}

/** A sentence under the hero title. */
export function AppleMusicBlurb({ children }: { children: ReactNode }) {
    return (
        <Text className="text-center text-base leading-6 text-muted-foreground">
            {children}
        </Text>
    );
}

/** What connecting adds, as cards. */
export function AppleMusicUnlocks() {
    return (
        <View className="gap-3">
            <SettingsPoints points={WHAT_IT_UNLOCKS} />
        </View>
    );
}

/** Which account connecting uses, since Apple never says. */
export function WhichAccountNote() {
    return (
        <Text className="px-2 text-center text-xs leading-4 text-muted-foreground">
            {WHICH_ACCOUNT}
        </Text>
    );
}

/**
 * The red connect button, with what the last attempt said above it and a
 * way to Settings when access was denied. `secondary` is the quiet link under
 * it, like "Continue with previews".
 */
export function ConnectAppleMusicActions({
    label,
    onConnect,
    isConnecting,
    disabled = false,
    message,
    lastStatus,
    secondary,
}: {
    label: string;
    onConnect: () => void;
    isConnecting: boolean;
    disabled?: boolean;
    message: string | null;
    lastStatus: AuthStatus | null;
    secondary?: { label: string; onPress: () => void };
}) {
    return (
        <View className="gap-2">
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
                onPress={onConnect}
                disabled={disabled || isConnecting}
            >
                {isConnecting ? (
                    <ActivityIndicator />
                ) : (
                    <Text className="text-base font-semibold">{label}</Text>
                )}
            </GlassButton>
            {secondary ? (
                <Pressable
                    accessibilityRole="button"
                    onPress={secondary.onPress}
                    disabled={disabled || isConnecting}
                    className="h-10 items-center justify-center active:opacity-60"
                >
                    <Text className="text-sm font-semibold text-muted-foreground">
                        {secondary.label}
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
}
