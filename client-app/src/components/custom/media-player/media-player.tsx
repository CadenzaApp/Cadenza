import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

import { MediaPlayerCompact } from "./compact";
import { usePlayback } from "@/lib/playback";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";

/**
 * The persistent mini player. It floats above the tab bar and survives
 * navigation because `MediaPlayerHost` mounts it outside the navigator.
 * Tapping or swiping it up opens the `player` route, which is the now playing
 * sheet. Where it pins itself comes from `useScreenOverlayInsets`, so the bar
 * and the padding screens leave for it can never disagree.
 */
export function MediaPlayer() {
    const {
        activeTrack,
        isPlaying,
        isLoading,
        togglePlayback,
        skipToNext,
        canSkipToNext,
    } = usePlayback();
    const router = useRouter();
    const { colors } = useTheme();
    const { compactPlayerBottom } = useScreenOverlayInsets();
    const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(
        null,
    );

    const artworkUrl = activeTrack?.artworkUrl?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" &&
        artworkUrl !== failedArtworkUrl &&
        /^https?:\/\//i.test(artworkUrl);

    function openPlayer() {
        router.push("/player");
    }

    const expandMiniPlayer = Gesture.Pan()
        .activeOffsetY(-10)
        .failOffsetX([-20, 20])
        .onEnd((event) => {
            if (event.translationY < -24 || event.velocityY < -450) {
                runOnJS(openPlayer)();
            }
        });

    if (!activeTrack) return null;

    return (
        <GestureDetector gesture={expandMiniPlayer}>
            <MediaPlayerCompact
                track={activeTrack}
                artworkUrl={artworkUrl}
                canRenderArtwork={canRenderArtwork}
                isPlaying={isPlaying}
                isLoading={isLoading}
                canSkipToNext={canSkipToNext}
                bottom={compactPlayerBottom}
                textColor={colors.text}
                onExpand={openPlayer}
                onArtworkError={() =>
                    setFailedArtworkUrl(artworkUrl ?? null)
                }
                onTogglePlayback={() => void togglePlayback(activeTrack)}
                onSkipToNext={() => void skipToNext()}
            />
        </GestureDetector>
    );
}
