import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
import { Text } from "@/components/ui/text";
import { APPLE_MUSIC_GRADIENT } from "@/lib/theme";

/** Cadenza's own colors, for the splash and login before any theme is saved. */
export const CADENZA_NEBULA = ["#6466b8", "#257a83", "#ff6467"] as const;

/** Apple's red, for the connect step. */
export const APPLE_MUSIC_NEBULA = [...APPLE_MUSIC_GRADIENT, "#6466b8"] as const;

/** A full screen nebula page inside the safe area. Every onboarding screen sits on one. */
export function OnboardingBackdrop({
    colors,
    children,
}: {
    colors: readonly string[];
    children: ReactNode;
}) {
    const insets = useSafeAreaInsets();

    return (
        <View className="flex-1 bg-background">
            <View pointerEvents="none" className="absolute inset-0">
                <NebulaBackdrop colors={colors} layout="full" />
            </View>
            <View
                className="flex-1"
                style={{
                    paddingTop: insets.top,
                    paddingBottom: insets.bottom,
                }}
            >
                {children}
            </View>
        </View>
    );
}

/** The Cadenza name as a heading, with an optional line under it. */
export function Wordmark({ tagline }: { tagline?: string }) {
    return (
        <View className="items-center gap-2">
            <Text className="text-5xl font-bold tracking-tight">cadenza</Text>
            {tagline ? (
                <Text className="text-center text-base text-muted-foreground">
                    {tagline}
                </Text>
            ) : null}
        </View>
    );
}
