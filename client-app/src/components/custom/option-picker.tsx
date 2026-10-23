import { useState } from "react";
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
    useWindowDimensions,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";
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
    /**
     * Hears every change to the search text, for a section the caller looks up
     * itself, like suggested tags. Its options are still filtered here too.
     */
    onSearchChange?: (search: string) => void;
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
const SEARCH_ICON_SIZE = 18;
/** Space between the top edge of the popup and its title row. */
const HEADER_TOP_SPACE = 8;

/**
 * A popup list of choices, optionally grouped and searchable. The list
 * scrolls vertically when it is taller than the popup, and long labels wrap
 * rather than running off the side. A titled section collapses from its
 * header, and every section opens while a search is typed so no match hides.
 *
 * Uses its own `Modal` instead of `ModalPopup` so the sizing suits a long,
 * searchable list. The advanced query builder picks tags, operators and values
 * with it, and a song list picks what to sort and group by.
 */
export function OptionPicker({
    visible,
    title,
    sections,
    selectedKey,
    searchable,
    onSearchChange,
    emptyText = "Nothing to choose from",
    onSelect,
    onClose,
}: Props) {
    const { colors } = useTheme();
    const { colors: palette } = useAppTheme();
    const window = useWindowDimensions();
    const [search, setSearch] = useState("");
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
        () => new Set(),
    );

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
    const searching = needle.length > 0;

    function toggleSection(title: string) {
        setCollapsed((current) => {
            const next = new Set(current);
            if (!next.delete(title)) next.add(title);
            return next;
        });
    }

    function changeSearch(next: string) {
        setSearch(next);
        onSearchChange?.(next);
    }

    function close() {
        changeSearch("");
        onClose();
    }

    function select(key: string) {
        changeSearch("");
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
                        className="overflow-hidden rounded-xl border border-border px-4 pb-2 gap-3"
                        // explicit, so the title always clears the top edge
                        style={{
                            width,
                            maxHeight,
                            paddingTop: HEADER_TOP_SPACE,
                        }}
                    >
                        <View
                            pointerEvents="none"
                            style={StyleSheet.absoluteFill}
                        >
                            <GlassSurface
                                variant="regular"
                                style={StyleSheet.absoluteFill}
                            />
                        </View>
                        <View
                            className="flex-row items-center justify-between gap-3"
                            style={{ paddingTop: 8, paddingBottom: 8 }}
                        >
                            <Text className="flex-1 text-xl font-bold text-popover-foreground">
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
                            <View className="relative justify-center">
                                <Input
                                    value={search}
                                    onChangeText={changeSearch}
                                    placeholder="Search"
                                    autoCorrect={false}
                                    autoCapitalize="none"
                                    className="h-12 pl-10 text-sm"
                                />
                                <View
                                    pointerEvents="none"
                                    className="absolute left-3"
                                >
                                    <Ionicons
                                        name="search"
                                        size={SEARCH_ICON_SIZE}
                                        color={palette.mutedForeground}
                                    />
                                </View>
                            </View>
                        )}

                        <ScrollView
                            style={{ flexGrow: 0 }}
                            contentContainerStyle={{ paddingBottom: 8 }}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator
                        >
                            {visibleSections.length === 0 && (
                                <Text className="py-4 text-sm text-muted-foreground">
                                    {emptyText}
                                </Text>
                            )}

                            {visibleSections.map((section, sectionIndex) => {
                                const title = section.title;
                                const open =
                                    !title ||
                                    searching ||
                                    !collapsed.has(title);
                                return (
                                    <View
                                        key={title ?? sectionIndex}
                                        className="pb-2"
                                    >
                                        {title && (
                                            <Pressable
                                                onPress={() =>
                                                    toggleSection(title)
                                                }
                                                disabled={searching}
                                                accessibilityRole="button"
                                                accessibilityState={{
                                                    expanded: open,
                                                }}
                                                className="flex-row items-center justify-between pt-3 pb-1.5 active:opacity-60"
                                            >
                                                <Text className="flex-1 text-sm font-semibold uppercase text-muted-foreground">
                                                    {title}
                                                </Text>
                                                <Ionicons
                                                    name={
                                                        open
                                                            ? "chevron-down"
                                                            : "chevron-forward"
                                                    }
                                                    size={18}
                                                    color={
                                                        palette.mutedForeground
                                                    }
                                                />
                                            </Pressable>
                                        )}
                                        {open &&
                                            section.options.map((option) => {
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
                                                            selected &&
                                                                "bg-accent",
                                                        )}
                                                        style={{
                                                            minHeight:
                                                                ROW_MIN_HEIGHT,
                                                        }}
                                                    >
                                                        {option.icon && (
                                                            <Ionicons
                                                                name={
                                                                    option.icon
                                                                }
                                                                size={
                                                                    ROW_ICON_SIZE
                                                                }
                                                                color={
                                                                    option.iconColor ??
                                                                    colors.text
                                                                }
                                                            />
                                                        )}
                                                        <Text className="flex-1 shrink text-sm">
                                                            {option.label}
                                                        </Text>
                                                        {selected && (
                                                            <Ionicons
                                                                name="checkmark"
                                                                size={
                                                                    ROW_ICON_SIZE
                                                                }
                                                                color={
                                                                    colors.text
                                                                }
                                                            />
                                                        )}
                                                    </Pressable>
                                                );
                                            })}
                                    </View>
                                );
                            })}
                        </ScrollView>
                    </Pressable>
                </Pressable>
            </KeyboardAvoidingView>
        </Modal>
    );
}
