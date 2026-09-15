import Ionicons from "@expo/vector-icons/Ionicons";
import { RepeatMode, ShuffleMode } from "@apple-musickit";
import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
import { Alert, Image, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    cancelAnimation,
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SongOptionsMenu } from "@/components/custom/options-menu/song-options-menu";
import { Text } from "@/components/ui/text";
import { usePlayback } from "@/lib/playback";
import { useSongFavoriteStatus } from "@/lib/musickit-hooks";
import { SHEET_DETENT } from "@/lib/theme";

import { MediaPlayerProgress, MediaPlayerTrackHeading } from "./playback-details";
import { MediaPlayerQueue } from "./queue-view";
import { MediaPlayerTransport } from "./transport-controls";

const PLAYBACK_PROGRESS_INTERPOLATION_MS = 800;

/** Room the artwork must leave for everything stacked below it. */
const TRANSPORT_ROW_HEIGHT = 80;
const SECTION_GAPS = 40;
const MIN_DETAILS_HEIGHT = 160;

/** Mirrors the `DetailScreen` header, for estimates. */
const SHEET_HEADER_HEIGHT = 76;

/** What the page shows above the scrubber. */
type PlayerView = "artwork" | "queue";

/**
 * The Player page of the now playing pager: artwork or the queue, the song
 * and its scrubber, and the transport. It is the only page of the three that
 * touches playback - Comments and Tags both only ever read `focusedSong`.
 *
 * `onModifyTags` is the one thing this page hands up to `PlayerPager`: how
 * Modify Tags on the song actually playing jumps the pager to the Tags page
 * in place, no route push, since this page is already inside the sheet.
 *
 * The scrubber's own pan gesture activates at 4px (`activeOffsetX([-4, 4])`),
 * tighter than the pager's 10px, so a drag that starts on it always wins the
 * activation race and seeks rather than paging. See the pager for the other
 * half of that.
 *
 * The queue opens in place rather than as another page. Playback controls
 * stay on screen either way, which is the whole point of the layout.
 */
export function PlayerPage({
    onModifyTags,
}: {
    onModifyTags: () => void;
}) {
    const {
        activeTrack,
        isPlaying,
        isLoading,
        progress,
        queueIndex,
        upcoming,
        shuffleMode,
        repeatMode,
        seekTo,
        skipToNext,
        skipToPrevious,
        togglePlayback,
        moveQueueItem,
        removeQueueItem,
        playQueueItem,
        setShuffleMode,
        setRepeatMode,
        canSkipToNext,
        canSkipToPrevious,
    } = usePlayback();
    const { colors } = useTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const [view, setView] = useState<PlayerView>("artwork");
    const [menuOpen, setMenuOpen] = useState(false);
    const [bodyHeight, setBodyHeight] = useState(0);
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
    const favoriteSongId = activeTrack?.catalogId ?? activeTrack?.id;
    const {
        favoriteStatus,
        favoriteStatusLoading: isFavoriteStatusLoading,
        setSongFavoriteStatus,
    } = useSongFavoriteStatus(favoriteSongId);

    const artworkUrl = activeTrack?.artworkUrl?.trim();
    const fullArtworkUrl = activeTrack?.artworkUrlLarge?.trim() || artworkUrl;
    const canRenderFullArtwork =
        typeof fullArtworkUrl === "string" &&
        fullArtworkUrl !== failedArtworkUrl &&
        /^https?:\/\//i.test(fullArtworkUrl);
    const duration = activeTrack?.songDuration ?? 0;
    const isUpdatingFavorite = favoriteUpdateSongId === favoriteSongId;
    const displayedProgress = scrubPosition ?? progress;
    // The sheet is shorter than the window, so size against the measured body.
    // Until that lands, estimate it so the artwork does not resize on the
    // first frame. At the large detent the sheet starts below the status bar;
    // at any smaller one it is bottom-anchored and starts further down.
    const sheetTop =
        SHEET_DETENT >= 1 ? insets.top : height * (1 - SHEET_DETENT);
    const estimatedBodyHeight =
        height - sheetTop - SHEET_HEADER_HEIGHT - insets.bottom;
    const availableArtworkSize =
        (bodyHeight || estimatedBodyHeight) -
        TRANSPORT_ROW_HEIGHT -
        SECTION_GAPS -
        MIN_DETAILS_HEIGHT -
        (insets.bottom + 16);
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
        // Keep the hit area tight and require an intentional horizontal drag,
        // so a vertical pull still reaches the native sheet and dismisses it.
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

    if (!activeTrack) {
        return (
            <View className="flex-1 items-center justify-center px-6">
                <Text className="text-muted-foreground">
                    Nothing playing right now.
                </Text>
            </View>
        );
    }
    const track = activeTrack;

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
                "Couldn't Update Favorite",
                "Please check your Apple Music connection and try again.",
            );
        } finally {
            setFavoriteUpdateSongId((pendingSongId) =>
                pendingSongId === songId ? null : pendingSongId,
            );
        }
    }

    /**
     * Puts the sheet away, then goes. Everything the menu leads to is a full
     * screen route with the bottom bars over it, and pushing one from inside a
     * presented sheet would render it in the sheet's box. Music does the same:
     * picking Go to Artist dismisses now playing first.
     */
    function leaveFor(href: Parameters<typeof router.push>[0]) {
        router.back();
        router.push(href);
    }

    function toggleShuffle() {
        void setShuffleMode(
            shuffleMode === ShuffleMode.Off
                ? ShuffleMode.Songs
                : ShuffleMode.Off,
        );
    }

    /** Off, all, one, and back, the order Apple Music cycles in. */
    function cycleRepeat() {
        const next =
            repeatMode === RepeatMode.Off
                ? RepeatMode.All
                : repeatMode === RepeatMode.All
                  ? RepeatMode.One
                  : RepeatMode.Off;
        void setRepeatMode(next);
    }

    // The queue view addresses the upcoming slice; the provider addresses the
    // whole queue. One conversion, here, rather than in both of them.
    function queuePositionOf(upcomingIndex: number) {
        return queueIndex + 1 + upcomingIndex;
    }

    return (
        <View
            className="flex-1 gap-5 px-6"
            style={{ paddingBottom: insets.bottom + 16 }}
            onLayout={(event) => setBodyHeight(event.nativeEvent.layout.height)}
        >
            {view === "queue" ? (
                <MediaPlayerQueue
                    track={track}
                    upcoming={upcoming}
                    shuffleMode={shuffleMode}
                    repeatMode={repeatMode}
                    favoriteStatus={favoriteStatus}
                    isFavoriteStatusLoading={isFavoriteStatusLoading}
                    isUpdatingFavorite={isUpdatingFavorite}
                    textColor={colors.text}
                    onFavoriteToggle={() => void handleFavoriteToggle()}
                    onOpenMenu={() => setMenuOpen(true)}
                    onToggleShuffle={toggleShuffle}
                    onCycleRepeat={cycleRepeat}
                    onPlayUpcoming={(index) =>
                        void playQueueItem(queuePositionOf(index))
                    }
                    onRemoveUpcoming={(index) =>
                        void removeQueueItem(queuePositionOf(index))
                    }
                    onMoveUpcoming={(from, to) =>
                        void moveQueueItem(
                            queuePositionOf(from),
                            queuePositionOf(to),
                        )
                    }
                />
            ) : (
                <>
                    <View className="flex-1 items-center justify-center">
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
                                className="items-center justify-center rounded-xl bg-muted"
                            >
                                <Ionicons
                                    name="musical-notes"
                                    size={72}
                                    color={colors.text}
                                />
                            </View>
                        )}
                    </View>

                    <MediaPlayerTrackHeading
                        track={track}
                        favoriteStatus={favoriteStatus}
                        isFavoriteStatusLoading={isFavoriteStatusLoading}
                        isUpdatingFavorite={isUpdatingFavorite}
                        textColor={colors.text}
                        onFavoriteToggle={() => void handleFavoriteToggle()}
                        onOpenMenu={() => setMenuOpen(true)}
                    />
                </>
            )}

            <MediaPlayerProgress
                progress={displayedProgress}
                duration={duration}
                progressControl={
                    <GestureDetector gesture={seekGesture}>
                        <View
                            className="mt-2 h-5 justify-center"
                            onLayout={(event) =>
                                setProgressBarWidth(
                                    event.nativeEvent.layout.width,
                                )
                            }
                        >
                            <View
                                accessible
                                accessibilityRole="adjustable"
                                accessibilityLabel="Playback progress"
                                className="h-1.5 overflow-hidden rounded-full bg-muted"
                            >
                                <Animated.View
                                    className="h-full rounded-full bg-foreground"
                                    style={progressFillStyle}
                                />
                            </View>
                        </View>
                    </GestureDetector>
                }
            />

            <MediaPlayerTransport
                isPlaying={isPlaying}
                isLoading={isLoading}
                canSkipToNext={canSkipToNext}
                canSkipToPrevious={canSkipToPrevious}
                shuffleMode={shuffleMode}
                queueOpen={view === "queue"}
                textColor={colors.text}
                accentColor={colors.notification}
                onTogglePlayback={() => void togglePlayback(track)}
                onSkipToNext={() => void skipToNext()}
                onSkipToPrevious={() => void skipToPrevious()}
                onToggleShuffle={toggleShuffle}
                onToggleQueue={() =>
                    setView((current) =>
                        current === "queue" ? "artwork" : "queue",
                    )
                }
            />

            {menuOpen ? (
                <SongOptionsMenu
                    track={track}
                    onClose={() => setMenuOpen(false)}
                    navigate={leaveFor}
                    onModifyTags={() => {
                        setMenuOpen(false);
                        onModifyTags();
                    }}
                />
            ) : null}
        </View>
    );
}
