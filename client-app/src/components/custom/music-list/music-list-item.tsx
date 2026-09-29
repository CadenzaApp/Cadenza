import { memo, useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useColorScheme } from "nativewind";
import Animated, {
    Easing,
    FadeIn,
    FadeInLeft,
    FadeOut,
    FadeOutLeft,
    ZoomIn,
    useAnimatedStyle,
    withTiming,
} from "react-native-reanimated";
import type { MusicItem } from "@apple-musickit";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { THEME, type ThemeColorToken } from "@/lib/theme";
import type { AppliedTag, Tag, TagMetadata } from "@/lib/types";
import { cn } from "@/lib/utils";

import { TagFadeRail } from "./tag-fade-rail";

type MusicListItemProps = {
    item: MusicItem;
    tags?: readonly AppliedTag[];
    /** Shared default tags on the song, rendered unfilled after the user's own. */
    defaultTags?: readonly Tag[];
    mostRelevantTags?: readonly string[];
    tagMetadata?: Readonly<Record<number, TagMetadata>>;
    /** Every activity tag on the song for this user, as the backend returns them. */
    activityTags?: readonly AppliedTag[];
    /** Which of `activityTags` to show, and in what order. */
    activityTagIds?: readonly number[];
    selected: boolean;
    selectionMode: boolean;
    multiSelectEnabled: boolean;
    animateSelectionTransition: boolean;
    fullBleed?: boolean;
    fullBleedHorizontalPadding?: number;
    rowSurfaceColor?: ThemeColorToken;
    compact?: boolean;
    onPress: (item: MusicItem) => void;
    onLongPress?: (item: MusicItem) => void;
    onOpenMenu: (item: MusicItem) => void;
};

const ARTWORK_SIZE = 58;
const COMPACT_ARTWORK_SIZE = 48;
const REGULAR_ROW_VERTICAL_PADDING = 7.5;
const COMPACT_ROW_VERTICAL_PADDING = 5.5;
const MENU_CONTROL_SHIFT = 8;
const TAG_RAIL_END_MARGIN = -4;
const EMPTY_APPLIED_TAGS: readonly AppliedTag[] = [];
const EMPTY_DEFAULT_TAGS: readonly Tag[] = [];

/** The fixed artwork and vertical padding determine the height of every row. */
export const MUSIC_LIST_ITEM_HEIGHT = {
    regular: ARTWORK_SIZE + 2 * REGULAR_ROW_VERTICAL_PADDING,
    compact: COMPACT_ARTWORK_SIZE + 2 * COMPACT_ROW_VERTICAL_PADDING,
} as const;

export const MusicListItem = memo(function MusicListItem({
    item,
    tags,
    defaultTags,
    activityTags,
    mostRelevantTags,
    tagMetadata,
    activityTagIds,
    selected,
    selectionMode,
    multiSelectEnabled,
    animateSelectionTransition,
    fullBleed = false,
    fullBleedHorizontalPadding = 18,
    compact = false,
    onPress,
    onLongPress,
    onOpenMenu,
}: MusicListItemProps) {
    const { colors } = useTheme();
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];
    const [rowPressed, setRowPressed] = useState(false);
    const longPressConsumedRef = useRef(false);
    const itemTags = tags ?? EMPTY_APPLIED_TAGS;
    const itemDefaultTags = defaultTags ?? EMPTY_DEFAULT_TAGS;
    const shownActivityTags = useMemo(
        () => pickActivityTags(activityTags, activityTagIds),
        [activityTags, activityTagIds],
    );
    const selectionColor = hexWithAlpha(theme.foreground, 0.12);
    const animatedRowStyle = useAnimatedStyle(
        () => ({
            backgroundColor: withTiming(
                selected ? selectionColor : "transparent",
                {
                    duration: 180,
                    easing: Easing.out(Easing.cubic),
                },
            ),
        }),
        [selected, selectionColor],
    );
    const animatedContentStyle = useAnimatedStyle(() => {
        const translateX = selectionMode ? (fullBleed ? 28 : 52) : 0;
        return {
            transform: [
                {
                    translateX: animateSelectionTransition
                        ? withTiming(translateX, {
                              duration: 180,
                              easing: Easing.out(Easing.cubic),
                          })
                        : translateX,
                },
            ],
        };
    }, [animateSelectionTransition, fullBleed, selectionMode]);

    return (
        <Animated.View
            className={cn("relative flex-row items-center justify-between")}
            style={[
                animatedRowStyle,
                {
                    paddingVertical: compact
                        ? COMPACT_ROW_VERTICAL_PADDING
                        : REGULAR_ROW_VERTICAL_PADDING,
                    paddingHorizontal: fullBleed
                        ? fullBleedHorizontalPadding
                        : 0,
                },
            ]}
        >
            {selectionMode ? (
                <View
                    className={cn(
                        "absolute bottom-0 top-0 z-10 justify-center",
                        fullBleed ? "left-1" : "left-0",
                    )}
                >
                    <Animated.View
                        key="selection-control"
                        entering={
                            animateSelectionTransition
                                ? FadeInLeft.duration(160).easing(
                                      Easing.out(Easing.cubic),
                                  )
                                : undefined
                        }
                        exiting={
                            animateSelectionTransition
                                ? FadeOutLeft.duration(100)
                                : undefined
                        }
                    >
                        <Button
                            size="icon"
                            className={cn("h-11 w-11 shrink-0 rounded-full")}
                            variant="ghost"
                            onPress={() => onPress(item)}
                            accessibilityLabel={
                                selected
                                    ? `Deselect ${item.title}`
                                    : `Select ${item.title}`
                            }
                        >
                            <Animated.View
                                key={selected ? "selected" : "unselected"}
                                entering={ZoomIn.duration(80)}
                            >
                                <Ionicons
                                    name={
                                        selected
                                            ? "checkmark-circle"
                                            : "ellipse-outline"
                                    }
                                    size={28}
                                    color={colors.text}
                                />
                            </Animated.View>
                        </Button>
                    </Animated.View>
                </View>
            ) : null}

            <Animated.View className="flex-1" style={animatedContentStyle}>
                <View
                    pointerEvents="box-none"
                    className="flex-1 flex-row items-center"
                    style={[
                        {
                            marginRight: selectionMode
                                ? 12
                                : TAG_RAIL_END_MARGIN,
                        },
                        rowPressed ? { opacity: 0.85 } : undefined,
                    ]}
                >
                    <Pressable
                        style={StyleSheet.absoluteFill}
                        onPressIn={() => {
                            setRowPressed(true);
                            longPressConsumedRef.current = false;
                        }}
                        onPressOut={() => setRowPressed(false)}
                        onPress={() => {
                            if (longPressConsumedRef.current) {
                                longPressConsumedRef.current = false;
                                return;
                            }
                            onPress(item);
                        }}
                        onLongPress={
                            !selectionMode && multiSelectEnabled && onLongPress
                                ? () => {
                                      longPressConsumedRef.current = true;
                                      onLongPress(item);
                                  }
                                : undefined
                        }
                        delayLongPress={300}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.title} by ${item.artistName}`}
                        accessibilityState={{ selected }}
                    />
                    <MusicListItemVisuals
                        item={item}
                        tags={itemTags}
                        defaultTags={itemDefaultTags}
                        activityTags={shownActivityTags}
                        mostRelevantTags={mostRelevantTags}
                        tagMetadata={tagMetadata}
                        compact={compact}
                    />
                </View>
            </Animated.View>

            {!selectionMode ? (
                <Animated.View
                    key="menu-control"
                    style={{
                        zIndex: 1,
                        transform: [{ translateX: MENU_CONTROL_SHIFT }],
                    }}
                    entering={
                        animateSelectionTransition
                            ? FadeIn.duration(140)
                            : undefined
                    }
                    exiting={
                        animateSelectionTransition
                            ? FadeOut.duration(80)
                            : undefined
                    }
                >
                    <Button
                        size="icon"
                        className="h-10 w-10 shrink-0 rounded-full"
                        onPress={() => onOpenMenu(item)}
                        variant="ghost"
                        accessibilityLabel={`Options for ${item.title}`}
                    >
                        <Ionicons
                            name="ellipsis-horizontal"
                            size={24}
                            color={colors.text}
                        />
                    </Button>
                </Animated.View>
            ) : null}
        </Animated.View>
    );
});

/** The expensive, selection-independent part of a row. */
const MusicListItemVisuals = memo(function MusicListItemVisuals({
    item,
    tags,
    defaultTags,
    activityTags,
    mostRelevantTags,
    tagMetadata,
    compact,
}: {
    item: MusicItem;
    tags: readonly AppliedTag[];
    defaultTags: readonly Tag[];
    activityTags: readonly AppliedTag[];
    mostRelevantTags?: readonly string[];
    tagMetadata?: Readonly<Record<number, TagMetadata>>;
    compact: boolean;
}) {
    const [artworkFailed, setArtworkFailed] = useState(false);
    const hasTags =
        tags.length > 0 || defaultTags.length > 0 || activityTags.length > 0;
    const artworkUrl = item.artworkUrl?.trim();
    const canRenderArtwork =
        !artworkFailed &&
        typeof artworkUrl === "string" &&
        /^https?:\/\//i.test(artworkUrl);
    const artworkSize = compact ? COMPACT_ARTWORK_SIZE : ARTWORK_SIZE;

    return (
        <>
            {canRenderArtwork ? (
                <View
                    pointerEvents="none"
                    className="mr-2 shrink-0"
                    style={{
                        width: artworkSize,
                        aspectRatio: 1,
                        transform: [{ translateY: compact ? 2 : 4 }],
                    }}
                >
                    <Image
                        source={{ uri: artworkUrl }}
                        className="h-full w-full rounded bg-muted"
                        resizeMode="cover"
                        style={{ borderRadius: 4 }}
                        onError={() => setArtworkFailed(true)}
                    />
                </View>
            ) : (
                <View
                    pointerEvents="none"
                    className="mr-2 shrink-0 items-center justify-center rounded bg-muted"
                    style={{
                        width: artworkSize,
                        aspectRatio: 1,
                        transform: [{ translateY: compact ? 2 : 4 }],
                    }}
                >
                    <Text className="text-xs text-muted-foreground text-center">
                        No Art
                    </Text>
                </View>
            )}

            <View
                pointerEvents="box-none"
                className="flex-1 flex-col justify-center overflow-hidden"
                style={
                    !hasTags
                        ? {
                              rowGap: 1,
                              transform: [{ translateY: 5 }],
                          }
                        : {
                              rowGap: 3,
                              transform: [{ translateY: 1 }],
                          }
                }
            >
                <View pointerEvents="none">
                    <Text
                        className="text-base font-bold leading-tight text-foreground"
                        numberOfLines={1}
                    >
                        {item.title}
                    </Text>
                    <Text
                        className="text-sm leading-tight text-muted-foreground"
                        style={{ transform: [{ translateY: -1 }] }}
                        numberOfLines={1}
                    >
                        {item.artistName}
                    </Text>
                </View>

                {hasTags ? (
                    <TagFadeRail
                        tags={tags}
                        defaultTags={defaultTags}
                        activityTags={activityTags}
                        mostRelevantTags={mostRelevantTags}
                        tagMetadata={tagMetadata}
                        compact={compact}
                    />
                ) : null}
            </View>
        </>
    );
});

export function MusicListItemSkeleton({
    fullBleed = false,
    fullBleedHorizontalPadding = 18,
    compact = false,
}: {
    fullBleed?: boolean;
    fullBleedHorizontalPadding?: number;
    compact?: boolean;
}) {
    const artworkSize = compact ? COMPACT_ARTWORK_SIZE : ARTWORK_SIZE;
    return (
        <View
            className="relative flex-row items-center justify-between"
            style={{
                paddingVertical: compact
                    ? COMPACT_ROW_VERTICAL_PADDING
                    : REGULAR_ROW_VERTICAL_PADDING,
                paddingHorizontal: fullBleed ? fullBleedHorizontalPadding : 0,
            }}
        >
            <View
                className="flex-1 flex-row items-center overflow-hidden"
                style={{ marginRight: TAG_RAIL_END_MARGIN }}
            >
                <Skeleton
                    className="mr-2 shrink-0 rounded"
                    style={{
                        width: artworkSize,
                        aspectRatio: 1,
                        transform: [{ translateY: 4 }],
                    }}
                />
                <View className="flex-1 justify-center gap-1 overflow-hidden">
                    <Skeleton className="h-4 w-3/4 rounded-sm" />
                    <Skeleton className="h-3 w-1/2 rounded-sm" />
                    <View className="h-4 flex-row gap-1">
                        <Skeleton className="h-4 w-16 rounded-full" />
                        <Skeleton className="h-4 w-11 rounded-full" />
                    </View>
                </View>
            </View>
            <Skeleton
                className="h-10 w-10 shrink-0 rounded-full"
                style={{ transform: [{ translateX: MENU_CONTROL_SHIFT }] }}
            />
        </View>
    );
}

function hexWithAlpha(hex: string, alpha: number) {
    const normalized = hex.replace("#", "");
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const NO_ACTIVITY_TAGS: readonly AppliedTag[] = [];

/** The activity tags named by `ids`, in that order, out of the song's. */
function pickActivityTags(
    activityTags: readonly AppliedTag[] | undefined,
    ids: readonly number[] | undefined,
): readonly AppliedTag[] {
    if (!activityTags?.length || !ids?.length) return NO_ACTIVITY_TAGS;
    const byId = new Map(activityTags.map((tag) => [tag.id, tag]));
    return ids.flatMap((id) => {
        const tag = byId.get(id);
        return tag ? [tag] : [];
    });
}
