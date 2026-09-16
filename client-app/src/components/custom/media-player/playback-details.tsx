import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem, SongFavoriteStatus } from "@apple-musickit";
import type { ReactNode } from "react";
import {
    ActivityIndicator,
    Image,
    Pressable,
    View,
    type ColorValue,
} from "react-native";

import { Text } from "@/components/ui/text";

/** Side of the artwork the heading shows when the queue is open. */
const COMPACT_ARTWORK_SIZE = 52;

function formatTime(totalSeconds: number) {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Title, artist, favorite, and the options button on one row.
 *
 * `compact` puts the artwork back on the left and shrinks the type. That is the
 * form the queue view uses, because the queue takes the space the full artwork
 * had.
 */
export function MediaPlayerTrackHeading({
    track,
    favoriteStatus,
    isFavoriteStatusLoading,
    isUpdatingFavorite,
    textColor,
    compact = false,
    onFavoriteToggle,
    onOpenMenu,
}: {
    track: MusicItem;
    favoriteStatus: SongFavoriteStatus | null | undefined;
    isFavoriteStatusLoading: boolean;
    isUpdatingFavorite: boolean;
    textColor: ColorValue;
    compact?: boolean;
    onFavoriteToggle: () => void;
    onOpenMenu: () => void;
}) {
    const artworkUrl = track.artworkUrl?.trim();
    const canRenderArtwork =
        compact &&
        typeof artworkUrl === "string" &&
        /^https?:\/\//i.test(artworkUrl);

    return (
        <View className="flex-row items-center gap-3">
            {canRenderArtwork ? (
                <Image
                    source={{ uri: artworkUrl }}
                    style={{
                        width: COMPACT_ARTWORK_SIZE,
                        height: COMPACT_ARTWORK_SIZE,
                    }}
                    className="rounded-lg bg-muted"
                />
            ) : null}

            <View className="flex-1">
                <Text
                    className={
                        compact
                            ? "text-lg font-bold text-foreground"
                            : "text-2xl font-bold text-foreground"
                    }
                    numberOfLines={1}
                >
                    {track.title || "Unknown Title"}
                </Text>
                <Text
                    className={
                        compact
                            ? "text-base text-muted-foreground"
                            : "mt-0.5 text-xl text-muted-foreground"
                    }
                    numberOfLines={1}
                >
                    {track.artistName || "Unknown Artist"}
                </Text>
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
                disabled={favoriteStatus === null || isFavoriteStatusLoading}
                onPress={onFavoriteToggle}
                className="h-11 w-11 items-center justify-center active:opacity-60"
            >
                {isFavoriteStatusLoading || isUpdatingFavorite ? (
                    <ActivityIndicator size="small" color={textColor} />
                ) : (
                    <Ionicons
                        name={
                            favoriteStatus?.isFavorite ? "star" : "star-outline"
                        }
                        size={26}
                        color={textColor}
                    />
                )}
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Song options"
                onPress={onOpenMenu}
                className="h-11 w-11 items-center justify-center active:opacity-60"
            >
                <Ionicons
                    name="ellipsis-horizontal"
                    size={26}
                    color={textColor}
                />
            </Pressable>
        </View>
    );
}

/**
 * The scrubber and its two timestamps. The control itself is a prop because the
 * gesture driving it needs state this component does not hold.
 */
export function MediaPlayerProgress({
    progress,
    duration,
    progressControl,
}: {
    progress: number;
    duration: number;
    progressControl: ReactNode;
}) {
    const remaining = Math.max(0, duration - progress);

    return (
        <View>
            {progressControl}
            <View className="flex-row justify-between">
                <Text className="text-xs text-muted-foreground">
                    {formatTime(progress)}
                </Text>
                <Text className="text-xs text-muted-foreground">
                    -{formatTime(remaining)}
                </Text>
            </View>
        </View>
    );
}
