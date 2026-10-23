import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";

import { GlassPanel } from "@/components/ui/glass-panel";
import type { IoniconName } from "@/components/ui/ionicon-name";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";

export type SegmentOption<T extends string> = {
    value: T;
    label: string;
    icon?: IoniconName;
};

/**
 * A row of equal options on a glass panel, one picked, filled with the
 * accent. A radio group to screen readers.
 */
export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
}: {
    options: readonly SegmentOption<T>[];
    value: T;
    onChange: (value: T) => void;
}) {
    return (
        <GlassPanel>
            <View accessibilityRole="radiogroup" className="flex-row gap-2 p-2">
                {options.map((option) => (
                    <Segment
                        key={option.value}
                        label={option.label}
                        icon={option.icon}
                        selected={option.value === value}
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
 */
function Segment({
    label,
    icon,
    selected,
    onPress,
}: {
    label: string;
    icon?: IoniconName;
    selected: boolean;
    onPress: () => void;
}) {
    const { colors } = useAppTheme();
    const contentColor = selected ? colors.brandForeground : colors.foreground;

    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected }}
            onPress={onPress}
            className="flex-1 active:opacity-60"
        >
            <View
                className="h-16 items-center justify-center gap-1 rounded-2xl"
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
                >
                    {label}
                </Text>
            </View>
        </Pressable>
    );
}
