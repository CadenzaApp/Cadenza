import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useCallback, useMemo } from "react";
import { useWindowDimensions } from "react-native";
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

import { usePlaybackCommands, usePlaybackTrackState } from "@/lib/playback";

import { MediaPlayerCompact, type MediaPlayerPlacement } from "./compact";

type Props = {
    placement: MediaPlayerPlacement;
    standalone?: boolean;
    failedArtworkUrl: string | null;
    onArtworkError: (url: string | null) => void;
};

/** Playback wiring shared by both native accessory placements and the fallback. */
export function MediaPlayer({
    placement,
    standalone,
    failedArtworkUrl,
    onArtworkError,
}: Props) {
    const { activeTrack, isPlaying, isLoading, canSkipToNext } =
        usePlaybackTrackState();
    const { togglePlayback, skipToNext, dismissPlayer } = usePlaybackCommands();
    const router = useRouter();
    const { colors } = useTheme();
    const { width } = useWindowDimensions();
    const translateX = useSharedValue(0);
    const artworkUrl = activeTrack?.artworkUrl?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" &&
        artworkUrl !== failedArtworkUrl &&
        /^https?:\/\//i.test(artworkUrl);
    const openPlayer = useCallback(() => router.push("/player"), [router]);
    const finishDismissal = useCallback(() => {
        void dismissPlayer().catch(() => {
            // The provider restores the player and owns the user-facing error.
        });
    }, [dismissPlayer]);
    const dismissGesture = useMemo(
        () =>
            Gesture.Pan()
                .activeOffsetX([-10, 10])
                .failOffsetY([-16, 16])
                .onBegin(() => cancelAnimation(translateX))
                .onUpdate((event) => {
                    translateX.set(event.translationX);
                })
                .onEnd((event) => {
                    const shouldDismiss =
                        Math.abs(event.translationX) > width * 0.25 ||
                        Math.abs(event.velocityX) > 700;
                    if (!shouldDismiss) {
                        translateX.set(
                            withSpring(0, {
                                damping: 20,
                                stiffness: 220,
                            }),
                        );
                        return;
                    }

                    // UIKit owns the native accessory's glass wrapper. Asking
                    // the tab host to hide it is the only public way to move
                    // that whole surface, and it supplies its own animation.
                    if (!standalone) {
                        translateX.set(0);
                        runOnJS(finishDismissal)();
                        return;
                    }

                    const direction =
                        event.translationX === 0
                            ? Math.sign(event.velocityX) || 1
                            : Math.sign(event.translationX);
                    translateX.set(
                        withTiming(
                            direction * (width + 24),
                            {
                                duration: 220,
                                easing: Easing.out(Easing.cubic),
                            },
                            (finished) => {
                                if (finished) runOnJS(finishDismissal)();
                            },
                        ),
                    );
                }),
        [finishDismissal, standalone, translateX, width],
    );
    const swipeStyle = useAnimatedStyle(() => {
        if (!standalone) return {};
        return {
            opacity: Math.max(0, 1 - Math.abs(translateX.value) / width),
            transform: [{ translateX: translateX.value }],
        };
    });

    if (!activeTrack) return null;

    return (
        <GestureDetector gesture={dismissGesture}>
            <Animated.View style={[{ flex: 1 }, swipeStyle]}>
                <MediaPlayerCompact
                    track={activeTrack}
                    placement={placement}
                    standalone={standalone}
                    artworkUrl={artworkUrl}
                    canRenderArtwork={canRenderArtwork}
                    isPlaying={isPlaying}
                    isLoading={isLoading}
                    canSkipToNext={canSkipToNext}
                    textColor={colors.text}
                    onExpand={openPlayer}
                    onArtworkError={() => onArtworkError(artworkUrl ?? null)}
                    onTogglePlayback={() => void togglePlayback(activeTrack)}
                    onSkipToNext={() => void skipToNext()}
                />
            </Animated.View>
        </GestureDetector>
    );
}
