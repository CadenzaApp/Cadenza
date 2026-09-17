import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform, StyleSheet, View } from "react-native";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePlaybackTrackState } from "@/lib/playback";
import {
    supportsNativeTabBottomAccessory,
    useShowsPushedPlayerOverlay,
} from "@/lib/screen-overlay";

import { MediaPlayer } from "./media-player";

const FALLBACK_TAB_BAR_HEIGHT = Platform.select({
    ios: 49,
    android: 80,
    default: 60,
});
const FALLBACK_GAP = 8;
const FALLBACK_SIDE_INSET = 12;

type PlayerArtworkStateProps = {
    failedArtworkUrl: string | null;
    onArtworkError: (url: string | null) => void;
};

/** The player content hosted by UITabBarController on iOS 26 and later. */
export function MediaPlayerAccessory({
    failedArtworkUrl,
    onArtworkError,
}: PlayerArtworkStateProps) {
    const placement = NativeTabs.BottomAccessory.usePlacement();
    return (
        <MediaPlayer
            placement={placement}
            failedArtworkUrl={failedArtworkUrl}
            onArtworkError={onArtworkError}
        />
    );
}

/** A floating compatibility player where native bottom accessories do not exist. */
export function MediaPlayerFallbackOverlay({
    hidden,
    failedArtworkUrl,
    onArtworkError,
}: PlayerArtworkStateProps & { hidden: boolean }) {
    const { activeTrack, isPlayerDismissed } = usePlaybackTrackState();
    const insets = useSafeAreaInsets();

    if (
        hidden ||
        supportsNativeTabBottomAccessory() ||
        !activeTrack ||
        isPlayerDismissed
    ) {
        return null;
    }

    return (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View
                style={{
                    position: "absolute",
                    left: FALLBACK_SIDE_INSET,
                    right: FALLBACK_SIDE_INSET,
                    bottom:
                        insets.bottom + FALLBACK_TAB_BAR_HEIGHT + FALLBACK_GAP,
                    borderRadius: 22,
                    shadowColor: "#000",
                    shadowOpacity: 0.18,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 3 },
                    elevation: 8,
                }}
            >
                <MediaPlayer
                    placement="regular"
                    standalone
                    failedArtworkUrl={failedArtworkUrl}
                    onArtworkError={onArtworkError}
                />
            </View>
        </View>
    );
}

/** Compact player over a root detail screen, where native tabs sit underneath. */
export function MediaPlayerPushedScreenOverlay() {
    const { activeTrack, isPlayerDismissed } = usePlaybackTrackState();
    const visible = useShowsPushedPlayerOverlay();
    const insets = useSafeAreaInsets();
    const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(
        null,
    );

    if (!visible || !activeTrack || isPlayerDismissed) return null;

    return (
        <View
            pointerEvents="box-none"
            style={[StyleSheet.absoluteFill, { zIndex: 20, elevation: 20 }]}
        >
            <View
                style={{
                    position: "absolute",
                    left: FALLBACK_SIDE_INSET,
                    right: FALLBACK_SIDE_INSET,
                    bottom: insets.bottom + FALLBACK_GAP,
                    borderRadius: 22,
                    shadowColor: "#000",
                    shadowOpacity: 0.18,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 3 },
                    elevation: 8,
                }}
            >
                <MediaPlayer
                    placement="regular"
                    standalone
                    failedArtworkUrl={failedArtworkUrl}
                    onArtworkError={setFailedArtworkUrl}
                />
            </View>
        </View>
    );
}
