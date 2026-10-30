import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useCallback, useId, useLayoutEffect, useRef } from "react";
import { Image, Pressable, View, type LayoutChangeEvent } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
    interpolate,
    runOnUI,
    useAnimatedStyle,
    useAnimatedReaction,
    type SharedValue,
} from "react-native-reanimated";
import { GlassSurface } from "@/components/ui/glass-surface";
import {
    usePlayerGestures,
    usePlayerPresentation,
} from "@/lib/player-presentation";
import { usePlaybackCommands, usePlaybackTrackState } from "@/lib/playback";
import { PLAYER_CONTROL_SIZE as SIZE } from "@/lib/screen-overlay-geometry";
import { MediaPlayerCompact } from "./compact";

type Props = {
    visible: boolean;
    kind: "tabs" | "detail";
    bubbleLift: SharedValue<number>;
    failedArtworkUrl: string | null;
    onArtworkError: (url: string | null) => void;
    nativePlayer?: boolean;
};

/** A renderer for the single shared motion controller, mounted only in the foreground host. */
export function MediaPlayer({
    visible,
    nativePlayer = false,
    kind,
    bubbleLift,
    failedArtworkUrl,
    onArtworkError,
}: Props) {
    const {
        activeTrack,
        isPlaying,
        isLoading,
        canSkipToNext,
        isPlayerCollapsed,
    } = usePlaybackTrackState();
    const { togglePlayback, skipToNext } = usePlaybackCommands();
    const {
        motion,
        nativeFrame,
        nativeTakeover,
        expandedHeight,
        nativeInline,
        nativeHeight,
    } = usePlayerPresentation();
    const { progress, geometry, source, height, canPress, anchor } = motion;
    const id = useId(),
        ref = useRef<View>(null);
    const router = useRouter(),
        { colors } = useTheme();
    useLayoutEffect(() => {
        runOnUI(motion.claim)(id, kind);
        return () => runOnUI(motion.release)(id);
    }, [motion, id, kind]);
    useLayoutEffect(() => {
        runOnUI(motion.setVisible)(id, visible);
    }, [motion, id, visible]);
    const { setLift } = motion;
    useAnimatedReaction(
        () => bubbleLift.get(),
        (value) => setLift(id, value),
    );
    const measureAnchor = useCallback(
        (event: LayoutChangeEvent) => {
            const { width, height } = event.nativeEvent.layout;
            // Window measurements include an opening zoom-card's transform. Its
            // layout size is the stable space available to the expanded player.
            ref.current?.measureInWindow((x, y) => {
                if (width > 0 && height > 0)
                    runOnUI(motion.reportFrame)(id, { x, y, width, height });
            });
        },
        [motion, id],
    );
    const { gesture, nativeGesture } = usePlayerGestures(id);
    const proxyStyle = useAnimatedStyle(() => {
        const frame = source.get() ?? nativeFrame.get();
        const origin = anchor.get();
        return {
            position: "absolute",
            bottom: 0,
            left: 0,
            width: frame?.width ?? 0,
            height: frame?.height ?? 0,
            transform: [
                { translateX: (frame?.x ?? 0) - (origin?.x ?? 0) },
                {
                    translateY:
                        (frame ? frame.y + frame.height : 0) -
                        (origin?.y ?? 0) -
                        SIZE,
                },
            ],
        };
    });
    const surfaceStyle = useAnimatedStyle(() => ({
        position: "absolute",
        bottom: 0,
        left: 0,
        ...geometry.get(),
    }));
    const cornerStyle = useAnimatedStyle(() => ({
        borderRadius: interpolate(
            progress.get(),
            [0, 1],
            [(source.get()?.height ?? height.get()) / 2, SIZE / 2],
        ),
    }));
    const controlsStyle = useAnimatedStyle(() => ({
        opacity: interpolate(progress.get(), [0, 0.5, 1], [1, 0, 0]),
        transform: [{ translateX: -24 * progress.get() }],
    }));
    const artSize = nativeInline ? 28 : 32;
    const artworkStyle = useAnimatedStyle(() => ({
        left: interpolate(progress.get(), [0, 1], [12, 3]),
        top: interpolate(
            progress.get(),
            [0, 1],
            [((source.get()?.height ?? height.get()) - artSize) / 2, 3],
        ),
        width: interpolate(progress.get(), [0, 1], [artSize, SIZE - 6]),
        height: interpolate(progress.get(), [0, 1], [artSize, SIZE - 6]),
        borderRadius: interpolate(progress.get(), [0, 1], [6, (SIZE - 6) / 2]),
    }));
    if (!activeTrack) return null;
    const url = activeTrack.artworkUrl?.trim();
    const artwork =
        url && url !== failedArtworkUrl && /^https?:\/\//i.test(url);
    return (
        <View className="flex-1" pointerEvents="box-none">
            <View
                ref={ref}
                onLayout={measureAnchor}
                collapsable={false}
                pointerEvents="none"
                className="absolute bottom-0 left-0 right-0"
                style={{ height: SIZE }}
            />
            <GestureDetector gesture={nativeGesture}>
                <Animated.View
                    collapsable={false}
                    style={proxyStyle}
                    pointerEvents={
                        nativePlayer || nativeTakeover ? "auto" : "none"
                    }
                    accessibilityElementsHidden
                >
                    <View className="flex-1 flex-row items-center px-3">
                        <Pressable
                            style={{
                                width: nativeInline ? 28 : 32,
                                height: nativeInline ? 28 : 32,
                            }}
                            onPress={() => {
                                if (canPress()) runOnUI(motion.collapse)(true);
                            }}
                        />
                        <Pressable
                            className="mx-3 h-full flex-1"
                            onPress={() => {
                                if (canPress()) router.push("/player");
                            }}
                        />
                        <Pressable
                            className="h-10 w-10"
                            disabled={isLoading}
                            onPress={() => {
                                if (canPress())
                                    void togglePlayback(activeTrack);
                            }}
                        />
                        {!nativeInline ? (
                            <Pressable
                                className="h-10 w-10"
                                disabled={!canSkipToNext}
                                onPress={() => {
                                    if (canPress()) void skipToNext();
                                }}
                            />
                        ) : null}
                    </View>
                </Animated.View>
            </GestureDetector>
            <View
                className="absolute inset-0"
                pointerEvents={nativePlayer ? "none" : "box-none"}
                style={{ opacity: nativePlayer ? 0 : 1 }}
            >
                <GestureDetector gesture={gesture}>
                    <Animated.View style={surfaceStyle}>
                        <Animated.View className="flex-1" style={cornerStyle}>
                            <View
                                className="absolute inset-0"
                                pointerEvents="none"
                            >
                                <GlassSurface
                                    style={{ flex: 1, borderRadius: SIZE / 2 }}
                                />
                            </View>
                            <Animated.View
                                className="absolute inset-0 overflow-hidden"
                                pointerEvents={
                                    isPlayerCollapsed ? "none" : "auto"
                                }
                                accessibilityElementsHidden={isPlayerCollapsed}
                                importantForAccessibility={
                                    isPlayerCollapsed
                                        ? "no-hide-descendants"
                                        : "auto"
                                }
                                style={controlsStyle}
                            >
                                <MediaPlayerCompact
                                    height={nativeHeight ?? expandedHeight}
                                    inline={nativeInline}
                                    track={activeTrack}
                                    isPlaying={isPlaying}
                                    isLoading={isLoading}
                                    canSkipToNext={canSkipToNext}
                                    textColor={colors.text}
                                    onCollapse={() => {
                                        if (canPress())
                                            runOnUI(motion.collapse)();
                                    }}
                                    onExpand={() => {
                                        if (canPress()) router.push("/player");
                                    }}
                                    onTogglePlayback={() => {
                                        if (canPress())
                                            void togglePlayback(activeTrack);
                                    }}
                                    onSkipToNext={() => {
                                        if (canPress()) void skipToNext();
                                    }}
                                />
                            </Animated.View>
                            <Animated.View
                                pointerEvents="none"
                                className="absolute items-center justify-center overflow-hidden"
                                style={artworkStyle}
                            >
                                {artwork ? (
                                    <Image
                                        source={{ uri: url }}
                                        className="h-full w-full"
                                        onError={() =>
                                            onArtworkError(url ?? null)
                                        }
                                    />
                                ) : (
                                    <Ionicons
                                        name="musical-notes"
                                        size={22}
                                        color={colors.text}
                                    />
                                )}
                            </Animated.View>
                            {isPlayerCollapsed ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Expand media player, ${activeTrack.title || "Unknown Title"}`}
                                    accessibilityState={{ expanded: false }}
                                    accessibilityHint="Hold to unlock dragging. Drop near the bottom left corner to lock again. Tap to expand."
                                    onPress={() => {
                                        if (canPress())
                                            runOnUI(motion.expand)();
                                    }}
                                    onAccessibilityTap={() =>
                                        runOnUI(motion.expand)()
                                    }
                                    className="absolute inset-0 rounded-full active:opacity-70"
                                />
                            ) : null}
                        </Animated.View>
                    </Animated.View>
                </GestureDetector>
            </View>
        </View>
    );
}
