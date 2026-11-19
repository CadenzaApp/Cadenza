import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";

import { GlassPanel } from "@/components/ui/glass-panel";
import type { IoniconName } from "@/components/ui/ionicon-name";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type SegmentOption<T extends string> = {
    value: T;
    label: string;
    icon?: IoniconName;
    /** Shown but not pickable, like a mode this phone cannot do. */
    disabled?: boolean;
};

/**
 * A row of equal options on a glass panel, one picked, filled with the
 * accent. A radio group to screen readers. `sm` is a slim row of labels, for
 * filters and tabs inside a screen; icons are left out at that size.
 */
export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    size = "md",
}: {
    options: readonly SegmentOption<T>[];
    value: T;
    onChange: (value: T) => void;
    size?: "md" | "sm";
}) {
    return (
        <GlassPanel>
            <View
                accessibilityRole="radiogroup"
                className={cn(
                    "flex-row",
                    size === "sm" ? "gap-1 p-1" : "gap-2 p-2",
                )}
            >
                {options.map((option) => (
                    <Segment
                        key={option.value}
                        label={option.label}
                        icon={size === "sm" ? undefined : option.icon}
                        selected={option.value === value}
                        disabled={option.disabled}
                        size={size}
                        onPress={() => onChange(option.value)}
                    />
                ))}
            </View>
        </GlassPanel>
    );
}

/**
 * One option, an equal share of the row. Selection colors are inline styles:
 * toggled classes lagged a step behind when the theme changed under them.
 * The fill clips itself. A background inside the panel's clip paints square
 * unless this view hides its own overflow.
 */
function Segment({
    label,
    icon,
    selected,
    disabled,
    size,
    onPress,
}: {
    label: string;
    icon?: IoniconName;
    selected: boolean;
    disabled?: boolean;
    size: "md" | "sm";
    onPress: () => void;
}) {
    const { colors } = useAppTheme();
    const contentColor = selected ? colors.brandForeground : colors.foreground;

    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={onPress}
            className={cn("flex-1 active:opacity-60", disabled && "opacity-40")}
        >
            <View
                collapsable={false}
                className={cn(
                    "items-center justify-center overflow-hidden",
                    size === "sm" ? "h-9 rounded-xl" : "h-16 gap-1 rounded-2xl",
                )}
                style={{
                    backgroundColor: selected ? colors.brand : "transparent",
                }}
            >
                {icon ? (
                    <Ionicons name={icon} size={20} color={contentColor} />
                ) : null}
                <Text
                    className="text-sm font-semibold"
                    style={{ color: contentColor }}
                    numberOfLines={1}
                >
                    {label}
                </Text>
            </View>
        </Pressable>
    );
}
