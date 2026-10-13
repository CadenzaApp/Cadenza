import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    FadeIn,
    FadeOut,
    runOnJS,
    useSharedValue,
    useAnimatedStyle,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useDefaultTags } from "@/lib/routes/tags";
import { THEME } from "@/lib/theme";
import type { Tag, TagMetadata } from "@/lib/types";
import { useColorScheme } from "nativewind";
import { useOpenScreen } from "@/lib/open-screen";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { DraggablePill } from "./DraggablePill";
import { DropSlot } from "./DropSlot";
import { PaletteTagPill, SuggestedTagPill } from "./QueryTagPill";
import { sortTagsByApplicationCount } from "./QueryUtils";
import { useDrag } from "./DragContext";
import { METADATA_PALETTE_TAGS } from "./metadata-palette";

// Vertical padding + resize handle + heading/search row. At this height the
// scrollable tag content has no viewport, so the palette acts as collapsed.
export const TAG_PALETTE_MIN_HEIGHT = 64;
export const TAG_PALETTE_MAX_HEIGHT = 420;

export function TagPalette({
    tags,
    tagMetadata,
    height,
    onHeightChange,
    includeSuggestedTags,
    showAdvancedTags,
    showMetadataTags,
    usedTagIds,
    pendingTag,
    onTagTap,
}: {
    tags: readonly Tag[];
    tagMetadata?: Readonly<Record<number, TagMetadata>>;
    height: number;
    onHeightChange: (height: number) => void;
    includeSuggestedTags: boolean;
    showAdvancedTags: boolean;
    showMetadataTags: boolean;
    usedTagIds: ReadonlySet<number>;
    pendingTag: { tag: Tag; suggested: boolean } | null;
    onTagTap: (tag: Tag, suggested: boolean) => void;
}) {
    const openScreen = useOpenScreen();
    const [search, setSearch] = useState("");
    const [tagViewportHeight, setTagViewportHeight] = useState(0);
    const { dragState, hoveredTargetKey } = useDrag();
    const { colorScheme = "light" } = useColorScheme();
    const { playerBottomInset } = useScreenOverlayInsets();
    // The native tab bar floats over this screen on both platforms. Its
    // platform-specific inset (and the player, when present) sets the floor;
    // the remaining 64 points hold the handle and heading with a small gap.
    const minimumHeight = TAG_PALETTE_MIN_HEIGHT + playerBottomInset;
    const theme = THEME[colorScheme];
    const paletteHeight = useSharedValue(height);
    const resizeStartY = useSharedValue(0);
    const resizeStartHeight = useSharedValue(height);
    const collapsed = height <= minimumHeight;
    const deleteHovered =
        dragState?.payload.source !== "palette" &&
        hoveredTargetKey === "delete";
    const deletingGroup = dragState?.payload.source === "condition";
    const filtered = useMemo(() => {
        const needle = search.trim().toLocaleLowerCase();
        const matchingTags = needle
            ? tags.filter((tag) =>
                  tag.name.toLocaleLowerCase().includes(needle),
              )
            : [...tags];
        return sortTagsByApplicationCount(matchingTags, tagMetadata);
    }, [search, tagMetadata, tags]);
    const basicTags = filtered.filter((tag) => tag.type === "basic");
    const advancedTags = showAdvancedTags
        ? filtered.filter((tag) => tag.type !== "basic")
        : [];
    const { defaultTags, defaultTagsLoading, defaultTagsErr } = useDefaultTags(
        search,
        includeSuggestedTags,
    );
    const needle = search.trim().toLocaleLowerCase();
    const suggestedTags = includeSuggestedTags
        ? (defaultTags ?? []).filter((tag) =>
              tag.name.toLocaleLowerCase().includes(needle),
          )
        : [];
    const metadataTags = showMetadataTags
        ? METADATA_PALETTE_TAGS.filter((tag) =>
              tag.name.toLocaleLowerCase().includes(needle),
          )
        : [];
    const sections = [
        { key: "basic", tags: basicTags, suggested: false },
        { key: "suggested", tags: suggestedTags, suggested: true },
        { key: "advanced", tags: advancedTags, suggested: false },
        { key: "metadata", tags: metadataTags, suggested: false },
    ].filter((section) => section.tags.length > 0);
    useEffect(() => {
        paletteHeight.set(height);
    }, [height, paletteHeight]);
    useEffect(() => {
        if (height < minimumHeight) onHeightChange(minimumHeight);
    }, [height, minimumHeight, onHeightChange]);
    const commitHeight = useCallback(
        (nextHeight: number) => onHeightChange(nextHeight),
        [onHeightChange],
    );
    const resizeGesture = useMemo(() => {
        return Gesture.Pan()
            .minDistance(3)
            .maxPointers(1)
            .onStart((event) => {
                resizeStartY.set(event.absoluteY);
                resizeStartHeight.set(paletteHeight.get());
            })
            .onUpdate((event) => {
                const nextHeight = Math.round(
                    Math.max(
                        minimumHeight,
                        Math.min(
                            TAG_PALETTE_MAX_HEIGHT,
                            resizeStartHeight.get() +
                                resizeStartY.get() -
                                event.absoluteY,
                        ),
                    ),
                );
                paletteHeight.set(nextHeight);
            })
            .onFinalize(() => {
                runOnJS(commitHeight)(paletteHeight.get());
            });
    }, [
        commitHeight,
        minimumHeight,
        paletteHeight,
        resizeStartHeight,
        resizeStartY,
    ]);

    const heightStyle = useAnimatedStyle(() => ({
        height: paletteHeight.get(),
    }));

    return (
        <Animated.View style={heightStyle}>
            <DropSlot
                targetKey="delete"
                target={{ kind: "delete" }}
                priority={40}
                className="relative flex-1 border-t border-border pb-2 pt-1"
            >
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        variant="regular"
                        style={StyleSheet.absoluteFill}
                    />
                </View>
                <GestureDetector gesture={resizeGesture}>
                    <View
                        collapsable={false}
                        className="-mb-2 -mt-1 h-7 items-center justify-center"
                        accessible
                        accessibilityRole="adjustable"
                        accessibilityActions={[
                            { name: "increment", label: "Expand tags" },
                            { name: "decrement", label: "Collapse tags" },
                        ]}
                        onAccessibilityAction={(event) =>
                            onHeightChange(
                                event.nativeEvent.actionName === "increment"
                                    ? 300
                                    : minimumHeight,
                            )
                        }
                        accessibilityLabel="Your tags resize handle"
                        accessibilityHint="Drag up or down to resize the tag palette"
                    >
                        <View className="-translate-y-1 h-1 w-10 rounded-full bg-border" />
                    </View>
                </GestureDetector>
                <View className="mb-3 flex-row items-center gap-3 px-5">
                    <View className="h-10 justify-center">
                        <Pressable
                            disabled={!!pendingTag}
                            onPress={() =>
                                onHeightChange(collapsed ? 300 : minimumHeight)
                            }
                            accessibilityLabel={
                                collapsed ? "Expand tags" : "Collapse tags"
                            }
                            className="min-h-11 justify-center"
                        >
                            <Text className="text-xl font-bold">Your tags</Text>
                        </Pressable>
                    </View>
                    {!pendingTag ? (
                        <PaletteSearchField
                            value={search}
                            onChangeText={(value) => {
                                setSearch(value);
                                if (collapsed) onHeightChange(300);
                            }}
                            accessibilityLabel="Search tags"
                        />
                    ) : null}
                </View>
                <ScrollView
                    className="flex-1 overflow-hidden"
                    contentContainerClassName="px-5"
                    contentContainerStyle={{
                        paddingBottom: pendingTag
                            ? 8
                            : Math.max(8, tagViewportHeight - 32),
                    }}
                    onLayout={(event) =>
                        setTagViewportHeight(event.nativeEvent.layout.height)
                    }
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={!collapsed}
                    scrollEnabled={!collapsed}
                    accessibilityElementsHidden={collapsed}
                    importantForAccessibility={
                        collapsed ? "no-hide-descendants" : "auto"
                    }
                >
                    <>
                        {pendingTag ? (
                            <View className="min-h-24 items-center justify-center">
                                <Text className="w-3/4 text-center text-xl font-semibold">
                                    Tap where you would like to place the tag
                                </Text>
                            </View>
                        ) : sections.length ? (
                            <View className="gap-2.5">
                                {sections.map((section) => (
                                    <View key={section.key} className="gap-2.5">
                                        {section.key !== "basic" ? (
                                            <View className="flex-row items-center gap-2">
                                                <Text className="text-[10px] font-bold text-muted-foreground">
                                                    {section.key === "suggested"
                                                        ? "Suggested Tags"
                                                        : section.key ===
                                                            "advanced"
                                                          ? "Advanced Tags"
                                                          : "Metadata Tags"}
                                                </Text>
                                                <View className="h-px flex-1 bg-border" />
                                            </View>
                                        ) : null}
                                        <View className="flex-row flex-wrap gap-x-0.5 gap-y-0">
                                            {section.tags.map((tag) =>
                                                section.suggested ? (
                                                    <DraggableSuggestedTag
                                                        key={tag.id}
                                                        tag={tag}
                                                        used={usedTagIds.has(
                                                            tag.id,
                                                        )}
                                                        onTap={() =>
                                                            onTagTap(tag, true)
                                                        }
                                                    />
                                                ) : (
                                                    <DraggablePaletteTag
                                                        key={tag.id}
                                                        tag={tag}
                                                        used={usedTagIds.has(
                                                            tag.id,
                                                        )}
                                                        onTap={() =>
                                                            onTagTap(tag, false)
                                                        }
                                                    />
                                                ),
                                            )}
                                        </View>
                                    </View>
                                ))}
                            </View>
                        ) : (
                            <View className="gap-2 py-4">
                                <Text className="text-center text-sm text-muted-foreground">
                                    {includeSuggestedTags && defaultTagsLoading
                                        ? "Loading suggested tags..."
                                        : includeSuggestedTags && defaultTagsErr
                                          ? "Suggested tags could not be loaded."
                                          : tags.length
                                            ? showAdvancedTags
                                                ? "No tags match your search."
                                                : "No basic tags match. Advanced tags are hidden in query settings."
                                            : "Create tags in Library to start, or enable suggested tags in settings."}
                                </Text>
                                {!tags.length ? (
                                    <Pressable
                                        onPress={() =>
                                            openScreen({
                                                pathname:
                                                    "/library/category/[kind]",
                                                params: { kind: "tag" },
                                            })
                                        }
                                        className="min-h-11 items-center justify-center"
                                    >
                                        <Text className="text-sm font-semibold">
                                            Open tags in Library
                                        </Text>
                                    </Pressable>
                                ) : null}
                            </View>
                        )}
                    </>
                </ScrollView>
                {deleteHovered ? (
                    <>
                        <Animated.View
                            pointerEvents="none"
                            entering={FadeIn.duration(200)}
                            exiting={FadeOut.duration(160)}
                            className="absolute inset-0 z-10"
                            style={{ backgroundColor: "#000000" }}
                        />
                        <Animated.View
                            pointerEvents="none"
                            entering={FadeIn.delay(40).duration(180)}
                            exiting={FadeOut.duration(120)}
                            className="absolute inset-0 z-20 items-center justify-center"
                        >
                            <Ionicons
                                name="trash-outline"
                                size={32}
                                color={theme.destructive}
                            />
                            <Text className="mt-2 text-sm font-semibold text-destructive">
                                Drop to delete {deletingGroup ? "group" : "tag"}
                            </Text>
                        </Animated.View>
                    </>
                ) : null}
            </DropSlot>
        </Animated.View>
    );
}

/** An outlined search field above the palette's glass surface. */
function PaletteSearchField({
    value,
    onChangeText,
    accessibilityLabel,
}: {
    value: string;
    onChangeText: (value: string) => void;
    accessibilityLabel: string;
}) {
    const { colorScheme = "light" } = useColorScheme();
    return (
        <View className="relative h-9 flex-1 overflow-hidden rounded-full">
            <Input
                value={value}
                onChangeText={onChangeText}
                placeholder="Search"
                placeholderTextColor={THEME[colorScheme].mutedForeground}
                accessibilityLabel={accessibilityLabel}
                className="h-9 rounded-full border-input bg-transparent pl-4 text-sm font-semibold shadow-none"
                style={{ backgroundColor: "transparent" }}
                autoCapitalize="none"
                autoCorrect={false}
            />
        </View>
    );
}

function DraggablePaletteTag({
    tag,
    used,
    onTap,
}: {
    tag: Tag;
    used: boolean;
    onTap: () => void;
}) {
    const dragPayload = useMemo(
        () => ({ source: "palette" as const, tag, suggested: false }),
        [tag],
    );
    return (
        <DraggablePill payload={dragPayload}>
            <Pressable
                onPress={onTap}
                className="px-[6px] py-[2px]"
                accessibilityRole="button"
                accessibilityLabel={`${tag.name}${used ? ", already in query" : ""}`}
                accessibilityHint="Tap to choose where to place, or drag into the query"
            >
                <PaletteTagPill tag={tag} />
            </Pressable>
        </DraggablePill>
    );
}

function DraggableSuggestedTag({
    tag,
    used,
    onTap,
}: {
    tag: Tag;
    used: boolean;
    onTap: () => void;
}) {
    const dragPayload = useMemo(
        () => ({ source: "palette" as const, tag, suggested: true }),
        [tag],
    );
    return (
        <DraggablePill payload={dragPayload}>
            <Pressable
                onPress={onTap}
                className="px-[6px] py-[2px]"
                accessibilityRole="button"
                accessibilityLabel={`Suggested ${tag.name}${used ? ", already in query" : ""}`}
                accessibilityHint="Tap to choose where to place, or drag into the query"
            >
                <SuggestedTagPill tag={tag} />
            </Pressable>
        </DraggablePill>
    );
}
