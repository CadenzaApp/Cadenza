import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Ionicons from "@expo/vector-icons/Ionicons";

import { GlassIconButton } from "@/components/ui/glass-icon-button";

/** Gap between the safe area and the button. */
const TOP_GAP = 8;

/** The size of the corner buttons over a collection's hero. */
export const HERO_BUTTON_SIZE = 52;

/**
 * A glass button floating in a top corner of a screen that draws its own
 * hero, `left` where a native header puts its back button, `right` opposite
 * it.
 */
export function FloatingTopButton({
    side,
    size,
    children,
    ...props
}: Omit<ComponentProps<typeof GlassIconButton>, "bordered"> & {
    side: "left" | "right";
    children: ReactNode;
}) {
    const insets = useSafeAreaInsets();

    return (
        <View
            className={side === "left" ? "absolute left-5" : "absolute right-5"}
            style={{ top: insets.top + TOP_GAP }}
            pointerEvents="box-none"
        >
            <GlassIconButton size={size} bordered={false} {...props}>
                {children}
            </GlassIconButton>
        </View>
    );
}

/**
 * The back button a pushed screen that draws its own hero floats in the top
 * left, where a native header puts its own.
 */
export function FloatingBackButton({
    label = "Back",
    size,
}: {
    label?: string;
    size?: number;
}) {
    const router = useRouter();
    const { colors } = useTheme();

    return (
        <FloatingTopButton
            side="left"
            size={size}
            accessibilityLabel={label}
            onPress={() => router.back()}
        >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
        </FloatingTopButton>
    );
}
