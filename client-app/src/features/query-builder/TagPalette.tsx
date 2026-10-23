import Ionicons from "@expo/vector-icons/Ionicons";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    FadeIn,
    FadeOut,
    runOnJS,
    runOnUI,
    scrollTo,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    useDerivedValue,
    type SharedValue,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useOpenScreen } from "@/lib/open-screen";
import { useDefaultTags } from "@/lib/routes/tags";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useAppTheme } from "@/lib/theme";
import type { Tag, TagMetadata } from "@/lib/types";
import { useDrag, useDropHover } from "./DragContext";
import { DraggablePill } from "./DraggablePill";
import { DropSlot } from "./DropSlot";
import { METADATA_PALETTE_TAGS } from "./metadata-palette";
import { PaletteTagPill } from "./QueryTagPill";
import { sortTagsByApplicationCount } from "./QueryUtils";

import { DropViewport } from "./DropViewport";
import {
    clampPaletteHeight,
    paletteTranslation,
    TAG_PALETTE_MIN_HEIGHT,
    TAG_PALETTE_MAX_HEIGHT,
} from "./palette-geometry";

export function TagPalette({
    tags,
    tagMetadata,
    height,
    visibleHeight,
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
    visibleHeight: SharedValue<number>;
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
    const scrollRef = useAnimatedRef<Animated.ScrollView>();
    const scrollOffset = useSharedValue(0);
    const onScroll = useAnimatedScrollHandler((event) => {
        scrollOffset.set(event.contentOffset.y);
    });
    const { dragState } = useDrag();
    const deleteHovered = useDropHover("delete");
    const { colors: theme } = useAppTheme();
    const { playerBottomInset } = useScreenOverlayInsets();
    // The native tab bar floats over this screen on both platforms. Its
    // platform-specific inset (and the player, when present) sets the floor;
    // the remaining 64 points hold the handle and heading with a small gap.
    const minimumHeight = Math.min(
        TAG_PALETTE_MAX_HEIGHT,
        TAG_PALETTE_MIN_HEIGHT + playerBottomInset,
    );
    const paletteHeight = visibleHeight;
    const translation = useDerivedValue(() =>
        paletteTranslation(paletteHeight.get()),
    );
    const resizeStartY = useSharedValue(0);
    const resizeStartHeight = useSharedValue(height);
    const collapsed = height <= minimumHeight;
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
    const { defaultTags, defaultTagsLoading, defaultTagsErr } = useDefaultTags(
        search,
        includeSuggestedTags,
    );
    const sections = useMemo(() => {
        const needle = search.trim().toLocaleLowerCase();
        return [
            {
                key: "basic",
                tags: filtered.filter((tag) => tag.type === "basic"),
                suggested: false,
            },
            {
                key: "suggested",
                tags: includeSuggestedTags
                    ? (defaultTags ?? []).filter((tag) =>
                          tag.name.toLocaleLowerCase().includes(needle),
                      )
                    : [],
                suggested: true,
            },
            {
                key: "advanced",
                tags: showAdvancedTags
                    ? filtered.filter((tag) => tag.type !== "basic")
                    : [],
                suggested: false,
            },
            {
                key: "metadata",
                tags: showMetadataTags
                    ? METADATA_PALETTE_TAGS.filter((tag) =>
                          tag.name.toLocaleLowerCase().includes(needle),
                      )
                    : [],
                suggested: false,
            },
        ].filter((section) => section.tags.length > 0);
    }, [
        filtered,
        search,
        includeSuggestedTags,
        defaultTags,
        showAdvancedTags,
        showMetadataTags,
    ]);
    useEffect(() => {
        paletteHeight.set(height);
    }, [height, paletteHeight]);
    useEffect(() => {
        if (height < minimumHeight) onHeightChange(minimumHeight);
    }, [height, minimumHeight, onHeightChange]);
    useEffect(() => {
        if (!collapsed) return;
        runOnUI(() => {
            scrollTo(scrollRef, 0, 0, false);
            scrollOffset.set(0);
        })();
    }, [collapsed, scrollRef, scrollOffset]);
    const commitHeight = useCallback(
        (nextHeight: number) => onHeightChange(nextHeight),
        [onHeightChange],
    );
    // scrollRef is read by the UI-thread gesture, not while building it.
    /* eslint-disable react-hooks/refs */
    const resizeGesture = useMemo(() => {
        return Gesture.Pan()
            .minDistance(3)
            .maxPointers(1)
            .onStart((event) => {
                scrollTo(scrollRef, 0, Math.max(0, scrollOffset.get()), false);
                resizeStartY.set(event.absoluteY);
                resizeStartHeight.set(paletteHeight.get());
            })
            .onUpdate((event) => {
                const nextHeight = clampPaletteHeight(
                    resizeStartHeight.get() +
                        resizeStartY.get() -
                        event.absoluteY,
                    minimumHeight,
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
        scrollRef,
        scrollOffset,
    ]);

    /* eslint-enable react-hooks/refs */
    const sheetStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translation.get() }],
    }));

    return (
        <Animated.View
            className="absolute bottom-0 left-0 right-0 overflow-hidden"
            style={[{ height: TAG_PALETTE_MAX_HEIGHT }, sheetStyle]}
        >
            <DropViewport className="flex-1" translationY={translation}>
                <DropSlot
                    targetKey="delete"
                    target={{ kind: "delete" }}
                    priority={40}
                    className="relative flex-1 border-t border-border pb-2 pt-1"
                >
                    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                        <GlassSurface
                            variant="regular"
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                right: 0,
                                height: TAG_PALETTE_MAX_HEIGHT,
                            }}
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
                    <Animated.ScrollView
                        ref={scrollRef}
                        onScroll={onScroll}
                        scrollEventThrottle={16}
                        removeClippedSubviews={false}
                        className="flex-1 overflow-hidden"
                        contentContainerClassName="px-5 pb-2"
                        contentContainerStyle={{ flexGrow: 0, flexShrink: 0 }}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={!collapsed}
                        scrollEnabled={!collapsed}
                    >
                        <>
                            <View className="mb-3 flex-row items-center gap-3">
                                <View className="h-10 justify-center">
                                    <Pressable
                                        disabled={!!pendingTag}
                                        onPress={() =>
                                            onHeightChange(
                                                collapsed ? 300 : minimumHeight,
                                            )
                                        }
                                        accessibilityLabel={
                                            collapsed
                                                ? "Expand tags"
                                                : "Collapse tags"
                                        }
                                        className="min-h-11 justify-center"
                                    >
                                        <Text className="text-xl font-bold">
                                            Your tags
                                        </Text>
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
                            <View
                                className="shrink-0"
                                accessibilityElementsHidden={collapsed}
                                importantForAccessibility={
                                    collapsed ? "no-hide-descendants" : "auto"
                                }
                            >
                                {pendingTag ? (
                                    <View className="min-h-24 items-center justify-center">
                                        <Text className="w-3/4 text-center text-xl font-semibold">
                                            Tap where you would like to place
                                            the tag
                                        </Text>
                                    </View>
                                ) : sections.length ? (
                                    <PaletteSections
                                        sections={sections}
                                        tagMetadata={tagMetadata}
                                        usedTagIds={usedTagIds}
                                        onTagTap={onTagTap}
                                    />
                                ) : (
                                    <View className="gap-2 py-4">
                                        <Text className="text-center text-sm text-muted-foreground">
                                            {includeSuggestedTags &&
                                            defaultTagsLoading
                                                ? "Loading suggested tags..."
                                                : includeSuggestedTags &&
                                                    defaultTagsErr
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
                                {!pendingTag ? (
                                    // Keep scroll runway separate from the intrinsic
                                    // section heights, including in a collapsed viewport.
                                    <View
                                        className="shrink-0"
                                        style={{
                                            height: TAG_PALETTE_MAX_HEIGHT,
                                        }}
                                        pointerEvents="none"
                                        accessible={false}
                                    />
                                ) : null}
                            </View>
                        </>
                    </Animated.ScrollView>
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
                                    Drop to delete{" "}
                                    {deletingGroup ? "group" : "tag"}
                                </Text>
                            </Animated.View>
                        </>
                    ) : null}
                </DropSlot>
            </DropViewport>
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
    const { colors } = useAppTheme();
    return (
        <View className="relative h-9 flex-1 overflow-hidden rounded-full">
            <Input
                value={value}
                onChangeText={onChangeText}
                placeholder="Search"
                placeholderTextColor={colors.mutedForeground}
                accessibilityLabel={accessibilityLabel}
                className="h-9 rounded-full border-input bg-transparent pl-4 text-sm font-semibold shadow-none"
                style={{ backgroundColor: "transparent" }}
                autoCapitalize="none"
                autoCorrect={false}
            />
        </View>
    );
}

const DraggablePaletteTag = memo(function DraggablePaletteTag({
    tag,
    count,
    used,
    suggested,
    onTagTap,
}: {
    tag: Tag;
    count?: number;
    used: boolean;
    suggested: boolean;
    onTagTap: (tag: Tag, suggested: boolean) => void;
}) {
    const dragPayload = useMemo(
        () => ({ source: "palette" as const, tag, suggested }),
        [tag, suggested],
    );
    return (
        <DraggablePill payload={dragPayload}>
            <Pressable
                onPress={() => onTagTap(tag, suggested)}
                className="px-[4px] py-[4px]"
                accessibilityRole="button"
                accessibilityLabel={`${suggested ? "Suggested " : ""}${tag.name}${count === undefined ? "" : `, ${count} songs`}${used ? ", already in query" : ""}`}
                accessibilityHint="Tap to choose where to place, or drag into the query"
            >
                <PaletteTagPill tag={tag} count={count} suggested={suggested} />
            </Pressable>
        </DraggablePill>
    );
});

const PaletteSections = memo(function PaletteSections({
    sections,
    tagMetadata,
    usedTagIds,
    onTagTap,
}: {
    sections: { key: string; tags: readonly Tag[]; suggested: boolean }[];
    tagMetadata?: Readonly<Record<number, TagMetadata>>;
    usedTagIds: ReadonlySet<number>;
    onTagTap: (tag: Tag, suggested: boolean) => void;
}) {
    return (
        <View className="shrink-0 gap-2.5">
            {sections.map((section) => (
                <View key={section.key} className="shrink-0 gap-2.5">
                    {section.key !== "basic" ? (
                        <View className="shrink-0 flex-row items-center gap-2">
                            <Text className="text-[10px] font-bold text-muted-foreground">
                                {section.key === "suggested"
                                    ? "Suggested Tags"
                                    : section.key === "advanced"
                                      ? "Advanced Tags"
                                      : "Metadata Tags"}
                            </Text>
                            <View className="h-px flex-1 bg-border" />
                        </View>
                    ) : null}
                    <View className="shrink-0 flex-row flex-wrap content-start items-start gap-0.5">
                        {section.tags.map((tag) => (
                            <DraggablePaletteTag
                                key={tag.id}
                                tag={tag}
                                suggested={section.suggested}
                                count={tagMetadata?.[tag.id]?.count}
                                used={usedTagIds.has(tag.id)}
                                onTagTap={onTagTap}
                            />
                        ))}
                    </View>
                </View>
            ))}
        </View>
    );
});
