import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import type { MusicItem } from "@apple-musickit";
import {
    ActivityIndicator,
    Pressable,
    View,
    type ColorValue,
} from "react-native";

import { Text } from "@/components/ui/text";

type Props = {
    track: MusicItem;
    artwork?: ReactNode;
    nativeAccessory?: boolean;
    inline?: boolean;
    height?: number;
    isPlaying: boolean;
    isLoading: boolean;
    canSkipToNext: boolean;
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
    height = 48,
    isPlaying,
    isLoading,
    canSkipToNext,
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
                className="flex-1 flex-row items-center px-3 active:opacity-70"
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Collapse media player"
                    onPress={(event) => {
                        event.stopPropagation();
                        onCollapse();
                    }}
                >
                    {artwork ?? <View className="h-8 w-8" />}
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
                            {track.artistName || "Unknown Artist"}
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
                    accessibilityState={{ busy: isLoading }}
                    disabled={isLoading}
                    hitSlop={10}
                    onPress={(event) => {
                        event.stopPropagation();
                        onTogglePlayback();
                    }}
                    className="h-10 w-10 items-center justify-center"
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
        </View>
    );
}
