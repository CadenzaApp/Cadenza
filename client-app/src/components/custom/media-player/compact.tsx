import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import {
    ActivityIndicator,
    Image,
    Pressable,
    StyleSheet,
    View,
    type ColorValue,
} from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";

export type MediaPlayerPlacement = "regular" | "inline";

type Props = {
    track: MusicItem;
    placement: MediaPlayerPlacement;
    standalone?: boolean;
    artworkUrl?: string;
    canRenderArtwork: boolean;
    isPlaying: boolean;
    isLoading: boolean;
    canSkipToNext: boolean;
    textColor: ColorValue;
    onExpand: () => void;
    onArtworkError: () => void;
    onTogglePlayback: () => void;
    onSkipToNext: () => void;
};

/** The content rendered in either native bottom-accessory placement. */
export function MediaPlayerCompact({
    track,
    placement,
    standalone = false,
    artworkUrl,
    canRenderArtwork,
    isPlaying,
    isLoading,
    canSkipToNext,
    textColor,
    onExpand,
    onArtworkError,
    onTogglePlayback,
    onSkipToNext,
}: Props) {
    const inline = placement === "inline";
    const artworkSize = inline ? 32 : 44;

    return (
        <View
            className={
                standalone ? "overflow-hidden rounded-[22px]" : undefined
            }
            // UIKit owns the native accessory's height and can change it while
            // transitioning between placements. Only the compatibility player
            // needs a fixed height.
            style={standalone ? styles.standalone : styles.nativeAccessory}
        >
            {standalone ? (
                <GlassSurface
                    style={[
                        StyleSheet.absoluteFill,
                        { borderRadius: 22, overflow: "hidden" },
                    ]}
                />
            ) : null}

            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open now playing"
                onPress={onExpand}
                className="flex-1 flex-row items-center px-3 active:opacity-70"
            >
                {canRenderArtwork ? (
                    <Image
                        source={{ uri: artworkUrl }}
                        className="rounded-md bg-muted"
                        style={{ width: artworkSize, height: artworkSize }}
                        onError={onArtworkError}
                    />
                ) : (
                    <View
                        className="items-center justify-center rounded-md bg-muted"
                        style={{ width: artworkSize, height: artworkSize }}
                    >
                        <Ionicons
                            name="musical-notes"
                            size={inline ? 16 : 18}
                            color={textColor}
                        />
                    </View>
                )}

                <View className="mx-3 flex-1 overflow-hidden">
                    <Text
                        className="text-sm font-semibold text-foreground"
                        numberOfLines={1}
                    >
                        {track.title || "Unknown Title"}
                    </Text>
                    {inline ? null : (
                        <Text
                            className="mt-0.5 text-xs text-muted-foreground"
                            numberOfLines={1}
                        >
                            {track.artistName || "Unknown Artist"}
                        </Text>
                    )}
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
                            size={inline ? 22 : 26}
                            color={textColor}
                            style={{ marginLeft: isPlaying ? 0 : 2 }}
                        />
                    )}
                </Pressable>

                {inline ? null : (
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
                )}
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    nativeAccessory: { flex: 1 },
    standalone: { height: 64 },
});
