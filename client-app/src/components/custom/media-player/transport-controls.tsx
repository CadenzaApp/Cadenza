import Ionicons from "@expo/vector-icons/Ionicons";
import {
    ActivityIndicator,
    Pressable,
    View,
    type ColorValue,
} from "react-native";

export function MediaPlayerTransport({
    isPlaying,
    isLoading,
    canSkipToNext,
    canSkipToPrevious,
    textColor,
    controlColor,
    onTogglePlayback,
    onSkipToNext,
    onSkipToPrevious,
    onUnavailable,
}: {
    isPlaying: boolean;
    isLoading: boolean;
    canSkipToNext: boolean;
    canSkipToPrevious: boolean;
    textColor: ColorValue;
    controlColor: ColorValue;
    onTogglePlayback: () => void;
    onSkipToNext: () => void;
    onSkipToPrevious: () => void;
    onUnavailable: (feature: string, futureBehavior: string) => void;
}) {
    return (
        <View className="flex-row items-center justify-between px-2">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Shuffle"
                onPress={() =>
                    onUnavailable(
                        "Shuffle",
                        "It will randomize the current playback queue.",
                    )
                }
                className="w-12 h-12 items-center justify-center"
            >
                <Ionicons name="shuffle" size={24} color={textColor} />
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous track"
                accessibilityState={{ disabled: !canSkipToPrevious }}
                disabled={!canSkipToPrevious}
                onPress={onSkipToPrevious}
                className={`w-14 h-14 items-center justify-center ${canSkipToPrevious ? "" : "opacity-30"}`}
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
                className="w-20 h-20 rounded-full bg-primary items-center justify-center"
            >
                {isLoading ? (
                    <ActivityIndicator size="large" color={controlColor} />
                ) : (
                    <Ionicons
                        name={isPlaying ? "pause" : "play"}
                        size={38}
                        color={controlColor}
                        style={{ marginLeft: isPlaying ? 0 : 4 }}
                    />
                )}
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next track"
                accessibilityState={{ disabled: !canSkipToNext }}
                disabled={!canSkipToNext}
                onPress={onSkipToNext}
                className={`w-14 h-14 items-center justify-center ${canSkipToNext ? "" : "opacity-30"}`}
            >
                <Ionicons
                    name="play-skip-forward"
                    size={31}
                    color={textColor}
                />
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Repeat"
                onPress={() =>
                    onUnavailable(
                        "Repeat",
                        "It will cycle repeat modes for the current playback queue.",
                    )
                }
                className="w-12 h-12 items-center justify-center"
            >
                <Ionicons name="repeat" size={24} color={textColor} />
            </Pressable>
        </View>
    );
}
