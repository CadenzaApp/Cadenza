import Ionicons from "@expo/vector-icons/Ionicons";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    View,
    type PressableProps,
} from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { IoniconName } from "@/components/ui/ionicon-name";

export type GlassPillProps = Omit<PressableProps, "children" | "style"> & {
    label: string;
    icon?: IoniconName;
    /** A trailing chevron, for a pill that opens something. */
    chevron?: boolean;
    /** Swaps the icon for a spinner. */
    loading?: boolean;
    destructive?: boolean;
    size?: "sm" | "md";
};

/** A small rounded glass button with an optional icon. */
export function GlassPill({
    label,
    icon,
    chevron = false,
    loading = false,
    destructive = false,
    size = "sm",
    disabled,
    ...props
}: GlassPillProps) {
    const { colors } = useAppTheme();
    const contentColor = destructive ? colors.destructive : colors.foreground;
    const iconSize = size === "sm" ? 16 : 19;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: Boolean(disabled), busy: loading }}
            disabled={disabled || loading}
            hitSlop={6}
            className="active:opacity-60"
            {...props}
        >
            <View
                className={cn(
                    "flex-row items-center justify-center gap-2 overflow-hidden rounded-full border border-border",
                    size === "sm" ? "h-9 px-3.5" : "h-12 px-5",
                )}
            >
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        variant="regular"
                        style={StyleSheet.absoluteFill}
                    />
                </View>
                <View
                    className={cn(
                        "flex-row items-center gap-2",
                        disabled && "opacity-40",
                    )}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color={contentColor} />
                    ) : icon ? (
                        <Ionicons
                            name={icon}
                            size={iconSize}
                            color={contentColor}
                        />
                    ) : null}
                    <Text
                        className={cn(
                            "font-semibold",
                            size === "sm" ? "text-sm" : "text-base",
                            destructive && "text-destructive",
                        )}
                    >
                        {label}
                    </Text>
                    {chevron ? (
                        <Ionicons
                            name="chevron-forward"
                            size={iconSize}
                            color={contentColor}
                        />
                    ) : null}
                </View>
            </View>
        </Pressable>
    );
}
