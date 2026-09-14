import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    View,
    type ColorValue,
} from "react-native";
import Animated, {
    interpolate,
    useAnimatedStyle,
    type SharedValue,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";

const COMPACT_PLAYER_RADIUS = 22;
const ARTWORK_SIZE = { floating: 44, docked: 38 } as const;
const SKIP_WIDTH = 40;

/** Where the bar sits in one of its two states. Both come from the caller. */
export type PlayerRect = {
    bottom: number;
    /** Gap on each side. Docked, this is what clears the tabs it leaves alone. */
    inset: number;
    height: number;
};

type Props = {
    track: MusicItem;
    artworkUrl?: string;
    canRenderArtwork: boolean;
    isPlaying: boolean;
    isLoading: boolean;
    canSkipToNext: boolean;
    floatingRect: PlayerRect;
    dockedRect: PlayerRect;
    /** 0 floating above the tab bar, 1 docked inside it. */
    dockProgress: SharedValue<number>;
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
    floatingRect,
    dockedRect,
    dockProgress,
    textColor,
    onExpand,
    onArtworkError,
    onTogglePlayback,
    onSkipToNext,
}: Props) {
    // Every one of these reads `dockProgress.value` itself rather than through a
    // shared helper. Reanimated works out what a style depends on from what its
    // own body touches, so a helper in between leaves the style frozen.
    const barStyle = useAnimatedStyle(() => {
        const p = dockProgress.value;
        return {
            bottom: interpolate(
                p,
                [0, 1],
                [floatingRect.bottom, dockedRect.bottom],
            ),
            left: interpolate(
                p,
                [0, 1],
                [floatingRect.inset, dockedRect.inset],
            ),
            right: interpolate(
                p,
                [0, 1],
                [floatingRect.inset, dockedRect.inset],
            ),
            height: interpolate(
                p,
                [0, 1],
                [floatingRect.height, dockedRect.height],
            ),
        };
    });

    const artworkStyle = useAnimatedStyle(() => {
        const size = interpolate(
            dockProgress.value,
            [0, 1],
            [ARTWORK_SIZE.floating, ARTWORK_SIZE.docked],
        );
        return { width: size, height: size };
    });

    // Docked, the bar is three tab slots wide. Skip is what gives way.
    const skipStyle = useAnimatedStyle(() => {
        const p = dockProgress.value;
        return {
            width: interpolate(p, [0, 1], [SKIP_WIDTH, 0]),
            opacity: interpolate(p, [0, 1], [1, 0]),
        };
    });

    return (
        <Animated.View
            style={[
                {
                    position: "absolute",
                    borderRadius: COMPACT_PLAYER_RADIUS,
                    shadowColor: "#000",
                    shadowOpacity: 0.18,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 3 },
                    elevation: 8,
                },
                barStyle,
            ]}
        >
            {/* Background layer rather than a background color, so the bar is
                translucent. It clips itself, which is why it cannot be the
                same view as the shadow above. */}
            <GlassSurface
                style={[
                    StyleSheet.absoluteFill,
                    {
                        borderRadius: COMPACT_PLAYER_RADIUS,
                        overflow: "hidden",
                    },
                ]}
            />

            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open now playing"
                onPress={onExpand}
                className="flex-1 flex-row items-center px-3"
            >
                {canRenderArtwork ? (
                    <Animated.Image
                        source={{ uri: artworkUrl }}
                        className="rounded-md bg-muted"
                        style={artworkStyle}
                        onError={onArtworkError}
                    />
                ) : (
                    <Animated.View
                        className="rounded-md bg-muted items-center justify-center"
                        style={artworkStyle}
                    >
                        <Ionicons
                            name="musical-notes"
                            size={18}
                            color={textColor}
                        />
                    </Animated.View>
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
                        isLoading
                            ? "Loading song"
                            : isPlaying
                              ? "Pause"
                              : "Play"
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
                <Animated.View
                    className="h-10 items-center justify-center overflow-hidden"
                    style={skipStyle}
                >
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
                </Animated.View>
            </Pressable>
        </Animated.View>
    );
}
