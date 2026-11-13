import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useTheme } from "expo-router/react-navigation";
import { useEffect, useRef } from "react";
import { View, useWindowDimensions } from "react-native";
import { runOnUI } from "react-native-reanimated";

import { RemoteArtwork } from "@/components/ui/remote-artwork";
import { useLiveSessionBadge } from "@/features/live-session/use-live-badge";
import { usePlaybackCommands, usePlaybackTrackState } from "@/lib/playback";
import { usePlayerPresentation } from "@/lib/player-presentation";
import { MediaPlayerCompact } from "./compact";

/** UIKit supplies the glass, sizing, and transition between regular and inline. */
export function NativePlayerAccessory() {
    const inline = NativeTabs.BottomAccessory.usePlacement() === "inline";
    const { activeTrack, isPlaying, isLoading, canSkipToNext, controlsLocked } =
        usePlaybackTrackState();
    const live = useLiveSessionBadge();
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

    const artworkSize = inline ? 28 : 32;
    const artwork = (
        <RemoteArtwork
            url={activeTrack.artworkUrl}
            className="rounded-md"
            style={{ width: artworkSize, height: artworkSize }}
            fallback={
                <Ionicons name="musical-notes" size={18} color={colors.text} />
            }
        />
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
                    canTogglePlayback={!controlsLocked}
                    canSkipToNext={canSkipToNext}
                    liveLabel={live?.name ?? null}
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
