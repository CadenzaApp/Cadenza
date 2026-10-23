import { useRef, useState, type ReactNode } from "react";
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    View,
    useWindowDimensions,
    type LayoutChangeEvent,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import Animated, {
    runOnUI,
    scrollTo,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    type SharedValue,
} from "react-native-reanimated";

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
 * How much faster a row fades than it is covered by a stuck header. Above 1,
 * it is gone before the header fully covers it.
 */
const ROW_FADE_STRENGTH = 1.2;

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
    const scrollRef = useAnimatedRef<Animated.ScrollView>();
    // where each section's header sits in the list, by title
    const headerTops = useRef(new Map<string, number>());
    const scrollY = useSharedValue(0);
    const headerHeight = useSharedValue(0);
    const onScroll = useAnimatedScrollHandler((event) => {
        scrollY.set(event.contentOffset.y);
    });

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
        // Closing the section whose header is stuck: put that header back at
        // the top first, so the next section lands right under it instead of
        // the list keeping an offset into rows that are about to go.
        const top = headerTops.current.get(title);
        if (!collapsed.has(title) && top !== undefined && scrollY.get() > top) {
            runOnUI(() => scrollTo(scrollRef, 0, top, false))();
        }
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

    // Headers are direct children of the scroll view so each can stick to its
    // top while its section scrolls under it.
    const list: { children: ReactNode[]; headerIndices: number[] } = {
        children: [],
        headerIndices: [],
    };
    if (visibleSections.length === 0) {
        list.children.push(
            <Text key="empty" className="py-4 text-sm text-muted-foreground">
                {emptyText}
            </Text>,
        );
    }
    visibleSections.forEach((section, sectionIndex) => {
        const title = section.title;
        const open = !title || searching || !collapsed.has(title);
        if (title) {
            // a closed section has nothing to scroll under its header
            if (open) list.headerIndices.push(list.children.length);
            list.children.push(
                <SectionHeader
                    key={`header-${title}`}
                    title={title}
                    open={open}
                    disabled={searching}
                    onToggle={() => toggleSection(title)}
                    onLayout={(event) => {
                        const { y, height } = event.nativeEvent.layout;
                        headerTops.current.set(title, y);
                        headerHeight.set(height);
                    }}
                />,
            );
        }
        list.children.push(
            <SectionBody
                key={`options-${title ?? sectionIndex}`}
                options={open ? section.options : []}
                selectedKey={selectedKey}
                onSelect={select}
                fade={title ? { scrollY, headerHeight } : null}
            />,
        );
    });

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

                        <Animated.ScrollView
                            ref={scrollRef}
                            onScroll={onScroll}
                            scrollEventThrottle={16}
                            style={{ flexGrow: 0 }}
                            contentContainerStyle={{ paddingBottom: 8 }}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                            stickyHeaderIndices={list.headerIndices}
                        >
                            {list.children}
                        </Animated.ScrollView>
                    </Pressable>
                </Pressable>
            </KeyboardAvoidingView>
        </Modal>
    );
}

/** A section's title, which collapses or opens the section. */
function SectionHeader({
    title,
    open,
    disabled,
    onToggle,
    onLayout,
}: {
    title: string;
    open: boolean;
    disabled: boolean;
    onToggle: () => void;
    /**
     * Passed through as the header's own `onLayout`. A sticky header's wrapper
     * strips it from the header and calls it with the wrapper's layout, so it
     * must stay a plain prop that the wrapper can find.
     */
    onLayout: (event: LayoutChangeEvent) => void;
}) {
    const { colors: palette } = useAppTheme();
    return (
        <Pressable
            onPress={onToggle}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onLayout={onLayout}
            className="flex-row items-center justify-between py-1.5 active:opacity-60"
        >
            <Text className="flex-1 text-sm font-semibold uppercase text-muted-foreground">
                {title}
            </Text>
            <Ionicons
                name={open ? "chevron-down" : "chevron-forward"}
                size={18}
                color={palette.mutedForeground}
            />
        </Pressable>
    );
}

/** What a titled section's rows fade against as they pass under its header. */
type RowFade = {
    scrollY: SharedValue<number>;
    headerHeight: SharedValue<number>;
};

/** Where a section's rows sit in the list, for fading them. */
type SectionBounds = RowFade & {
    top: SharedValue<number>;
    bottom: SharedValue<number>;
};

/**
 * A section's rows. Under a titled section they fade as they slide beneath its
 * stuck header, since the header has no fill to hide them.
 */
function SectionBody({
    options,
    selectedKey,
    onSelect,
    fade,
}: {
    options: PickerOption[];
    selectedKey?: string | null;
    onSelect: (key: string) => void;
    fade: RowFade | null;
}) {
    const top = useSharedValue(0);
    const bottom = useSharedValue(0);
    const bounds = fade ? { ...fade, top, bottom } : null;
    return (
        <View
            className="pb-2"
            onLayout={(event) => {
                const { y, height } = event.nativeEvent.layout;
                top.set(y);
                bottom.set(y + height);
            }}
        >
            {options.map((option) => (
                <OptionRow
                    key={option.key}
                    option={option}
                    selected={option.key === selectedKey}
                    onPress={() => onSelect(option.key)}
                    bounds={bounds}
                />
            ))}
        </View>
    );
}

function OptionRow({
    option,
    selected,
    onPress,
    bounds,
}: {
    option: PickerOption;
    selected: boolean;
    onPress: () => void;
    bounds: SectionBounds | null;
}) {
    const { colors } = useTheme();
    const rowY = useSharedValue(0);
    const rowHeight = useSharedValue(0);
    // Gone a little before the row's bottom reaches the header's bottom. The
    // header stops at the section's end, where the next header pushes it.
    const fadeStyle = useAnimatedStyle(() => {
        const height = rowHeight.get();
        if (!bounds || height <= 0) return { opacity: 1 };
        const headerBottom = Math.min(
            bounds.scrollY.get() + bounds.headerHeight.get(),
            bounds.bottom.get(),
        );
        const rowBottom = bounds.top.get() + rowY.get() + height;
        const covered = 1 - (rowBottom - headerBottom) / height;
        return {
            opacity: 1 - Math.min(1, Math.max(0, covered * ROW_FADE_STRENGTH)),
        };
    });
    return (
        <Animated.View
            style={fadeStyle}
            onLayout={(event) => {
                rowY.set(event.nativeEvent.layout.y);
                rowHeight.set(event.nativeEvent.layout.height);
            }}
        >
            <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                className={cn(
                    "flex-row items-center gap-4 rounded-lg px-3 py-3.5 active:bg-accent",
                    selected && "bg-accent",
                )}
                style={{ minHeight: ROW_MIN_HEIGHT }}
            >
                {option.icon && (
                    <Ionicons
                        name={option.icon}
                        size={ROW_ICON_SIZE}
                        color={option.iconColor ?? colors.text}
                    />
                )}
                <Text className="flex-1 shrink text-sm">{option.label}</Text>
                {selected && (
                    <Ionicons
                        name="checkmark"
                        size={ROW_ICON_SIZE}
                        color={colors.text}
                    />
                )}
            </Pressable>
        </Animated.View>
    );
}
