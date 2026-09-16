import Ionicons from "@expo/vector-icons/Ionicons";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    FadeIn,
    FadeOut,
    runOnJS,
    useSharedValue,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import type { Tag } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useColorScheme } from "nativewind";
import { DraggablePill } from "./DraggablePill";
import { DropSlot } from "./DropSlot";
import { PaletteTagPill } from "./QueryTagPill";
import { useDrag } from "./DragContext";

// Vertical padding + resize handle + heading/search row. At this height the
// scrollable tag content has no viewport, so the palette acts as collapsed.
export const TAG_PALETTE_MIN_HEIGHT = 80;
export const TAG_PALETTE_MAX_HEIGHT = 360;

export function TagPalette({
    tags,
    height,
    onHeightChange,
}: {
    tags: readonly Tag[];
    height: number;
    onHeightChange: (height: number) => void;
}) {
    const [search, setSearch] = useState("");
    const { dragState, hoveredTargetKey } = useDrag();
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];
    const liquidGlassAvailable = isLiquidGlassAvailable();
    const paletteHeight = useSharedValue(height);
    const resizeStartY = useSharedValue(0);
    const resizeStartHeight = useSharedValue(height);
    const deleteHovered =
        dragState?.payload.source !== "palette" &&
        hoveredTargetKey === "delete";
    const deletingGroup = dragState?.payload.source === "condition";
    const filtered = useMemo(() => {
        const needle = search.trim().toLocaleLowerCase();
        return needle
            ? tags.filter((tag) =>
                  tag.name.toLocaleLowerCase().includes(needle),
              )
            : [...tags];
    }, [search, tags]);
    useEffect(() => {
        paletteHeight.set(height);
    }, [height, paletteHeight]);
    const commitHeight = useCallback(
        (nextHeight: number) => onHeightChange(nextHeight),
        [onHeightChange],
    );
    const resizeGestures = useMemo(() => {
        const createResizeGesture = () =>
            Gesture.Pan()
                .minDistance(3)
                .maxPointers(1)
                .onStart((event) => {
                    resizeStartY.set(event.absoluteY);
                    resizeStartHeight.set(paletteHeight.get());
                })
                .onUpdate((event) => {
                    const nextHeight = Math.round(
                        Math.max(
                            TAG_PALETTE_MIN_HEIGHT,
                            Math.min(
                                TAG_PALETTE_MAX_HEIGHT,
                                resizeStartHeight.get() +
                                    resizeStartY.get() -
                                    event.absoluteY,
                            ),
                        ),
                    );
                    paletteHeight.set(nextHeight);
                    runOnJS(commitHeight)(nextHeight);
                });

        return {
            handle: createResizeGesture(),
            heading: createResizeGesture(),
        };
    }, [commitHeight, paletteHeight, resizeStartHeight, resizeStartY]);

    return (
        <DropSlot
            targetKey="delete"
            target={{ kind: "delete" }}
            priority={40}
            className="relative border-t border-border bg-background px-4 pb-2 pt-1"
            style={{ height }}
        >
            <GestureDetector gesture={resizeGestures.handle}>
                <View
                    collapsable={false}
                    className="-mb-2 -mt-1 h-7 items-center justify-center"
                    accessibilityLabel="Your tags resize handle"
                    accessibilityHint="Drag up or down to resize the tag palette"
                >
                    <View className="-translate-y-1 h-1 w-10 rounded-full bg-border" />
                </View>
            </GestureDetector>
            <ScrollView
                className="flex-1"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <View className="mb-3 flex-row items-center gap-4">
                    <GestureDetector gesture={resizeGestures.heading}>
                        <View
                            collapsable={false}
                            className="h-10 justify-center"
                            accessibilityLabel="Your tags resize handle"
                            accessibilityHint="Drag up or down to resize the tag palette"
                        >
                            <Text className="text-lg font-bold">Your tags</Text>
                        </View>
                    </GestureDetector>
                    <View className="relative h-10 flex-1 overflow-hidden rounded-full">
                        {liquidGlassAvailable ? (
                            <View
                                pointerEvents="none"
                                style={StyleSheet.absoluteFill}
                            >
                                <GlassSurface
                                    variant="regular"
                                    style={StyleSheet.absoluteFill}
                                />
                            </View>
                        ) : null}
                        <Input
                            value={search}
                            onChangeText={setSearch}
                            placeholder="Search"
                            accessibilityLabel="Search tags"
                            className={cn(
                                "h-10 rounded-full pl-4",
                                liquidGlassAvailable
                                    ? "border-border bg-transparent"
                                    : "border-input bg-background",
                            )}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </View>
                </View>
                {filtered.length ? (
                    <View className="flex-row flex-wrap gap-2">
                        {filtered.map((tag) => (
                            <DraggablePaletteTag key={tag.id} tag={tag} />
                        ))}
                    </View>
                ) : (
                    <Text className="py-6 text-center text-muted-foreground">
                        No tags found.
                    </Text>
                )}
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
    );
}

function DraggablePaletteTag({ tag }: { tag: Tag }) {
    const dragPayload = useMemo(
        () => ({ source: "palette" as const, tag }),
        [tag],
    );
    return (
        <DraggablePill payload={dragPayload}>
            <PaletteTagPill tag={tag} />
        </DraggablePill>
    );
}
