import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useMemo, useState } from "react";
import {
    Image,
    Modal,
    PanResponder,
    Pressable,
    useWindowDimensions,
    View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    cancelAnimation,
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui/text";
import { usePlayback } from "@/lib/playback";

function formatTime(totalSeconds: number) {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * A global Apple Music player surface. Core playback commands call the native
 * MusicKit module; library, artist, shuffle, and repeat actions intentionally
 * log their future behavior until those product features are implemented.
 */
export function MediaPlayer() {
    const {
        activeTrack,
        isPlaying,
        progress,
        seekTo,
        skipToNext,
        skipToPrevious,
        togglePlayback,
    } = usePlayback();
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const [isExpanded, setIsExpanded] = useState(false);
    const sheetTranslateY = useSharedValue(0);
    const [progressBarWidth, setProgressBarWidth] = useState(0);
    const [scrubPosition, setScrubPosition] = useState<number | null>(null);
    const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(
        null,
    );

    const artworkUrl = activeTrack?.artworkUrl?.trim();
    const fullArtworkUrl = activeTrack?.artworkUrlLarge?.trim() || artworkUrl;
    const canRenderArtwork =
        typeof artworkUrl === "string" &&
        artworkUrl !== failedArtworkUrl &&
        /^https?:\/\//i.test(artworkUrl);
    const canRenderFullArtwork =
        typeof fullArtworkUrl === "string" &&
        fullArtworkUrl !== failedArtworkUrl &&
        /^https?:\/\//i.test(fullArtworkUrl);
    const duration = activeTrack?.songDuration ?? 0;
    const displayedProgress = scrubPosition ?? progress;
    const progressRatio =
        duration > 0 ? Math.min(displayedProgress / duration, 1) : 0;
    const artworkSize = Math.min(width - 48, 420);

    function completeDismissal() {
        setIsExpanded(false);
    }

    function expandPlayer() {
        // Render the transparent modal with its sheet just below the viewport,
        // then bring it into place on the next frame entirely on the UI thread.
        sheetTranslateY.set(height);
        setIsExpanded(true);
        requestAnimationFrame(() => {
            sheetTranslateY.set(
                withTiming(0, {
                    duration: 360,
                    easing: Easing.out(Easing.cubic),
                }),
            );
        });
    }

    const sheetStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: sheetTranslateY.get() }],
    }));

    const dismissExpandedPlayer = Gesture.Tap().onEnd(() => {
        sheetTranslateY.set(
            withTiming(
                height,
                {
                    duration: 420,
                    easing: Easing.out(Easing.cubic),
                },
                (finished) => {
                    if (finished) runOnJS(completeDismissal)();
                },
            ),
        );
    });

    const dragSheet = Gesture.Pan()
        .activeOffsetY(2)
        .onBegin(() => {
            cancelAnimation(sheetTranslateY);
        })
        .onUpdate((event) => {
            sheetTranslateY.set(Math.max(0, event.translationY));
        })
        .onEnd((event) => {
            const dragDistance = Math.max(0, event.translationY);
            const shouldDismiss =
                dragDistance > height * 0.18 || event.velocityY > 800;

            if (shouldDismiss) {
                const remainingDistance = Math.max(0, height - dragDistance);
                sheetTranslateY.set(
                    withTiming(
                        height,
                        {
                            duration: Math.max(
                                180,
                                (remainingDistance / height) * 420,
                            ),
                            easing: Easing.out(Easing.cubic),
                        },
                        (finished) => {
                            if (finished) runOnJS(completeDismissal)();
                        },
                    ),
                );
                return;
            }

            sheetTranslateY.set(
                withSpring(0, {
                    damping: 20,
                    stiffness: 220,
                }),
            );
        });

    const sheetGesture = Gesture.Exclusive(dragSheet, dismissExpandedPlayer);

    const seekResponder = useMemo(() => {
        function timeAtLocation(locationX: number) {
            if (!duration || !progressBarWidth) return null;
            return (
                (Math.max(0, Math.min(locationX, progressBarWidth)) /
                    progressBarWidth) *
                duration
            );
        }

        function updateScrubPosition(locationX: number) {
            const nextPosition = timeAtLocation(locationX);
            if (nextPosition !== null) setScrubPosition(nextPosition);
        }

        return PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderGrant: (event) => {
                updateScrubPosition(event.nativeEvent.locationX);
            },
            onPanResponderMove: (event) => {
                updateScrubPosition(event.nativeEvent.locationX);
            },
            onPanResponderRelease: (event) => {
                const time = timeAtLocation(event.nativeEvent.locationX);
                setScrubPosition(null);
                if (time !== null) void seekTo(time);
            },
            onPanResponderTerminate: () => {
                setScrubPosition(null);
            },
        });
    }, [duration, progressBarWidth, seekTo, setScrubPosition]);

    if (!activeTrack) return null;

    function handleNoOp(feature: string, futureBehavior: string) {
        console.info(
            `[MediaPlayer] ${feature} is not available yet. ${futureBehavior}`,
        );
    }

    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open now playing"
                onPress={expandPlayer}
                className="absolute left-3 right-3 rounded-xl border border-border bg-card flex-row items-center px-3"
                style={{
                    bottom: insets.bottom + 54,
                    height: 64,
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
                        onError={() => setFailedArtworkUrl(artworkUrl)}
                    />
                ) : (
                    <View className="w-11 h-11 rounded-md bg-muted items-center justify-center">
                        <Ionicons
                            name="musical-notes"
                            size={18}
                            color={colors.text}
                        />
                    </View>
                )}

                <View className="flex-1 mx-3 overflow-hidden">
                    <Text
                        className="text-sm font-semibold text-foreground"
                        numberOfLines={1}
                    >
                        {activeTrack.title || "Unknown Title"}
                    </Text>
                    <Text
                        className="text-xs text-muted-foreground mt-0.5"
                        numberOfLines={1}
                    >
                        {activeTrack.artistName || "Unknown Artist"}
                    </Text>
                </View>

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={isPlaying ? "Pause" : "Play"}
                    hitSlop={10}
                    onPress={(event) => {
                        event.stopPropagation();
                        void togglePlayback(activeTrack);
                    }}
                    className="w-10 h-10 items-center justify-center"
                >
                    <Ionicons
                        name={isPlaying ? "pause" : "play"}
                        size={26}
                        color={colors.text}
                        style={{ marginLeft: isPlaying ? 0 : 2 }}
                    />
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Skip to next"
                    hitSlop={10}
                    onPress={(event) => {
                        event.stopPropagation();
                        void skipToNext();
                    }}
                    className="w-10 h-10 items-center justify-center"
                >
                    <Ionicons
                        name="play-skip-forward"
                        size={24}
                        color={colors.text}
                    />
                </Pressable>
            </Pressable>

            <Modal
                visible={isExpanded}
                transparent
                // The sheet owns its own drag and dismissal animation. A native
                // modal slide here would replay a second exit from the top.
                animationType="none"
                onRequestClose={() => {
                    setIsExpanded(false);
                }}
                statusBarTranslucent
            >
                <Animated.View
                    className="flex-1 bg-background"
                    style={[
                        {
                            paddingTop: insets.top + 8,
                            paddingBottom: insets.bottom + 16,
                        },
                        sheetStyle,
                    ]}
                >
                    <GestureDetector gesture={sheetGesture}>
                        <View
                            accessible
                            accessibilityRole="button"
                            accessibilityLabel="Collapse now playing"
                            className="items-center justify-center"
                            style={{ height: 76 }}
                        >
                            <View
                                className="rounded-full"
                                style={{
                                    width: 56,
                                    height: 5,
                                    backgroundColor: colors.text,
                                    opacity: 0.42,
                                }}
                            />
                        </View>
                    </GestureDetector>

                    <View className="flex-1 px-6 justify-between">
                        <View className="items-center">
                            {canRenderFullArtwork ? (
                                <Image
                                    source={{ uri: fullArtworkUrl }}
                                    style={{
                                        width: artworkSize,
                                        height: artworkSize,
                                    }}
                                    className="rounded-xl bg-muted"
                                    onError={() =>
                                        setFailedArtworkUrl(fullArtworkUrl)
                                    }
                                />
                            ) : (
                                <View
                                    style={{
                                        width: artworkSize,
                                        height: artworkSize,
                                    }}
                                    className="rounded-xl bg-muted items-center justify-center"
                                >
                                    <Ionicons
                                        name="musical-notes"
                                        size={72}
                                        color={colors.text}
                                    />
                                </View>
                            )}
                        </View>

                        <View>
                            <View className="flex-row items-start justify-between gap-3">
                                <View className="flex-1">
                                    <Text
                                        className="text-2xl font-bold text-foreground"
                                        numberOfLines={2}
                                    >
                                        {activeTrack.title || "Unknown Title"}
                                    </Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="Artist page"
                                        onPress={() =>
                                            handleNoOp(
                                                "Artist navigation",
                                                "It will open this artist's page when artist profiles are available.",
                                            )
                                        }
                                    >
                                        <Text
                                            className="text-base text-muted-foreground mt-1"
                                            numberOfLines={1}
                                        >
                                            {activeTrack.artistName ||
                                                "Unknown Artist"}
                                        </Text>
                                    </Pressable>
                                </View>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Add to music library"
                                    onPress={() =>
                                        handleNoOp(
                                            "Add to library",
                                            "It will add or remove this song from your music library.",
                                        )
                                    }
                                    className="w-11 h-11 self-center items-center justify-center"
                                >
                                    <Ionicons
                                        name="add-circle-outline"
                                        size={28}
                                        color={colors.text}
                                    />
                                </Pressable>
                            </View>

                            <View
                                {...seekResponder.panHandlers}
                                accessible
                                accessibilityRole="adjustable"
                                accessibilityLabel="Playback progress"
                                onLayout={(event) =>
                                    setProgressBarWidth(
                                        event.nativeEvent.layout.width,
                                    )
                                }
                                className="h-8 justify-center mt-5"
                            >
                                <View className="h-1.5 rounded-full bg-muted overflow-hidden">
                                    <View
                                        className="h-full rounded-full bg-foreground"
                                        style={{
                                            width: `${progressRatio * 100}%`,
                                        }}
                                    />
                                </View>
                            </View>
                            <View className="flex-row justify-between">
                                <Text className="text-xs text-muted-foreground">
                                    {formatTime(progress)}
                                </Text>
                                <Text className="text-xs text-muted-foreground">
                                    {formatTime(duration)}
                                </Text>
                            </View>
                        </View>

                        <View className="flex-row items-center justify-between px-2">
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Shuffle"
                                onPress={() =>
                                    handleNoOp(
                                        "Shuffle",
                                        "It will randomize the current playback queue.",
                                    )
                                }
                                className="w-12 h-12 items-center justify-center"
                            >
                                <Ionicons
                                    name="shuffle"
                                    size={24}
                                    color={colors.text}
                                />
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Previous track"
                                onPress={() => void skipToPrevious()}
                                className="w-14 h-14 items-center justify-center"
                            >
                                <Ionicons
                                    name="play-skip-back"
                                    size={31}
                                    color={colors.text}
                                />
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={
                                    isPlaying ? "Pause" : "Play"
                                }
                                onPress={() => void togglePlayback(activeTrack)}
                                className="w-20 h-20 rounded-full bg-primary items-center justify-center"
                            >
                                <Ionicons
                                    name={isPlaying ? "pause" : "play"}
                                    size={38}
                                    color={colors.card}
                                    style={{ marginLeft: isPlaying ? 0 : 4 }}
                                />
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Next track"
                                onPress={() => void skipToNext()}
                                className="w-14 h-14 items-center justify-center"
                            >
                                <Ionicons
                                    name="play-skip-forward"
                                    size={31}
                                    color={colors.text}
                                />
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Repeat"
                                onPress={() =>
                                    handleNoOp(
                                        "Repeat",
                                        "It will cycle repeat modes for the current playback queue.",
                                    )
                                }
                                className="w-12 h-12 items-center justify-center"
                            >
                                <Ionicons
                                    name="repeat"
                                    size={24}
                                    color={colors.text}
                                />
                            </Pressable>
                        </View>
                    </View>
                </Animated.View>
            </Modal>
        </>
    );
}
