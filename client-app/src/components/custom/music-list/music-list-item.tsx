import { memo, useRef, useState } from "react";
import { Image, Pressable, View } from "react-native";
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
import type { Tag } from "@/lib/types";
import { cn } from "@/lib/utils";

import { TagFadeRail } from "./tag-fade-rail";

type MusicListItemProps = {
    item: MusicItem;
    tags?: Tag[];
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

export const MusicListItem = memo(function MusicListItem({
    item,
    tags,
    selected,
    selectionMode,
    multiSelectEnabled,
    animateSelectionTransition,
    fullBleed = false,
    fullBleedHorizontalPadding = 24,
    rowSurfaceColor = "background",
    compact = false,
    onPress,
    onLongPress,
    onOpenMenu,
}: MusicListItemProps) {
    const { colors } = useTheme();
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];
    const [artworkFailed, setArtworkFailed] = useState(false);
    const longPressConsumedRef = useRef(false);
    const itemTags = tags ?? [];
    const artworkUrl = item.artworkUrl?.trim();
    const canRenderArtwork =
        !artworkFailed &&
        typeof artworkUrl === "string" &&
        /^https?:\/\//i.test(artworkUrl);
    const surfaceColor = theme[rowSurfaceColor];
    const selectionColor = blendHexColors(surfaceColor, theme.secondary, 0.4);
    const artworkSize = compact ? 48 : ARTWORK_SIZE;
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
                    paddingVertical: compact ? 5.5 : 7.5,
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
                <Pressable
                    className="mr-3 flex-1 flex-row items-center"
                    onPressIn={() => {
                        longPressConsumedRef.current = false;
                    }}
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
                    style={({ pressed }) =>
                        pressed ? { opacity: 0.85 } : undefined
                    }
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                >
                    {canRenderArtwork ? (
                        <Image
                            source={{ uri: artworkUrl }}
                            className="mr-2 shrink-0 rounded bg-muted"
                            resizeMode="cover"
                            style={{
                                width: artworkSize,
                                aspectRatio: 1,
                                borderRadius: 4,
                                transform: [{ translateY: compact ? 2 : 4 }],
                            }}
                            onError={() => setArtworkFailed(true)}
                        />
                    ) : (
                        <View
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
                        className="flex-1 flex-col justify-center overflow-hidden"
                        style={
                            itemTags.length === 0
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
                        <View>
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

                        {itemTags.length > 0 ? (
                            <TagFadeRail tags={itemTags} compact={compact} />
                        ) : null}
                    </View>
                </Pressable>
            </Animated.View>

            {!selectionMode ? (
                <Animated.View
                    key="menu-control"
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

export function MusicListItemSkeleton({
    fullBleed = false,
    fullBleedHorizontalPadding = 24,
    compact = false,
}: {
    fullBleed?: boolean;
    fullBleedHorizontalPadding?: number;
    compact?: boolean;
}) {
    const artworkSize = compact ? 48 : ARTWORK_SIZE;
    return (
        <View
            className="relative flex-row items-center justify-between"
            style={{
                paddingVertical: compact ? 5.5 : 7.5,
                paddingHorizontal: fullBleed ? fullBleedHorizontalPadding : 0,
            }}
        >
            <View className="mr-3 flex-1 flex-row items-center overflow-hidden">
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
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        </View>
    );
}

function blendHexColors(
    background: string,
    foreground: string,
    opacity: number,
) {
    const backgroundRgb = hexToRgb(background);
    const foregroundRgb = hexToRgb(foreground);
    const channel = (backgroundValue: number, foregroundValue: number) =>
        Math.round(backgroundValue * (1 - opacity) + foregroundValue * opacity);

    return `rgb(${channel(backgroundRgb.red, foregroundRgb.red)}, ${channel(
        backgroundRgb.green,
        foregroundRgb.green,
    )}, ${channel(backgroundRgb.blue, foregroundRgb.blue)})`;
}

function hexToRgb(hex: string) {
    const normalized = hex.replace("#", "");
    return {
        red: Number.parseInt(normalized.slice(0, 2), 16),
        green: Number.parseInt(normalized.slice(2, 4), 16),
        blue: Number.parseInt(normalized.slice(4, 6), 16),
    };
}
