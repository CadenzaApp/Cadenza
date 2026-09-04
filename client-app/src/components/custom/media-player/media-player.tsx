import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
import {
    Alert,
    Image,
    Modal,
    Pressable,
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

import { MediaPlayerCompact } from "./compact";
import { MediaPlayerPlaybackDetails } from "./playback-details";
import { MediaPlayerTagEditor } from "./tag-editor";
import { MediaPlayerTransport } from "./transport-controls";
import { usePlayback } from "@/lib/playback";
import { useTags } from "@/lib/routes/tags";
import { useApplyTag, useTagsOnSong, useUnapplyTag } from "@/lib/routes/songs";
import { MusicKit } from "@apple-musickit";
import { useSongFavoriteStatus } from "@/lib/musickit-hooks";

const PLAYBACK_PROGRESS_INTERPOLATION_MS = 800;

/**
 * A global Apple Music player surface. Core playback commands call the native
 * MusicKit module. Artist, shuffle, repeat, and queue management actions still
 * log their future behavior until those product features are implemented.
 */
export function MediaPlayer({
    compactBottomOffset = 54,
}: {
    compactBottomOffset?: number;
}) {
    const {
        activeTrack,
        isPlaying,
        isLoading,
        progress,
        seekTo,
        skipToNext,
        skipToPrevious,
        togglePlayback,
        canSkipToNext,
        canSkipToPrevious,
    } = usePlayback();
    const { tagsWithMeta = [] } = useTags();
    const tags = tagsWithMeta.map(({ tag }) => tag);
    const { tagsOnSong } = useTagsOnSong(
        activeTrack?.catalogId ?? activeTrack?.id,
    );
    const appliedTags = [
        ...(tagsOnSong?.global ?? []),
        ...(tagsOnSong?.local ?? []),
    ];
    const { applyTag } = useApplyTag();
    const { unapplyTag } = useUnapplyTag();
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const [isExpanded, setIsExpanded] = useState(false);
    const sheetTranslateY = useSharedValue(0);
    const detailsTranslateX = useSharedValue(0);
    const detailsStartX = useSharedValue(0);
    const detailsPage = useSharedValue(0);
    const [detailsPagerWidth, setDetailsPagerWidth] = useState(0);
    const [progressBarWidth, setProgressBarWidth] = useState(0);
    const [scrubPosition, setScrubPosition] = useState<number | null>(null);
    const [favoriteUpdateSongId, setFavoriteUpdateSongId] = useState<
        string | null
    >(null);
    const scrubPositionRef = useRef<number | null>(null);
    const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(
        null,
    );
    const animatedPlaybackProgress = useSharedValue(progress);
    const appliedTagIds = new Set(appliedTags.map((tag) => tag.id));
    const songTags = tags.map((tag) => ({
        ...tag,
        applied: appliedTagIds.has(tag.id),
    }));
    const favoriteSongId = activeTrack?.catalogId ?? activeTrack?.id;
    const {
        favoriteStatus,
        favoriteStatusLoading: isFavoriteStatusLoading,
        setSongFavoriteStatus,
    } = useSongFavoriteStatus(favoriteSongId);

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
    const isUpdatingFavorite = favoriteUpdateSongId === favoriteSongId;
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
        detailsTranslateX.set(
            withTiming(-nextPage * detailsPagerWidth, {
                duration: 220,
                easing: Easing.out(Easing.cubic),
            }),
        );
    }

    async function toggleTag(tagId: number) {
        const songId = activeTrack?.catalogId ?? activeTrack?.id;
        const tag = tags.find((candidate) => candidate.id === tagId);
        if (!songId || !tag) return;

        const isApplied = appliedTags.some(
            (appliedTag) => appliedTag.id === tagId,
        );
        if (isApplied) await unapplyTag({ song_id: songId, tag_id: tag.id });
        else await applyTag({ song_id: songId, tag_id: tag.id });
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
        const songId = favoriteSongId;
        if (!songId || !favoriteStatus || isUpdatingFavorite) return;

        const isFavorite = favoriteStatus.isFavorite;

        setFavoriteUpdateSongId(songId);
        try {
            await setSongFavoriteStatus(!isFavorite);
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
                <MediaPlayerCompact
                    track={activeTrack}
                    artworkUrl={artworkUrl}
                    canRenderArtwork={canRenderArtwork}
                    isPlaying={isPlaying}
                    isLoading={isLoading}
                    canSkipToNext={canSkipToNext}
                    bottom={insets.bottom + compactBottomOffset}
                    textColor={colors.text}
                    onExpand={expandPlayer}
                    onArtworkError={() =>
                        setFailedArtworkUrl(artworkUrl ?? null)
                    }
                    onTogglePlayback={() => void togglePlayback(activeTrack)}
                    onSkipToNext={() => void skipToNext()}
                />
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
                                        <MediaPlayerPlaybackDetails
                                            width={detailsPagerWidth}
                                            track={activeTrack}
                                            favoriteStatus={favoriteStatus}
                                            isFavoriteStatusLoading={
                                                isFavoriteStatusLoading
                                            }
                                            isUpdatingFavorite={
                                                isUpdatingFavorite
                                            }
                                            progress={displayedProgress}
                                            duration={duration}
                                            textColor={colors.text}
                                            onFavoriteToggle={() =>
                                                void handleFavoriteToggle()
                                            }
                                            onShare={() =>
                                                void shareCurrentTrack()
                                            }
                                            onUnavailable={handleNoOp}
                                            progressControl={
                                                <GestureDetector
                                                    gesture={seekGesture}
                                                >
                                                    <View
                                                        className="h-5 justify-center mt-4"
                                                        onLayout={(event) =>
                                                            setProgressBarWidth(
                                                                event
                                                                    .nativeEvent
                                                                    .layout
                                                                    .width,
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
                                            }
                                        />

                                        <MediaPlayerTagEditor
                                            width={detailsPagerWidth}
                                            tags={songTags}
                                            onToggleTag={(tagId) =>
                                                void toggleTag(tagId)
                                            }
                                        />
                                    </Animated.View>
                                </GestureDetector>
                            </View>

                            <MediaPlayerTransport
                                isPlaying={isPlaying}
                                isLoading={isLoading}
                                canSkipToNext={canSkipToNext}
                                canSkipToPrevious={canSkipToPrevious}
                                textColor={colors.text}
                                controlColor={colors.card}
                                onTogglePlayback={() =>
                                    void togglePlayback(activeTrack)
                                }
                                onSkipToNext={() => void skipToNext()}
                                onSkipToPrevious={() => void skipToPrevious()}
                                onUnavailable={handleNoOp}
                            />
                        </View>
                    </Animated.View>
                </GestureDetector>
            </Modal>
        </>
    );
}
