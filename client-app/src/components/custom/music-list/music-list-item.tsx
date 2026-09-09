import { useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
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
import type { Tag } from "@/lib/types";

type MusicListItemProps = {
    item: MusicItem;
    isThisTrackPlaying: boolean;
    onTogglePlayback: (track: MusicItem) => void;
    tags?: Tag[];
    onPress?: (item: MusicItem) => void;
};

export function MusicListItem({
    item,
    isThisTrackPlaying,
    onTogglePlayback,
    tags,
    onPress,
}: MusicListItemProps) {
    const { colors } = useTheme();
    const [artworkFailed, setArtworkFailed] = useState(false);
    const itemTags = tags ?? [];
    const artworkUrl = item.artworkUrl?.trim();
    const canRenderArtwork =
        !artworkFailed &&
        typeof artworkUrl === "string" &&
        /^https?:\/\//i.test(artworkUrl);

    return (
        <View className="flex-row items-center justify-between py-3 border-b border-border">
            <Pressable
                className="flex-1 flex-row items-center mr-3 overflow-hidden"
                onPress={() => onPress?.(item)}
                disabled={!onPress}
                style={({ pressed }) =>
                    pressed ? { opacity: 0.85 } : undefined
                }
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
                                                stopColor={colors.background}
                                                stopOpacity={0}
                                            />
                                            <Stop
                                                offset="100%"
                                                stopColor={colors.background}
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

            <Button
                size="icon"
                className="h-11 w-11 rounded-full shrink-0"
                onPress={() => onTogglePlayback(item)}
                variant={isThisTrackPlaying ? "secondary" : "default"}
                accessibilityLabel={
                    isThisTrackPlaying
                        ? `Pause ${item.title}`
                        : `Play ${item.title}`
                }
            >
                <Ionicons
                    name={isThisTrackPlaying ? "pause" : "play"}
                    size={22}
                    style={{ marginLeft: isThisTrackPlaying ? 0 : 3 }}
                />
            </Button>
        </View>
    );
}

export function MusicListItemSkeleton() {
    return (
        <View className="flex-row items-center justify-between py-3 border-b border-border">
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
