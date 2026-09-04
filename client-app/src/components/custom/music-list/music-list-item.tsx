import { useRef, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
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
import Svg, {
    Defs,
    LinearGradient as SvgGradient,
    Rect,
    Stop,
} from "react-native-svg";

import type { MusicItem } from "@apple-musickit";

import { TagPill } from "@/components/custom/tag-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import type { Tag } from "@/lib/types";
import { cn } from "@/lib/utils";

type MusicListItemProps = {
    item: MusicItem;
    tags?: Tag[];
    selected: boolean;
    selectionMode: boolean;
    multiSelectEnabled: boolean;
    fullBleed?: boolean;
    onPress: (item: MusicItem) => void;
    onLongPress?: (item: MusicItem) => void;
    onOpenMenu: (item: MusicItem) => void;
};

export function MusicListItem({
    item,
    tags,
    selected,
    selectionMode,
    multiSelectEnabled,
    fullBleed = false,
    onPress,
    onLongPress,
    onOpenMenu,
}: MusicListItemProps) {
    const { colors } = useTheme();
    const { colorScheme } = useColorScheme();
    const [artworkFailed, setArtworkFailed] = useState(false);
    const longPressConsumedRef = useRef(false);
    const itemTags = tags ?? [];
    const artworkUrl = item.artworkUrl?.trim();
    const canRenderArtwork =
        !artworkFailed &&
        typeof artworkUrl === "string" &&
        /^https?:\/\//i.test(artworkUrl);
    const selectionColor = `${
        THEME[colorScheme === "dark" ? "dark" : "light"].secondary
    }66`;
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
    const animatedContentStyle = useAnimatedStyle(
        () => ({
            marginLeft: withTiming(selectionMode ? (fullBleed ? 28 : 52) : 0, {
                duration: 200,
                easing: Easing.out(Easing.cubic),
            }),
        }),
        [fullBleed, selectionMode],
    );

    return (
        <Animated.View
            className={cn(
                "relative flex-row items-center justify-between py-3",
                fullBleed ? "px-6" : "border-b border-border",
            )}
            style={animatedRowStyle}
        >
            {fullBleed ? (
                <View className="absolute bottom-0 left-6 right-6 border-b border-border" />
            ) : null}
            {selectionMode ? (
                <View
                    className={cn(
                        "absolute bottom-0 top-0 z-10 justify-center",
                        fullBleed ? "left-1" : "left-0",
                    )}
                >
                    <Animated.View
                        key="selection-control"
                        entering={FadeInLeft.duration(180).easing(
                            Easing.out(Easing.cubic),
                        )}
                        exiting={FadeOutLeft.duration(120)}
                    >
                        <Button
                            size="icon"
                            className="h-11 w-11 shrink-0 rounded-full"
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
                    className="flex-1 flex-row items-center mr-3 overflow-hidden"
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
                            className="w-14 h-14 shrink-0 aspect-square rounded bg-muted mr-3"
                            onError={() => setArtworkFailed(true)}
                        />
                    ) : (
                        <View className="w-14 h-14 shrink-0 aspect-square rounded bg-muted mr-3 items-center justify-center">
                            <Text className="text-xs text-muted-foreground text-center">
                                No Art
                            </Text>
                        </View>
                    )}

                    <View className="flex-1 flex-col justify-center gap-1.5 overflow-hidden">
                        <View>
                            <Text
                                className="text-base font-bold text-foreground leading-tight"
                                numberOfLines={1}
                            >
                                {item.title}
                            </Text>
                            <Text
                                className="text-sm text-muted-foreground mt-0.5 leading-tight"
                                numberOfLines={1}
                            >
                                {item.artistName}
                            </Text>
                        </View>

                        {itemTags.length > 0 && (
                            <View className="relative">
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={{
                                        gap: 6,
                                        paddingRight: 24,
                                    }}
                                >
                                    {itemTags.map((tag) => (
                                        <TagPill
                                            key={tag.id}
                                            tag={tag}
                                            height={10}
                                        />
                                    ))}
                                </ScrollView>
                                <View
                                    pointerEvents="none"
                                    style={{
                                        position: "absolute",
                                        right: 0,
                                        top: 0,
                                        bottom: 0,
                                        width: 24,
                                    }}
                                >
                                    <Svg width="100%" height="100%">
                                        <Defs>
                                            <SvgGradient
                                                id={`tags-fade-${item.id}`}
                                                x1="0%"
                                                y1="0%"
                                                x2="100%"
                                                y2="0%"
                                            >
                                                <Stop
                                                    offset="0%"
                                                    stopColor={
                                                        colors.background
                                                    }
                                                    stopOpacity={0}
                                                />
                                                <Stop
                                                    offset="100%"
                                                    stopColor={
                                                        colors.background
                                                    }
                                                    stopOpacity={1}
                                                />
                                            </SvgGradient>
                                        </Defs>
                                        <Rect
                                            x="0"
                                            y="0"
                                            width="100%"
                                            height="100%"
                                            fill={`url(#tags-fade-${item.id})`}
                                        />
                                    </Svg>
                                </View>
                            </View>
                        )}
                    </View>
                </Pressable>
            </Animated.View>

            {!selectionMode ? (
                <Animated.View
                    key="menu-control"
                    entering={FadeIn.duration(160)}
                    exiting={FadeOut.duration(100)}
                >
                    <Button
                        size="icon"
                        className="h-11 w-11 shrink-0 rounded-full"
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
}

export function MusicListItemSkeleton({
    fullBleed = false,
}: {
    fullBleed?: boolean;
}) {
    return (
        <View
            className={cn(
                "relative flex-row items-center justify-between py-3",
                fullBleed ? "px-6" : "border-b border-border",
            )}
        >
            {fullBleed ? (
                <View className="absolute bottom-0 left-6 right-6 border-b border-border" />
            ) : null}
            <View className="flex-1 flex-row items-center mr-3 overflow-hidden">
                <Skeleton className="w-14 h-14 shrink-0 aspect-square rounded mr-3" />
                <View className="flex-1 flex-col justify-center gap-2 overflow-hidden">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                </View>
            </View>
            <Skeleton className="h-11 w-11 rounded-full shrink-0" />
        </View>
    );
}
