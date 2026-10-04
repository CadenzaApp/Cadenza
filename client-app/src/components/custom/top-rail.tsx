import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import type { ReactNode } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useFloatingRail } from "@/lib/top-rail";
import { cn } from "@/lib/utils";

import { getAccountInitials } from "./account-initials";

type Props = {
    title: string;
    onBack?: () => void;
    /** Screen-specific controls, placed left of the account button. */
    actions?: ReactNode;
    /**
     * The route the rail sits over. Decides whether it floats or is pinned,
     * and lets a floating one follow its screen's scroller. See
     * `@/lib/top-rail`.
     */
    route?: { key: string; name: string };
};

/** How far a floating rail drifts as it fades, kept small on purpose. */
const DRIFT = 8;

/**
 * A tab's header: the title, any screen actions, and the account button.
 *
 * Floating, it sits over the page with no background of its own, in the room
 * the page's scroller keeps clear for it, and fades in and out with a small
 * drift. Hidden, it is moved off screen so it cannot catch taps meant for the
 * page under it. Pinned, it is a plain bar above the screen.
 */
export function TopRail({ title, onBack, actions, route }: Props) {
    const router = useRouter();
    const { colors } = useTheme();
    const { account } = useAccount();
    const insets = useSafeAreaInsets();
    const floating = useFloatingRail(route);
    const progress = floating?.reveal.progress;
    const height = floating?.height ?? 0;

    const fadeStyle = useAnimatedStyle(() => {
        if (!progress) return {};
        const shown = progress.get();
        return {
            opacity: shown,
            transform: [
                {
                    translateY:
                        shown < 0.01 ? -height - DRIFT : (shown - 1) * DRIFT,
                },
            ],
        };
    });

    return (
        <Animated.View
            className={cn(
                floating
                    ? "absolute left-0 right-0 top-0"
                    : "border-b border-border bg-background",
            )}
            style={[{ paddingTop: insets.top }, fadeStyle]}
            // the page's inset follows the rail as drawn, not a sum of parts
            onLayout={
                floating
                    ? (event) =>
                          floating.onMeasure(event.nativeEvent.layout.height)
                    : undefined
            }
        >
            <View className="h-14 flex-row items-center justify-between px-5">
                {onBack ? (
                    <GlassIconButton accessibilityLabel="Back" onPress={onBack}>
                        <Ionicons
                            name="chevron-back"
                            size={22}
                            color={colors.text}
                        />
                    </GlassIconButton>
                ) : null}
                <Text
                    className={cn(
                        "flex-1 text-3xl font-bold tracking-tight",
                        onBack && "ml-3",
                    )}
                    numberOfLines={1}
                >
                    {title}
                </Text>

                <View className="flex-row items-center gap-2">
                    {actions}
                    <GlassIconButton
                        accessibilityLabel="Open account"
                        onPress={() => router.push("/account")}
                    >
                        <Text className="text-sm font-semibold">
                            {getAccountInitials(account?.email)}
                        </Text>
                    </GlassIconButton>
                </View>
            </View>
        </Animated.View>
    );
}
