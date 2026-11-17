import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import {
    ActivityIndicator,
    Pressable,
    View,
    type ColorValue,
} from "react-native";

/**
 * The bottom row: `leading` (the LIVE button), skip, play, skip, queue.
 *
 * Shuffle and repeat are not here. They live on the queue view, which is
 * where Apple Music keeps them.
 */
export function MediaPlayerTransport({
    isPlaying,
    isLoading,
    canTogglePlayback = true,
    canSkipToNext,
    canSkipToPrevious,
    leading,
    queueOpen,
    textColor,
    accentColor,
    onTogglePlayback,
    onSkipToNext,
    onSkipToPrevious,
    onToggleQueue,
}: {
    isPlaying: boolean;
    isLoading: boolean;
    /** False while a live session's role does not allow play or pause. */
    canTogglePlayback?: boolean;
    canSkipToNext: boolean;
    canSkipToPrevious: boolean;
    /** The left slot, 48pt tall. */
    leading: ReactNode;
    queueOpen: boolean;
    textColor: ColorValue;
    accentColor: ColorValue;
    onTogglePlayback: () => void;
    onSkipToNext: () => void;
    onSkipToPrevious: () => void;
    onToggleQueue: () => void;
}) {
    return (
        <View className="flex-row items-center justify-between px-2">
            {leading}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous track"
                accessibilityState={{ disabled: !canSkipToPrevious }}
                disabled={!canSkipToPrevious}
                onPress={onSkipToPrevious}
                className={`h-14 w-14 items-center justify-center active:opacity-60 ${canSkipToPrevious ? "" : "opacity-30"}`}
            >
                <Ionicons name="play-skip-back" size={31} color={textColor} />
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                    isLoading ? "Loading song" : isPlaying ? "Pause" : "Play"
                }
                accessibilityState={{
                    busy: isLoading,
                    disabled: !canTogglePlayback,
                }}
                disabled={isLoading || !canTogglePlayback}
                onPress={onTogglePlayback}
                className={`h-20 w-20 items-center justify-center active:opacity-60 ${canTogglePlayback ? "" : "opacity-30"}`}
            >
                {isLoading ? (
                    <ActivityIndicator size="large" color={textColor} />
                ) : (
                    <Ionicons
                        name={isPlaying ? "pause" : "play"}
                        size={52}
                        color={textColor}
                    />
                )}
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next track"
                accessibilityState={{ disabled: !canSkipToNext }}
                disabled={!canSkipToNext}
                onPress={onSkipToNext}
                className={`h-14 w-14 items-center justify-center active:opacity-60 ${canSkipToNext ? "" : "opacity-30"}`}
            >
                <Ionicons
                    name="play-skip-forward"
                    size={31}
                    color={textColor}
                />
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={queueOpen ? "Hide queue" : "Show queue"}
                accessibilityState={{ selected: queueOpen }}
                onPress={onToggleQueue}
                className="h-12 w-12 items-center justify-center active:opacity-60"
            >
                <Ionicons
                    name="list"
                    size={26}
                    color={queueOpen ? accentColor : textColor}
                />
            </Pressable>
        </View>
    );
}
