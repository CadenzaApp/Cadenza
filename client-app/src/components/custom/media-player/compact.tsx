import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, type ReactNode } from "react";
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import type { MusicItem } from "@apple-musickit";
import {
    ActivityIndicator,
    Pressable,
    View,
    type ColorValue,
} from "react-native";

import { Text } from "@/components/ui/text";
import { usePlayback } from "@/lib/playback";
import { COMPACT_PLAYER_HEIGHT } from "@/lib/screen-overlay-geometry";

type Props = {
    track: MusicItem;
    artwork?: ReactNode;
    nativeAccessory?: boolean;
    inline?: boolean;
    height?: number;
    isPlaying: boolean;
    isLoading: boolean;
    /** False while a live session's role does not allow play or pause. */
    canTogglePlayback?: boolean;
    canSkipToNext: boolean;
    /** The live session's name, shown in place of the artist. */
    liveLabel?: string | null;
    textColor: ColorValue;
    onExpand: () => void;
    onCollapse: () => void;
    onTogglePlayback: () => void;
    onSkipToNext: () => void;
};

/** Compact controls; the parent owns glass and the animated artwork. */
export function MediaPlayerCompact({
    track,
    artwork,
    nativeAccessory = false,
    inline = false,
    height = COMPACT_PLAYER_HEIGHT,
    isPlaying,
    isLoading,
    canTogglePlayback = true,
    canSkipToNext,
    liveLabel = null,
    textColor,
    onExpand,
    onCollapse,
    onTogglePlayback,
    onSkipToNext,
}: Props) {
    return (
        <View
            className={nativeAccessory ? "flex-1" : undefined}
            style={nativeAccessory ? undefined : { height }}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open now playing"
                onPress={onExpand}
                className="flex-1 flex-row items-center active:opacity-70"
                style={{ paddingHorizontal: (height - (inline ? 31 : 35)) / 2 }}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Collapse media player"
                    onPress={(event) => {
                        event.stopPropagation();
                        onCollapse();
                    }}
                >
                    {artwork ?? (
                        <View
                            style={{
                                width: inline ? 31 : 35,
                                height: inline ? 31 : 35,
                            }}
                        />
                    )}
                </Pressable>

                <View className="mx-3 flex-1 overflow-hidden">
                    <Text
                        className="text-sm font-semibold text-foreground"
                        numberOfLines={1}
                    >
                        {track.title || "Unknown Title"}
                    </Text>
                    {!inline ? (
                        <Text
                            className="mt-0.5 text-xs text-foreground"
                            numberOfLines={1}
                        >
                            {liveLabel !== null ? (
                                <>
                                    <Text className="text-xs font-bold text-brand">
                                        LIVE
                                    </Text>
                                    {` · ${liveLabel}`}
                                </>
                            ) : (
                                track.artistName || "Unknown Artist"
                            )}
                        </Text>
                    ) : null}
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
                    accessibilityState={{
                        busy: isLoading,
                        disabled: !canTogglePlayback,
                    }}
                    disabled={isLoading || !canTogglePlayback}
                    hitSlop={10}
                    onPress={(event) => {
                        event.stopPropagation();
                        onTogglePlayback();
                    }}
                    className={
                        canTogglePlayback
                            ? "h-10 w-10 items-center justify-center"
                            : "h-10 w-10 items-center justify-center opacity-30"
                    }
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

                {!inline ? (
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
                        className={
                            canSkipToNext
                                ? "h-10 w-10 items-center justify-center"
                                : "h-10 w-10 items-center justify-center opacity-30"
                        }
                    >
                        <Ionicons
                            name="play-skip-forward"
                            size={24}
                            color={textColor}
                        />
                    </Pressable>
                ) : null}
            </Pressable>
            {!inline ? (
                <CompactPlaybackProgress leftInset={(height - 35) / 2} />
            ) : null}
        </View>
    );
}

/** Isolate progress updates from the bar's controls and presentation geometry. */
function CompactPlaybackProgress({ leftInset }: { leftInset: number }) {
    const { activeTrack, progress, duration, isPlaying, isLoading } =
        usePlayback();
    const position = useSharedValue(progress);
    useEffect(() => {
        cancelAnimation(position);
        const confirmed = Math.max(0, Math.min(duration, progress));
        position.set(confirmed);
        if (isPlaying && !isLoading && duration > 0) {
            position.set(
                withTiming(Math.min(duration, confirmed + 0.8), {
                    duration: 800,
                    easing: Easing.linear,
                }),
            );
        }
        return () => cancelAnimation(position);
    }, [activeTrack?.id, progress, duration, isPlaying, isLoading, position]);
    const fillStyle = useAnimatedStyle(() => ({
        width: `${duration > 0 ? Math.max(0, Math.min(1, position.get() / duration)) * 100 : 0}%`,
    }));
    return (
        <View
            pointerEvents="none"
            className="absolute bottom-0 right-0 h-[2px] bg-foreground/20"
            style={{ left: Math.max(0, leftInset) }}
        >
            <Animated.View className="h-full bg-foreground" style={fillStyle} />
        </View>
    );
}
