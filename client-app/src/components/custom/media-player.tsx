import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    Pressable,
    ScrollView,
    Share,
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
import {
    mediaPlayerTagRepository,
    type SongTag,
} from "@/lib/media-player-tags";
import { usePlayback } from "@/lib/playback";
import { MusicKit } from "@apple-musickit";
import type { SongFavoriteStatus } from "@apple-musickit";

function formatTime(totalSeconds: number) {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const PLAYBACK_PROGRESS_INTERPOLATION_MS = 800;

interface FavoriteLoadResult {
    songId: string;
    /** Null means the status request failed, rather than "not favorited." */
    status: SongFavoriteStatus | null;
}

/**
 * A global Apple Music player surface. Core playback commands call the native
 * MusicKit module. Artist, shuffle, repeat, and queue management actions still
 * log their future behavior until those product features are implemented.
 */
export function MediaPlayer() {
    const {
        activeTrack,
        isPlaying,
        isLoading,
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
    const detailsTranslateX = useSharedValue(0);
    const detailsStartX = useSharedValue(0);
    const detailsPage = useSharedValue(0);
    const [detailsPagerWidth, setDetailsPagerWidth] = useState(0);
    const [songTags, setSongTags] = useState<SongTag[]>([]);
    const [progressBarWidth, setProgressBarWidth] = useState(0);
    const [scrubPosition, setScrubPosition] = useState<number | null>(null);
    const [favoriteLoadResult, setFavoriteLoadResult] =
        useState<FavoriteLoadResult | null>(null);
    const [favoriteUpdateSongId, setFavoriteUpdateSongId] = useState<
        string | null
    >(null);
    const scrubPositionRef = useRef<number | null>(null);
    const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(
        null,
    );
    const animatedPlaybackProgress = useSharedValue(progress);

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
    const currentFavoriteStatus =
        favoriteLoadResult !== null &&
        favoriteLoadResult.songId === activeTrack?.id
            ? favoriteLoadResult.status
            : undefined;
    const isFavoriteStatusLoading = currentFavoriteStatus === undefined;
    const isUpdatingFavorite = favoriteUpdateSongId === activeTrack?.id;
    const displayedProgress = scrubPosition ?? progress;
    const availableArtworkSize =
        height -
        (insets.top + 8) -
        (insets.bottom + 16) -
        60 - // drag indicator area
        80 - // primary transport-control row
        40 - // two `gap-5` spaces
        220; // minimum room for playback details and actions
    const artworkSize = Math.min(
        width - 48,
        420,
        Math.max(220, availableArtworkSize),
    );

    const progressFillStyle = useAnimatedStyle(() => {
        const position = Math.max(
            0,
            Math.min(animatedPlaybackProgress.value, duration),
        );
        const ratio = duration > 0 ? position / duration : 0;

        return { width: `${ratio * 100}%` };
    });

    useEffect(() => {
        scrubPositionRef.current = scrubPosition;
        if (scrubPosition === null) return;

        cancelAnimation(animatedPlaybackProgress);
        animatedPlaybackProgress.set(scrubPosition);
    }, [animatedPlaybackProgress, scrubPosition]);

    useEffect(() => {
        if (scrubPositionRef.current !== null) return;

        const confirmedPosition = Math.max(0, Math.min(progress, duration));
        if (!isPlaying || isLoading || duration <= 0) {
            animatedPlaybackProgress.set(confirmedPosition);
            return;
        }

        // Playback snapshots arrive periodically. Move toward the expected
        // next position on the UI thread so the bar stays fluid between them.
        animatedPlaybackProgress.set(
            withTiming(
                Math.min(
                    confirmedPosition +
                        PLAYBACK_PROGRESS_INTERPOLATION_MS / 1000,
                    duration,
                ),
                {
                    duration: PLAYBACK_PROGRESS_INTERPOLATION_MS,
                    easing: Easing.linear,
                },
            ),
        );
    }, [animatedPlaybackProgress, duration, isLoading, isPlaying, progress]);

    useEffect(() => {
        if (!activeTrack?.id) {
            return;
        }

        let cancelled = false;
        void mediaPlayerTagRepository
            .listForSong(activeTrack.id)
            .then((tags) => {
                if (!cancelled) setSongTags(tags);
            });

        return () => {
            cancelled = true;
        };
    }, [activeTrack?.id]);

    useEffect(() => {
        const songId = activeTrack?.id;
        if (!songId) return;

        let cancelled = false;
        void MusicKit.getSongFavoriteStatus(songId)
            .then((status) => {
                if (!cancelled) {
                    setFavoriteLoadResult({ songId, status });
                }
            })
            .catch((error) => {
                console.warn(
                    `Unable to read favorite status for song ${songId}.`,
                    error,
                );
                if (!cancelled) {
                    setFavoriteLoadResult({ songId, status: null });
                }
            });

        return () => {
            cancelled = true;
        };
    }, [activeTrack?.id]);

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

    const detailsPagerStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: detailsTranslateX.get() }],
    }));

    const playbackDotStyle = useAnimatedStyle(() => ({
        opacity: detailsPage.get() === 0 ? 1 : 0.3,
    }));
    const tagsDotStyle = useAnimatedStyle(() => ({
        opacity: detailsPage.get() === 1 ? 1 : 0.3,
    }));

    function selectDetailsPage(nextPage: 0 | 1) {
        if (!detailsPagerWidth || detailsPage.get() === nextPage) return;

        cancelAnimation(detailsTranslateX);
        detailsPage.set(nextPage);
        if (nextPage === 1) notifyTagEditingOpened();
        detailsTranslateX.set(
            withTiming(-nextPage * detailsPagerWidth, {
                duration: 220,
                easing: Easing.out(Easing.cubic),
            }),
        );
    }

    function notifyTagEditingOpened() {
        console.info(
            "[MediaPlayer] Tag editing is incomplete. These are dummy library tags and do not save changes yet.",
        );
    }

    async function toggleTag(tagId: string) {
        if (!activeTrack?.id) return;
        const tags = await mediaPlayerTagRepository.toggleForSong(
            activeTrack.id,
            tagId,
        );
        setSongTags(tags);
    }

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
        // This gesture wraps the entire expanded sheet, so a downward pull
        // from any non-scrollable part of the player can collapse it.
        .activeOffsetY(10)
        .failOffsetX([-20, 20])
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

    function timeAtSeekLocation(locationX: number) {
        if (!duration || !progressBarWidth) return null;
        return (
            (Math.max(0, Math.min(locationX, progressBarWidth)) /
                progressBarWidth) *
            duration
        );
    }

    function updateScrubPosition(locationX: number) {
        const nextPosition = timeAtSeekLocation(locationX);
        if (nextPosition !== null) setScrubPosition(nextPosition);
    }

    async function finishSeek(locationX: number) {
        const time = timeAtSeekLocation(locationX);
        if (time === null) {
            setScrubPosition(null);
            return;
        }

        // Keep the exact tapped/released position visible while the native
        // player applies the seek, then resume interpolating from ground truth.
        setScrubPosition(time);
        try {
            await seekTo(time);
        } finally {
            setScrubPosition(null);
        }
    }

    function cancelSeek() {
        setScrubPosition(null);
    }

    const seekPanGesture = Gesture.Pan()
        // Keep the hit area tight and require an intentional horizontal drag.
        // This lets page swipes that begin near the scrubber reach the pager
        // rather than immediately changing playback position.
        .activeOffsetX([-4, 4])
        .failOffsetY([-10, 10])
        .onBegin((event) => {
            runOnJS(updateScrubPosition)(event.x);
        })
        .onUpdate((event) => {
            runOnJS(updateScrubPosition)(event.x);
        })
        .onEnd((event) => {
            runOnJS(finishSeek)(event.x);
        })
        .onFinalize((_, success) => {
            if (!success) runOnJS(cancelSeek)();
        });

    const seekTapGesture = Gesture.Tap()
        .maxDistance(8)
        .onEnd((event, success) => {
            if (success) runOnJS(finishSeek)(event.x);
        });

    const seekGesture = Gesture.Exclusive(seekPanGesture, seekTapGesture);

    const detailsGesture = Gesture.Pan()
        .requireExternalGestureToFail(seekPanGesture)
        .requireExternalGestureToFail(seekTapGesture)
        .activeOffsetX([-10, 10])
        .failOffsetY([-16, 16])
        .onBegin(() => {
            cancelAnimation(detailsTranslateX);
            detailsStartX.set(-detailsPage.get() * detailsPagerWidth);
        })
        .onUpdate((event) => {
            if (!detailsPagerWidth) return;
            const nextPosition = Math.max(
                -detailsPagerWidth,
                Math.min(0, detailsStartX.get() + event.translationX),
            );
            detailsTranslateX.set(nextPosition);
        })
        .onEnd((event) => {
            if (!detailsPagerWidth) return;

            const currentPage = detailsPage.get();
            const shouldAdvance =
                event.translationX < -detailsPagerWidth * 0.18 ||
                event.velocityX < -550;
            const shouldGoBack =
                event.translationX > detailsPagerWidth * 0.18 ||
                event.velocityX > 550;
            const nextPage = shouldAdvance ? 1 : shouldGoBack ? 0 : currentPage;

            if (nextPage !== currentPage) {
                detailsPage.set(nextPage);
                if (nextPage === 1) runOnJS(notifyTagEditingOpened)();
            }

            detailsTranslateX.set(
                withTiming(-nextPage * detailsPagerWidth, {
                    duration: 220,
                    easing: Easing.out(Easing.cubic),
                }),
            );
        });

    const expandMiniPlayer = Gesture.Pan()
        .activeOffsetY(-10)
        .failOffsetX([-20, 20])
        .onEnd((event) => {
            if (event.translationY < -24 || event.velocityY < -450) {
                runOnJS(expandPlayer)();
            }
        });

    if (!activeTrack) return null;

    function handleNoOp(feature: string, futureBehavior: string) {
        console.info(
            `[MediaPlayer] ${feature} is not available yet. ${futureBehavior}`,
        );
    }

    async function handleFavoriteToggle() {
        const songId = activeTrack?.id;
        if (!songId || !currentFavoriteStatus || isUpdatingFavorite) return;

        const isFavorite = currentFavoriteStatus?.isFavorite ?? false;

        setFavoriteUpdateSongId(songId);
        try {
            const nextStatus = await MusicKit.setSongFavoriteStatus(
                songId,
                !isFavorite,
            );
            setFavoriteLoadResult({ songId, status: nextStatus });
        } catch (error) {
            console.error("Unable to update Apple Music favorite.", error);
            Alert.alert(
                "Couldn’t Update Favorite",
                "Please check your Apple Music connection and try again.",
            );
        } finally {
            setFavoriteUpdateSongId((pendingSongId) =>
                pendingSongId === songId ? null : pendingSongId,
            );
        }
    }

    async function shareCurrentTrack() {
        const track = activeTrack;
        if (!track) return;

        try {
            let appleMusicUrl = track.shareUrl;
            if (!appleMusicUrl) {
                const [resolvedTrack] = await MusicKit.getSongInfo([track.id]);
                appleMusicUrl = resolvedTrack?.shareUrl;
            }
            if (!appleMusicUrl) {
                throw new Error("No canonical Apple Music URL is available.");
            }

            await Share.share({
                title: track.title,
                // Android ignores the separate `url` field, so include the
                // canonical link in the message on every platform.
                message: `I'm listening to ${track.title} by ${track.artistName || "an unknown artist"}. ${appleMusicUrl}`,
                url: appleMusicUrl,
            });
        } catch (error) {
            console.error("Failed to share the current track:", error);
        }
    }

    return (
        <>
            <GestureDetector gesture={expandMiniPlayer}>
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
                            void togglePlayback(activeTrack);
                        }}
                        className="w-10 h-10 items-center justify-center"
                    >
                        {isLoading ? (
                            <ActivityIndicator
                                size="small"
                                color={colors.text}
                            />
                        ) : (
                            <Ionicons
                                name={isPlaying ? "pause" : "play"}
                                size={26}
                                color={colors.text}
                                style={{ marginLeft: isPlaying ? 0 : 2 }}
                            />
                        )}
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
            </GestureDetector>

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
                <GestureDetector gesture={dragSheet}>
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
                        <GestureDetector gesture={dismissExpandedPlayer}>
                            <View
                                accessible
                                accessibilityRole="button"
                                accessibilityLabel="Collapse now playing"
                                className="items-center justify-center"
                                style={{ height: 60, paddingBottom: 10 }}
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

                        <View className="flex-1 px-6 gap-5">
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

                            <View
                                className="flex-1 overflow-hidden"
                                onLayout={(event) =>
                                    setDetailsPagerWidth(
                                        event.nativeEvent.layout.width,
                                    )
                                }
                            >
                                <View className="items-center justify-center mb-3">
                                    <View className="flex-row gap-1.5">
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="Show playback details"
                                            onPress={() => selectDetailsPage(0)}
                                            hitSlop={12}
                                        >
                                            <Animated.View
                                                className="w-1.5 h-1.5 rounded-full"
                                                style={[
                                                    {
                                                        backgroundColor:
                                                            colors.text,
                                                    },
                                                    playbackDotStyle,
                                                ]}
                                            />
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="Show tag editor"
                                            onPress={() => selectDetailsPage(1)}
                                            hitSlop={12}
                                        >
                                            <Animated.View
                                                className="w-1.5 h-1.5 rounded-full"
                                                style={[
                                                    {
                                                        backgroundColor:
                                                            colors.text,
                                                    },
                                                    tagsDotStyle,
                                                ]}
                                            />
                                        </Pressable>
                                    </View>
                                </View>
                                <GestureDetector gesture={detailsGesture}>
                                    <Animated.View
                                        className="flex-1 flex-row"
                                        style={[
                                            {
                                                width: detailsPagerWidth * 2,
                                            },
                                            detailsPagerStyle,
                                        ]}
                                    >
                                        <View
                                            style={{ width: detailsPagerWidth }}
                                            className="pr-1"
                                        >
                                            <View className="flex-row items-start justify-between gap-3">
                                                <View className="flex-1">
                                                    <Text
                                                        className="text-2xl font-bold text-foreground"
                                                        numberOfLines={2}
                                                    >
                                                        {activeTrack.title ||
                                                            "Unknown Title"}
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
                                                    accessibilityLabel={
                                                        currentFavoriteStatus?.isFavorite
                                                            ? "Remove song from favorites"
                                                            : "Add song to favorites"
                                                    }
                                                    accessibilityState={{
                                                        busy:
                                                            isFavoriteStatusLoading ||
                                                            isUpdatingFavorite,
                                                        disabled:
                                                            currentFavoriteStatus ===
                                                                null ||
                                                            isFavoriteStatusLoading,
                                                        selected:
                                                            currentFavoriteStatus?.isFavorite ??
                                                            false,
                                                    }}
                                                    disabled={
                                                        currentFavoriteStatus ===
                                                            null ||
                                                        isFavoriteStatusLoading
                                                    }
                                                    onPress={
                                                        handleFavoriteToggle
                                                    }
                                                    className="w-11 h-11 self-center items-center justify-center"
                                                >
                                                    {isFavoriteStatusLoading ||
                                                    isUpdatingFavorite ? (
                                                        <ActivityIndicator
                                                            size="small"
                                                            color={colors.text}
                                                        />
                                                    ) : (
                                                        <Ionicons
                                                            name={
                                                                currentFavoriteStatus?.isFavorite
                                                                    ? "star"
                                                                    : "star-outline"
                                                            }
                                                            size={28}
                                                            color={colors.text}
                                                        />
                                                    )}
                                                </Pressable>
                                            </View>

                                            <GestureDetector
                                                gesture={seekGesture}
                                            >
                                                <View
                                                    className="h-5 justify-center mt-4"
                                                    onLayout={(event) =>
                                                        setProgressBarWidth(
                                                            event.nativeEvent
                                                                .layout.width,
                                                        )
                                                    }
                                                >
                                                    <View
                                                        accessible
                                                        accessibilityRole="adjustable"
                                                        accessibilityLabel="Playback progress"
                                                        className="h-1.5 rounded-full bg-muted overflow-hidden"
                                                    >
                                                        <Animated.View
                                                            className="h-full rounded-full bg-foreground"
                                                            style={
                                                                progressFillStyle
                                                            }
                                                        />
                                                    </View>
                                                </View>
                                            </GestureDetector>
                                            <View className="flex-row justify-between">
                                                <Text className="text-xs text-muted-foreground">
                                                    {formatTime(
                                                        displayedProgress,
                                                    )}
                                                </Text>
                                                <Text className="text-xs text-muted-foreground">
                                                    {formatTime(duration)}
                                                </Text>
                                            </View>
                                            <View className="flex-row justify-center gap-12 mt-5">
                                                <Pressable
                                                    accessibilityRole="button"
                                                    accessibilityLabel="Share song"
                                                    onPress={() =>
                                                        void shareCurrentTrack()
                                                    }
                                                    className="w-12 h-12 rounded-full bg-secondary items-center justify-center"
                                                >
                                                    <Ionicons
                                                        name="share-outline"
                                                        size={23}
                                                        color={colors.text}
                                                    />
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    accessibilityLabel="Manage queue"
                                                    onPress={() =>
                                                        handleNoOp(
                                                            "Queue management",
                                                            "It will let you view and reorder upcoming tracks.",
                                                        )
                                                    }
                                                    className="w-12 h-12 rounded-full bg-secondary items-center justify-center"
                                                >
                                                    <Ionicons
                                                        name="list-outline"
                                                        size={25}
                                                        color={colors.text}
                                                    />
                                                </Pressable>
                                            </View>
                                        </View>

                                        <View
                                            style={{ width: detailsPagerWidth }}
                                            className="pl-1"
                                        >
                                            <Text className="text-xl font-bold text-foreground">
                                                Edit tags
                                            </Text>
                                            <ScrollView
                                                className="flex-1 mt-3"
                                                contentContainerClassName="flex-row flex-wrap gap-2 pb-2"
                                                showsVerticalScrollIndicator={
                                                    false
                                                }
                                                nestedScrollEnabled
                                            >
                                                {songTags.map((tag) => {
                                                    return (
                                                        <Pressable
                                                            key={tag.id}
                                                            accessibilityRole="button"
                                                            accessibilityLabel={`Add ${tag.name} tag`}
                                                            onPress={() =>
                                                                void toggleTag(
                                                                    tag.id,
                                                                )
                                                            }
                                                            className="rounded-full px-3 py-2 border"
                                                            style={{
                                                                borderColor:
                                                                    tag.color,
                                                                backgroundColor:
                                                                    tag.applied
                                                                        ? tag.color
                                                                        : "transparent",
                                                            }}
                                                        >
                                                            <Text
                                                                className="text-sm font-medium"
                                                                style={{
                                                                    color: tag.applied
                                                                        ? "#ffffff"
                                                                        : tag.color,
                                                                }}
                                                            >
                                                                {tag.name}
                                                            </Text>
                                                        </Pressable>
                                                    );
                                                })}
                                            </ScrollView>
                                        </View>
                                    </Animated.View>
                                </GestureDetector>
                            </View>

                            <View
                                className="flex-row items-center justify-between px-2"
                                style={{ backgroundColor: "transparent" }}
                            >
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
                                        isLoading
                                            ? "Loading song"
                                            : isPlaying
                                              ? "Pause"
                                              : "Play"
                                    }
                                    accessibilityState={{ busy: isLoading }}
                                    disabled={isLoading}
                                    onPress={() =>
                                        void togglePlayback(activeTrack)
                                    }
                                    className="w-20 h-20 rounded-full bg-primary items-center justify-center"
                                >
                                    {isLoading ? (
                                        <ActivityIndicator
                                            size="large"
                                            color={colors.card}
                                        />
                                    ) : (
                                        <Ionicons
                                            name={isPlaying ? "pause" : "play"}
                                            size={38}
                                            color={colors.card}
                                            style={{
                                                marginLeft: isPlaying ? 0 : 4,
                                            }}
                                        />
                                    )}
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
                </GestureDetector>
            </Modal>
        </>
    );
}
