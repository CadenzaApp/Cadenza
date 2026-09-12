import Ionicons from "@expo/vector-icons/Ionicons";
import { ShuffleMode } from "@apple-musickit";
import {
    ActivityIndicator,
    Pressable,
    View,
    type ColorValue,
} from "react-native";

/**
 * The bottom row: shuffle, skip, play, skip, queue.
 *
 * Repeat is not here. It lives on the queue view, next to shuffle, which is
 * where Apple Music keeps it and what leaves the bottom-right slot for the
 * queue button.
 */
export function MediaPlayerTransport({
    isPlaying,
    isLoading,
    canSkipToNext,
    canSkipToPrevious,
    shuffleMode,
    queueOpen,
    textColor,
    accentColor,
    onTogglePlayback,
    onSkipToNext,
    onSkipToPrevious,
    onToggleShuffle,
    onToggleQueue,
}: {
    isPlaying: boolean;
    isLoading: boolean;
    canSkipToNext: boolean;
    canSkipToPrevious: boolean;
    shuffleMode: ShuffleMode;
    queueOpen: boolean;
    textColor: ColorValue;
    accentColor: ColorValue;
    onTogglePlayback: () => void;
    onSkipToNext: () => void;
    onSkipToPrevious: () => void;
    onToggleShuffle: () => void;
    onToggleQueue: () => void;
}) {
    const shuffleOn = shuffleMode !== ShuffleMode.Off;

    return (
        <View className="flex-row items-center justify-between px-2">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Shuffle"
                accessibilityState={{ selected: shuffleOn }}
                onPress={onToggleShuffle}
                className="h-12 w-12 items-center justify-center active:opacity-60"
            >
                <Ionicons
                    name="shuffle"
                    size={24}
                    color={shuffleOn ? accentColor : textColor}
                />
            </Pressable>
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
                accessibilityState={{ busy: isLoading }}
                disabled={isLoading}
                onPress={onTogglePlayback}
                className="h-20 w-20 items-center justify-center active:opacity-60"
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
