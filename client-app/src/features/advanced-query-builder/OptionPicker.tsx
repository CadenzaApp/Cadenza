import { useState } from "react";
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    View,
    useWindowDimensions,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";

import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];

export type PickerOption = {
    key: string;
    label: string;
    icon?: IconName;
    /** Defaults to the theme's text color. */
    iconColor?: string;
};

export type PickerSection = {
    title?: string;
    options: PickerOption[];
};

type Props = {
    visible: boolean;
    title: string;
    sections: PickerSection[];
    selectedKey?: string | null;
    /** Shows a filter box above the options. */
    searchable?: boolean;
    emptyText?: string;
    onSelect: (key: string) => void;
    onClose: () => void;
};

// Sized for a phone: nearly full width, tall rows that are easy to hit.
const SCREEN_MARGIN = 12;
const MAX_WIDTH = 520;
const MAX_HEIGHT_RATIO = 0.8;
const ROW_MIN_HEIGHT = 56;
const ROW_ICON_SIZE = 24;

/**
 * A popup list of choices, optionally grouped and searchable. The list
 * scrolls vertically when it is taller than the popup, and long labels wrap
 * rather than running off the side.
 *
 * Uses its own `Modal` instead of `ModalPopup` so the sizing here only
 * affects the advanced query builder.
 */
export function OptionPicker({
    visible,
    title,
    sections,
    selectedKey,
    searchable,
    emptyText = "Nothing to choose from",
    onSelect,
    onClose,
}: Props) {
    const { colors } = useTheme();
    const window = useWindowDimensions();
    const [search, setSearch] = useState("");

    const width = Math.min(window.width - SCREEN_MARGIN * 2, MAX_WIDTH);
    const maxHeight = window.height * MAX_HEIGHT_RATIO;

    const needle = search.trim().toLowerCase();
    const visibleSections = sections
        .map((section) => ({
            ...section,
            options: section.options.filter((option) =>
                option.label.toLowerCase().includes(needle),
            ),
        }))
        .filter((section) => section.options.length > 0);

    function close() {
        setSearch("");
        onClose();
    }

    function select(key: string) {
        setSearch("");
        onSelect(key);
    }

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={close}
        >
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                className="flex-1"
            >
                <Pressable
                    className="flex-1 items-center justify-center bg-black/70"
                    onPress={close}
                >
                    <Pressable
                        accessibilityViewIsModal
                        onPress={(event) => event.stopPropagation()}
                        className="rounded-xl border border-border bg-popover px-4 pt-7 pb-2 gap-3"
                        style={{ width, maxHeight }}
                    >
                        <View className="flex-row items-center justify-between gap-3 pb-1">
                            <Text className="flex-1 text-xl font-semibold text-popover-foreground">
                                {title}
                            </Text>
                            <Pressable
                                onPress={close}
                                hitSlop={10}
                                accessibilityRole="button"
                                accessibilityLabel="Close"
                                className="h-10 w-10 items-center justify-center rounded-full active:bg-accent"
                            >
                                <Ionicons
                                    name="close"
                                    size={26}
                                    color={colors.text}
                                />
                            </Pressable>
                        </View>

                        {searchable && (
                            <Input
                                value={search}
                                onChangeText={setSearch}
                                placeholder="Search"
                                autoCorrect={false}
                                autoCapitalize="none"
                                className="h-12 text-lg"
                            />
                        )}

                        <ScrollView
                            style={{ flexGrow: 0 }}
                            contentContainerStyle={{ paddingBottom: 8 }}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator
                        >
                            {visibleSections.length === 0 && (
                                <Text className="py-4 text-lg text-muted-foreground">
                                    {emptyText}
                                </Text>
                            )}

                            {visibleSections.map((section, sectionIndex) => (
                                <View
                                    key={section.title ?? sectionIndex}
                                    className="pb-2"
                                >
                                    {section.title && (
                                        <Text className="pt-3 pb-1.5 text-sm font-semibold uppercase text-muted-foreground">
                                            {section.title}
                                        </Text>
                                    )}
                                    {section.options.map((option) => {
                                        const selected =
                                            option.key === selectedKey;
                                        return (
                                            <Pressable
                                                key={option.key}
                                                onPress={() =>
                                                    select(option.key)
                                                }
                                                accessibilityRole="button"
                                                accessibilityState={{
                                                    selected,
                                                }}
                                                className={cn(
                                                    "flex-row items-center gap-4 rounded-lg px-3 py-3.5 active:bg-accent",
                                                    selected && "bg-accent",
                                                )}
                                                style={{
                                                    minHeight: ROW_MIN_HEIGHT,
                                                }}
                                            >
                                                {option.icon && (
                                                    <Ionicons
                                                        name={option.icon}
                                                        size={ROW_ICON_SIZE}
                                                        color={
                                                            option.iconColor ??
                                                            colors.text
                                                        }
                                                    />
                                                )}
                                                <Text className="flex-1 shrink text-lg">
                                                    {option.label}
                                                </Text>
                                                {selected && (
                                                    <Ionicons
                                                        name="checkmark"
                                                        size={ROW_ICON_SIZE}
                                                        color={colors.text}
                                                    />
                                                )}
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            ))}
                        </ScrollView>
                    </Pressable>
                </Pressable>
            </KeyboardAvoidingView>
        </Modal>
    );
}
