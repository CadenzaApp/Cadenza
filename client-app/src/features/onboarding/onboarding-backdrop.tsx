import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CadenzaLogo } from "@/components/custom/cadenza-logo";
import { NebulaBackdrop } from "@/components/ui/nebula-backdrop";
import { Text } from "@/components/ui/text";

/** Cadenza's own colors, for the splash and login before any theme is saved. */
export const CADENZA_NEBULA = ["#6466b8", "#257a83", "#ff6467"] as const;

/**
 * A full screen nebula page. Every onboarding screen sits on one. Its children
 * sit inside the safe area, unless `edgeToEdge`: then a screen that scrolls
 * under floating controls places itself, so the scroll is not clipped short of
 * the screen edges.
 */
export function OnboardingBackdrop({
    colors,
    edgeToEdge = false,
    children,
}: {
    colors: readonly string[];
    edgeToEdge?: boolean;
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
                    paddingTop: edgeToEdge ? 0 : insets.top,
                    paddingBottom: edgeToEdge ? 0 : insets.bottom,
                }}
            >
                {children}
            </View>
        </View>
    );
}

/** The Cadenza note over the name, with an optional line under it. */
export function Wordmark({ tagline }: { tagline?: string }) {
    return (
        <View className="items-center gap-2">
            <CadenzaLogo size={96} />
            <Text className="mt-2 text-5xl font-bold tracking-tight">
                cadenza
            </Text>
            {tagline ? (
                <Text className="text-center text-base text-muted-foreground">
                    {tagline}
                </Text>
            ) : null}
        </View>
    );
}
