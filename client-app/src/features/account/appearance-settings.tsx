import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailScreen } from "@/components/ui/detail-screen";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";

import { GlassSettingsPanel, TodoBadge } from "./settings-ui";

type AppearanceColorRole =
    | "accent"
    | "background"
    | "surface"
    | "text"
    | "glassTint";

type ColorOption = {
    name: string;
    value: string | null;
};

const COLOR_OPTIONS: ColorOption[] = [
    { name: "System", value: null },
    { name: "Black", value: "#0a0a0a" },
    { name: "White", value: "#fafafa" },
    { name: "Red", value: "#e84c4f" },
    { name: "Orange", value: "#e88734" },
    { name: "Yellow", value: "#e0b52e" },
    { name: "Green", value: "#37a866" },
    { name: "Teal", value: "#2cb8ae" },
    { name: "Blue", value: "#3a81f6" },
    { name: "Indigo", value: "#5865d8" },
    { name: "Purple", value: "#9b51e0" },
    { name: "Pink", value: "#d64f9d" },
];

const ROLE_LABELS: Record<AppearanceColorRole, string> = {
    accent: "Accent",
    background: "Background",
    surface: "Surface",
    text: "Text",
    glassTint: "Liquid Glass Tint",
};

const ROLE_ORDER: AppearanceColorRole[] = [
    "accent",
    "background",
    "surface",
    "text",
    "glassTint",
];

type AppearanceSelection = Record<AppearanceColorRole, string | null>;

const EMPTY_SELECTION: AppearanceSelection = {
    accent: null,
    background: null,
    surface: null,
    text: null,
    glassTint: null,
};

export function AppearanceSettingsScreen() {
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const { account } = useAccount();
    const [selection, setSelection] =
        useState<AppearanceSelection>(EMPTY_SELECTION);

    if (!account) {
        return <Redirect href="/auth?initialMode=signin" />;
    }

    const resolved = {
        accent: selection.accent ?? String(colors.notification),
        background: selection.background ?? String(colors.background),
        surface: selection.surface ?? String(colors.card),
        text: selection.text ?? String(colors.text),
        glassTint: selection.glassTint,
    };

    function selectColor(role: AppearanceColorRole, value: string | null) {
        setSelection((current) => ({ ...current, [role]: value }));
    }

    return (
        <DetailScreen presentation="sheet" title="Appearance">
            <ScrollView
                className="flex-1"
                contentContainerClassName="gap-4 px-5 pt-3"
                contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                }}
                showsVerticalScrollIndicator={false}
            >
                <View className="flex-row items-center gap-2 px-1">
                    <TodoBadge />
                    <Text className="flex-1 text-sm text-muted-foreground">
                        Preview only. Changes are not saved or applied yet.
                    </Text>
                </View>

                <AppearancePreview colors={resolved} />

                <GlassSettingsPanel className="gap-0 py-1">
                    {ROLE_ORDER.map((role, index) => (
                        <View
                            key={role}
                            className={
                                index === 0
                                    ? undefined
                                    : "border-t border-border"
                            }
                        >
                            <View className="gap-3 px-5 py-4">
                                <View className="flex-row items-center justify-between">
                                    <Text className="font-semibold">
                                        {ROLE_LABELS[role]}
                                    </Text>
                                    <SelectedColor
                                        value={selection[role]}
                                        fallback={resolved[role]}
                                    />
                                </View>
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerClassName="gap-3 pr-5"
                                >
                                    {COLOR_OPTIONS.map((option) => (
                                        <ColorChoice
                                            key={option.name}
                                            option={option}
                                            selected={
                                                selection[role] === option.value
                                            }
                                            onPress={() =>
                                                selectColor(role, option.value)
                                            }
                                            roleLabel={ROLE_LABELS[role]}
                                        />
                                    ))}
                                </ScrollView>
                            </View>
                        </View>
                    ))}
                </GlassSettingsPanel>
            </ScrollView>
        </DetailScreen>
    );
}

function AppearancePreview({
    colors,
}: {
    colors: {
        accent: string;
        background: string;
        surface: string;
        text: string;
        glassTint: string | null;
    };
}) {
    return (
        <View
            className="overflow-hidden rounded-3xl border border-border p-5"
            style={{ backgroundColor: colors.background }}
        >
            <View
                className="gap-4 rounded-2xl p-4"
                style={{ backgroundColor: colors.surface }}
            >
                <View className="flex-row items-center justify-between">
                    <View className="gap-1">
                        <Text
                            className="text-lg font-semibold"
                            style={{ color: colors.text }}
                        >
                            Cadenza
                        </Text>
                        <Text style={{ color: colors.text, opacity: 0.65 }}>
                            Appearance preview
                        </Text>
                    </View>
                    <View
                        className="h-10 w-10 items-center justify-center rounded-full"
                        style={{ backgroundColor: colors.accent }}
                    >
                        <Ionicons
                            name="musical-note"
                            size={20}
                            color="#ffffff"
                        />
                    </View>
                </View>

                <View className="h-12 overflow-hidden rounded-2xl border border-border">
                    <GlassSurface
                        variant="regular"
                        tintColor={colors.glassTint ?? undefined}
                        style={StyleSheet.absoluteFill}
                    />
                    <View className="flex-1 flex-row items-center justify-center gap-2">
                        <Ionicons
                            name="sparkles"
                            size={18}
                            color={colors.text}
                        />
                        <Text
                            className="font-semibold"
                            style={{ color: colors.text }}
                        >
                            Liquid Glass
                        </Text>
                    </View>
                </View>
            </View>
        </View>
    );
}

function SelectedColor({
    value,
    fallback,
}: {
    value: string | null;
    fallback: string | null;
}) {
    return (
        <View className="flex-row items-center gap-2">
            <Text className="text-sm text-muted-foreground">
                {value == null ? "System" : value.toUpperCase()}
            </Text>
            <View
                className="h-5 w-5 rounded-full border border-border"
                style={{ backgroundColor: fallback ?? "transparent" }}
            />
        </View>
    );
}

function ColorChoice({
    option,
    selected,
    onPress,
    roleLabel,
}: {
    option: ColorOption;
    selected: boolean;
    onPress: () => void;
    roleLabel: string;
}) {
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={`${roleLabel}: ${option.name}`}
            accessibilityState={{ selected }}
            onPress={onPress}
            hitSlop={4}
            className="items-center gap-1 active:opacity-60"
        >
            <View
                className={`h-9 w-9 items-center justify-center overflow-hidden rounded-full border ${selected ? "border-foreground" : "border-border"}`}
                style={{
                    borderWidth: selected ? 3 : 1,
                    backgroundColor: option.value ?? undefined,
                }}
            >
                {option.value == null ? (
                    <View className="h-full w-full overflow-hidden rounded-full">
                        <View className="h-1/2 bg-white" />
                        <View className="h-1/2 bg-black" />
                    </View>
                ) : null}
            </View>
            <Text className="text-[10px] text-muted-foreground">
                {option.name}
            </Text>
        </Pressable>
    );
}
