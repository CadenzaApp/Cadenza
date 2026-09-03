import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem, SongFavoriteStatus } from "@apple-musickit";
import type { ReactNode } from "react";
import {
    ActivityIndicator,
    Pressable,
    View,
    type ColorValue,
} from "react-native";

import { Text } from "@/components/ui/text";

function formatTime(totalSeconds: number) {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function MediaPlayerPlaybackDetails({
    width,
    track,
    favoriteStatus,
    isFavoriteStatusLoading,
    isUpdatingFavorite,
    progress,
    duration,
    progressControl,
    textColor,
    onFavoriteToggle,
    onShare,
    onUnavailable,
}: {
    width: number;
    track: MusicItem;
    favoriteStatus: SongFavoriteStatus | null | undefined;
    isFavoriteStatusLoading: boolean;
    isUpdatingFavorite: boolean;
    progress: number;
    duration: number;
    progressControl: ReactNode;
    textColor: ColorValue;
    onFavoriteToggle: () => void;
    onShare: () => void;
    onUnavailable: (feature: string, futureBehavior: string) => void;
}) {
    return (
        <View style={{ width }} className="pr-1">
            <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                    <Text
                        className="text-2xl font-bold text-foreground"
                        numberOfLines={2}
                    >
                        {track.title || "Unknown Title"}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Artist page"
                        onPress={() =>
                            onUnavailable(
                                "Artist navigation",
                                "It will open this artist's page when artist profiles are available.",
                            )
                        }
                    >
                        <Text
                            className="text-base text-muted-foreground mt-1"
                            numberOfLines={1}
                        >
                            {track.artistName || "Unknown Artist"}
                        </Text>
                    </Pressable>
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        favoriteStatus?.isFavorite
                            ? "Remove song from favorites"
                            : "Add song to favorites"
                    }
                    accessibilityState={{
                        busy: isFavoriteStatusLoading || isUpdatingFavorite,
                        disabled:
                            favoriteStatus === null || isFavoriteStatusLoading,
                        selected: favoriteStatus?.isFavorite ?? false,
                    }}
                    disabled={
                        favoriteStatus === null || isFavoriteStatusLoading
                    }
                    onPress={onFavoriteToggle}
                    className="w-11 h-11 self-center items-center justify-center"
                >
                    {isFavoriteStatusLoading || isUpdatingFavorite ? (
                        <ActivityIndicator size="small" color={textColor} />
                    ) : (
                        <Ionicons
                            name={
                                favoriteStatus?.isFavorite
                                    ? "star"
                                    : "star-outline"
                            }
                            size={28}
                            color={textColor}
                        />
                    )}
                </Pressable>
            </View>

            {progressControl}
            <View className="flex-row justify-between">
                <Text className="text-xs text-muted-foreground">
                    {formatTime(progress)}
                </Text>
                <Text className="text-xs text-muted-foreground">
                    {formatTime(duration)}
                </Text>
            </View>
            <View className="flex-row justify-center gap-12 mt-5">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Share song"
                    onPress={onShare}
                    className="w-12 h-12 rounded-full bg-secondary items-center justify-center"
                >
                    <Ionicons
                        name="share-outline"
                        size={23}
                        color={textColor}
                    />
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Manage queue"
                    onPress={() =>
                        onUnavailable(
                            "Queue management",
                            "It will let you view and reorder upcoming tracks.",
                        )
                    }
                    className="w-12 h-12 rounded-full bg-secondary items-center justify-center"
                >
                    <Ionicons name="list-outline" size={25} color={textColor} />
                </Pressable>
            </View>
        </View>
    );
}
