import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import type { ComponentProps, ReactNode } from "react";
import {
    Pressable,
    StyleSheet,
    View,
    type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";

export const PLAYER_BAR_HEIGHT = 72;
export const PLAYER_BAR_RADIUS = PLAYER_BAR_HEIGHT / 2;
/** Was 76%; the selector reads better with more room for three labels. */
const PLAYER_BAR_WIDTH_PERCENT = 91;

/**
 * The glass bar at the bottom of the now playing sheet: the page tabs, or in
 * a live session the session's buttons.
 */
export function PlayerBarShell({
    children,
    onLayout,
}: {
    children: ReactNode;
    onLayout?: (event: LayoutChangeEvent) => void;
}) {
    const insets = useSafeAreaInsets();
    return (
        <View
            className="items-center px-4 pt-2"
            style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
            <View
                className="relative flex-row overflow-hidden border border-border"
                style={{
                    width: `${PLAYER_BAR_WIDTH_PERCENT}%`,
                    height: PLAYER_BAR_HEIGHT,
                    borderRadius: PLAYER_BAR_RADIUS,
                    borderCurve: "continuous",
                }}
                onLayout={onLayout}
            >
                {/* The glass carries its own radius rather than leaning on
                the parent's clip. Native glass shapes its lensing and its
                specular edge from its own corners, so a clipped square reads
                as a flat fill instead of glass. Keep it off the touch path;
                the native view ignores `pointerEvents` and swallows the
                presses. */}
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                borderRadius: PLAYER_BAR_RADIUS - 1,
                                borderCurve: "continuous",
                            },
                        ]}
                    />
                </View>
                {children}
            </View>
        </View>
    );
}

/** One icon and label in the bar. */
export function PlayerBarButton({
    icon,
    label,
    accessibilityLabel,
    role = "button",
    selected,
    badge,
    onPress,
}: {
    icon: ComponentProps<typeof Ionicons>["name"];
    label: string;
    accessibilityLabel?: string;
    role?: "button" | "tab";
    selected?: boolean;
    /** A count shown on the icon, hidden at 0. */
    badge?: number;
    onPress: () => void;
}) {
    const { colors } = useTheme();
    return (
        <Pressable
            accessibilityRole={role}
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={
                selected === undefined ? undefined : { selected }
            }
            onPress={onPress}
            className="flex-1 items-center justify-center active:opacity-70"
        >
            <View>
                <Ionicons name={icon} size={26} color={colors.text} />
                {badge ? (
                    <View className="absolute -right-2.5 -top-1 h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1">
                        <Text className="text-[10px] font-bold text-white">
                            {badge}
                        </Text>
                    </View>
                ) : null}
            </View>
            <Text className="mt-0.5 text-xs font-medium">{label}</Text>
        </Pressable>
    );
}
