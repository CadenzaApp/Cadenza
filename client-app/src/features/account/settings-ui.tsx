import Ionicons from "@expo/vector-icons/Ionicons";
import { Children, Fragment, type ReactNode } from "react";
import {
    Pressable,
    ScrollView,
    StyleSheet,
    View,
    type ColorValue,
    type PressableProps,
} from "react-native";

import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassLayer, GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { IoniconName } from "@/components/ui/ionicon-name";

export type { IoniconName };

// Every Pressable here takes its layout and pressed state from `className`
// (`active:opacity-60`). A `style` function on a Pressable loses its layout
// under nativewind.

/**
 * Every settings screen: a `DetailScreen` sheet with a padded scroll body.
 * `overlay` renders outside the scroll, for dialogs.
 */
export function SettingsSheet({
    title,
    overlay,
    className,
    children,
}: {
    title: string;
    overlay?: ReactNode;
    /** Classes for the scroll content, like a wider `gap-5`. */
    className?: string;
    children: ReactNode;
}) {
    const insets = useSafeAreaInsets();

    return (
        <DetailScreen presentation="sheet" title={title}>
            <ScrollView
                className="flex-1"
                contentContainerClassName={cn("gap-4 px-5 pt-2", className)}
                contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                }}
                showsVerticalScrollIndicator={false}
            >
                {children}
            </ScrollView>
            {overlay}
        </DetailScreen>
    );
}

/** The line a settings screen shows when a save fails. */
export function SaveError({ error }: { error: unknown }) {
    if (!error) return null;
    return (
        <Text className="px-2 text-sm text-destructive">
            Could not save that change. Please try again.
        </Text>
    );
}

/** A rounded glass card. Every block on the settings sheets sits on one. */
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
            {/* the glass is a sibling layer, so tell the children they sit on
                it. pills and toggles then skip the tint the panel already has */}
            <GlassLayer>{children}</GlassLayer>
        </View>
    );
}

/** A glyph in the accent color, with no backing. */
export function SettingsIcon({
    name,
    color,
    size = 26,
}: {
    name: IoniconName;
    /** Defaults to the accent. */
    color?: ColorValue;
    size?: number;
}) {
    const { brand } = useAppTheme().colors;
    return <Ionicons name={name} size={size} color={color ?? brand} />;
}

export type StatusTone = "good" | "warn" | "bad" | "idle";

/** A small colored dot beside a status label. */
export function StatusDot({ tone }: { tone: StatusTone }) {
    return (
        <View
            className={cn(
                "h-2.5 w-2.5 rounded-full",
                tone === "good" && "bg-success",
                tone === "warn" && "bg-orange-500",
                tone === "bad" && "bg-destructive",
                tone === "idle" && "bg-muted-foreground",
            )}
        />
    );
}

export function SettingsChevron() {
    const { colors } = useAppTheme();
    return (
        <Ionicons
            name="chevron-forward"
            size={20}
            color={colors.mutedForeground}
        />
    );
}

type SettingsRowProps = Omit<PressableProps, "children" | "style"> & {
    icon?: IoniconName;
    /** Icon color. Defaults to the accent. */
    iconColor?: ColorValue;
    title: string;
    description?: string;
    destructive?: boolean;
    trailing?: ReactNode;
    /** A trailing chevron, for a row that opens something. */
    chevron?: boolean;
};

/** One row of a settings list: icon, title and description, trailing control. */
export function SettingsRow({
    icon,
    iconColor,
    title,
    description,
    destructive = false,
    trailing,
    chevron = false,
    disabled,
    onPress,
    ...props
}: SettingsRowProps) {
    const { colors } = useAppTheme();
    const content = (
        <View className="flex-row items-center gap-4 px-4 py-4">
            {icon ? (
                <View className="w-7 items-center">
                    <SettingsIcon
                        name={icon}
                        color={destructive ? colors.destructive : iconColor}
                    />
                </View>
            ) : null}
            <View className="flex-1 gap-0.5">
                <Text
                    className={cn(
                        "text-base font-semibold",
                        destructive && "text-destructive",
                    )}
                >
                    {title}
                </Text>
                {description ? (
                    <Text className="text-sm leading-5 text-muted-foreground">
                        {description}
                    </Text>
                ) : null}
            </View>
            {trailing}
            {chevron ? <SettingsChevron /> : null}
        </View>
    );

    if (!onPress) return content;

    return (
        <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onPress}
            className={cn("active:opacity-60", disabled && "opacity-50")}
            {...props}
        >
            {content}
        </Pressable>
    );
}

/** Rows on one panel with a hairline between each. */
export function SettingsGroup({ children }: { children: ReactNode }) {
    const rows = Children.toArray(children);
    return (
        <GlassSettingsPanel>
            {rows.map((row, index) => (
                <Fragment key={index}>
                    {index > 0 ? (
                        <View className="mx-4 h-px bg-border" />
                    ) : null}
                    {row}
                </Fragment>
            ))}
        </GlassSettingsPanel>
    );
}

/**
 * Half of a two-up row on the account sheet: an icon, a title that may wrap,
 * a subtitle, and a chevron, the whole card pressable. Both halves take the
 * same width whatever their text.
 */
export function SettingsTile({
    icon,
    title,
    subtitle,
    onPress,
    accessibilityLabel,
}: {
    icon: IoniconName;
    title: string;
    subtitle?: string;
    onPress: () => void;
    accessibilityLabel?: string;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? title}
            onPress={onPress}
            className="flex-1 active:opacity-60"
        >
            <GlassSettingsPanel className="flex-1">
                <View className="min-h-36 flex-1 justify-between gap-3 p-4">
                    <View className="flex-row items-start justify-between">
                        <SettingsIcon name={icon} size={28} />
                        <SettingsChevron />
                    </View>
                    <View className="gap-0.5">
                        <Text className="text-base font-semibold leading-5">
                            {title}
                        </Text>
                        {subtitle ? (
                            <Text
                                className="text-sm text-muted-foreground"
                                numberOfLines={2}
                            >
                                {subtitle}
                            </Text>
                        ) : null}
                    </View>
                </View>
            </GlassSettingsPanel>
        </Pressable>
    );
}
