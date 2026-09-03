import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import {
    ActivityIndicator,
    Image,
    Pressable,
    View,
    type ColorValue,
} from "react-native";

import { Text } from "@/components/ui/text";
import { COMPACT_PLAYER_HEIGHT } from "@/lib/screen-overlay";

type Props = {
    track: MusicItem;
    artworkUrl?: string;
    canRenderArtwork: boolean;
    isPlaying: boolean;
    isLoading: boolean;
    canSkipToNext: boolean;
    bottom: number;
    textColor: ColorValue;
    onExpand: () => void;
    onArtworkError: () => void;
    onTogglePlayback: () => void;
    onSkipToNext: () => void;
};

export function MediaPlayerCompact({
    track,
    artworkUrl,
    canRenderArtwork,
    isPlaying,
    isLoading,
    canSkipToNext,
    bottom,
    textColor,
    onExpand,
    onArtworkError,
    onTogglePlayback,
    onSkipToNext,
}: Props) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open now playing"
            onPress={onExpand}
            className="absolute left-3 right-3 rounded-xl border border-border bg-card flex-row items-center px-3"
            style={{
                bottom,
                height: COMPACT_PLAYER_HEIGHT,
                shadowColor: "#000",
                shadowOpacity: 0.18,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 3 },
                elevation: 8,
            }}
        >
            {canRenderArtwork ? (
                <Image
                    source={{ uri: artworkUrl }}
                    className="w-11 h-11 rounded-md bg-muted"
                    onError={onArtworkError}
                />
            ) : (
                <View className="w-11 h-11 rounded-md bg-muted items-center justify-center">
                    <Ionicons
                        name="musical-notes"
                        size={18}
                        color={textColor}
                    />
                </View>
            )}

            <View className="flex-1 mx-3 overflow-hidden">
                <Text
                    className="text-sm font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {track.title || "Unknown Title"}
                </Text>
                <Text
                    className="text-xs text-muted-foreground mt-0.5"
                    numberOfLines={1}
                >
                    {track.artistName || "Unknown Artist"}
                </Text>
            </View>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                    isLoading ? "Loading song" : isPlaying ? "Pause" : "Play"
                }
                accessibilityState={{ busy: isLoading }}
                disabled={isLoading}
                hitSlop={10}
                onPress={(event) => {
                    event.stopPropagation();
                    onTogglePlayback();
                }}
                className="w-10 h-10 items-center justify-center"
            >
                {isLoading ? (
                    <ActivityIndicator size="small" color={textColor} />
                ) : (
                    <Ionicons
                        name={isPlaying ? "pause" : "play"}
                        size={26}
                        color={textColor}
                        style={{ marginLeft: isPlaying ? 0 : 2 }}
                    />
                )}
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Skip to next"
                accessibilityState={{ disabled: !canSkipToNext }}
                disabled={!canSkipToNext}
                hitSlop={10}
                onPress={(event) => {
                    event.stopPropagation();
                    onSkipToNext();
                }}
                className={`w-10 h-10 items-center justify-center ${canSkipToNext ? "" : "opacity-30"}`}
            >
                <Ionicons
                    name="play-skip-forward"
                    size={24}
                    color={textColor}
                />
            </Pressable>
        </Pressable>
    );
}
