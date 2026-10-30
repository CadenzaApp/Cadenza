import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useTheme } from "expo-router/react-navigation";
import { useEffect, useRef } from "react";
import { Image, View, useWindowDimensions } from "react-native";
import { runOnUI } from "react-native-reanimated";

import { usePlaybackCommands, usePlaybackTrackState } from "@/lib/playback";
import { usePlayerPresentation } from "@/lib/player-presentation";
import { MediaPlayerCompact } from "./compact";

type Props = {
    failedArtworkUrl: string | null;
    onArtworkError: (url: string | null) => void;
};

/** UIKit supplies the glass, sizing, and transition between regular and inline. */
export function NativePlayerAccessory({
    failedArtworkUrl,
    onArtworkError,
}: Props) {
    const inline = NativeTabs.BottomAccessory.usePlacement() === "inline";
    const { activeTrack, isPlaying, isLoading, canSkipToNext } =
        usePlaybackTrackState();
    const { togglePlayback, skipToNext } = usePlaybackCommands();
    const nativeLayout = usePlayerPresentation();
    const { width: windowWidth } = useWindowDimensions();
    const nativeRef = useRef<View>(null);
    const mounted = useRef(true);
    const measurementVersion = useRef(0);
    const { reportNativeFrame, reportRegularHeight } = nativeLayout;
    useEffect(() => {
        mounted.current = true;
        measurementVersion.current++;
        return () => {
            mounted.current = false;
            if (!inline) reportNativeFrame(null);
        };
    }, [inline, reportNativeFrame]);
    const router = useRouter();
    const { colors } = useTheme();
    const { motion } = nativeLayout;
    const { canPress } = motion;
    if (!activeTrack) return null;

    const artworkUrl = activeTrack.artworkUrl?.trim();
    const hasArtwork = Boolean(
        artworkUrl &&
        artworkUrl !== failedArtworkUrl &&
        /^https?:\/\//i.test(artworkUrl),
    );
    const artworkSize = inline ? 28 : 32;
    const artwork = hasArtwork ? (
        <Image
            source={{ uri: artworkUrl }}
            className="rounded-md bg-muted"
            style={{ width: artworkSize, height: artworkSize }}
            onError={() => onArtworkError(artworkUrl ?? null)}
        />
    ) : (
        <View
            className="items-center justify-center rounded-md bg-muted"
            style={{ width: artworkSize, height: artworkSize }}
        >
            <Ionicons name="musical-notes" size={18} color={colors.text} />
        </View>
    );

    return (
        <View
            ref={nativeRef}
            collapsable={false}
            onLayout={(event) => {
                // Both placements inherit UIKit's active wrapper frame. Read
                // window coordinates after layout, never poll detached trees.
                const { width, height } = event.nativeEvent.layout;
                if (!inline && width >= windowWidth * 0.75)
                    reportRegularHeight(height);
                const version = ++measurementVersion.current;
                nativeRef.current?.measureInWindow((x, y, w, h) => {
                    if (
                        mounted.current &&
                        version === measurementVersion.current &&
                        w > 0 &&
                        h > 0
                    )
                        reportNativeFrame({ x, y, width: w, height: h });
                });
            }}
            className="flex-1 flex-row items-center"
        >
            <View className="h-full min-w-0 flex-1">
                <MediaPlayerCompact
                    track={activeTrack}
                    artwork={artwork}
                    nativeAccessory
                    inline={inline}
                    isPlaying={isPlaying}
                    isLoading={isLoading}
                    canSkipToNext={canSkipToNext}
                    textColor={colors.text}
                    onCollapse={() => {
                        if (canPress()) runOnUI(motion.collapse)(true);
                    }}
                    onExpand={() => {
                        if (canPress()) router.push("/player");
                    }}
                    onTogglePlayback={() => {
                        if (canPress()) void togglePlayback(activeTrack);
                    }}
                    onSkipToNext={() => {
                        if (canPress()) void skipToNext();
                    }}
                />
            </View>
        </View>
    );
}
