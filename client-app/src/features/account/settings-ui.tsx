import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import type { ReactNode } from "react";
import {
    Pressable,
    StyleSheet,
    View,
    type ColorValue,
    type PressableProps,
} from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

type IoniconName = keyof typeof Ionicons.glyphMap;

export function GlassSettingsPanel({
    children,
    className,
    tintColor,
}: {
    children: ReactNode;
    className?: string;
    tintColor?: ColorValue;
}) {
    return (
        <View
            className={cn(
                "overflow-hidden rounded-3xl border border-border",
                className,
            )}
        >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface
                    variant="regular"
                    tintColor={tintColor}
                    style={StyleSheet.absoluteFill}
                />
            </View>
            {children}
        </View>
    );
}

export function SettingsIcon({
    name,
    color,
}: {
    name: IoniconName;
    color?: ColorValue;
}) {
    const { colors } = useTheme();

    return (
        <View className="h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-border">
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface variant="clear" style={StyleSheet.absoluteFill} />
            </View>
            <Ionicons name={name} size={22} color={color ?? colors.text} />
        </View>
    );
}

export function TodoBadge() {
    return (
        <View className="overflow-hidden rounded-full border border-border px-2 py-0.5">
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface variant="clear" style={StyleSheet.absoluteFill} />
            </View>
            <Text className="text-[10px] font-semibold tracking-wider text-muted-foreground">
                TODO
            </Text>
        </View>
    );
}

type SettingsRowProps = Omit<PressableProps, "children" | "style"> & {
    icon: IoniconName;
    title: string;
    description?: string;
    todo?: boolean;
    trailing?: ReactNode;
};

export function SettingsRow({
    icon,
    title,
    description,
    todo = false,
    trailing,
    disabled,
    onPress,
    ...props
}: SettingsRowProps) {
    const content = (
        <View className="flex-row items-center gap-3 px-4 py-4">
            <SettingsIcon name={icon} />
            <View className="flex-1 gap-1">
                <View className="flex-row items-center gap-2">
                    <Text className="text-base font-semibold">{title}</Text>
                    {todo ? <TodoBadge /> : null}
                </View>
                {description ? (
                    <Text className="text-sm leading-5 text-muted-foreground">
                        {description}
                    </Text>
                ) : null}
            </View>
            {trailing}
        </View>
    );

    if (!onPress) return content;

    return (
        <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                pressed && styles.pressed,
                disabled && styles.disabled,
            ]}
            {...props}
        >
            {content}
        </Pressable>
    );
}

export function GlassToggle({
    value,
    onValueChange,
    accessibilityLabel,
}: {
    value: boolean;
    onValueChange: (value: boolean) => void;
    accessibilityLabel: string;
}) {
    const { colors } = useTheme();

    return (
        <Pressable
            accessibilityRole="switch"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ checked: value }}
            onPress={() => onValueChange(!value)}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}
        >
            <View
                className="overflow-hidden border border-border"
                style={{ width: 52, height: 32, borderRadius: 16 }}
            >
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        variant="regular"
                        tintColor={value ? colors.notification : undefined}
                        style={StyleSheet.absoluteFill}
                    />
                </View>
                <View
                    className="absolute top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow-sm"
                    style={{ left: value ? 22 : 2 }}
                />
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    disabled: { opacity: 0.55 },
    pressed: { opacity: 0.65 },
});
