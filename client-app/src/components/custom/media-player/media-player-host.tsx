import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform, StyleSheet, View } from "react-native";
import { useEffect, useState } from "react";
import { FullWindowOverlay } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePlaybackTrackState } from "@/lib/playback";
import {
    supportsNativeTabBottomAccessory,
    useBottomBarsHidden,
    useShowsRootPlayerOverlay,
} from "@/lib/screen-overlay";

import { MediaPlayer } from "./media-player";

const FALLBACK_TAB_BAR_HEIGHT = Platform.select({
    ios: 49,
    android: 80,
    default: 60,
});
const FALLBACK_GAP = 8;
const FALLBACK_SIDE_INSET = 12;
/** Roughly what UIKit takes to animate `bottomAccessoryHidden` out. */
const ACCESSORY_HIDE_ANIMATION_MS = 400;

type PlayerArtworkStateProps = {
    failedArtworkUrl: string | null;
    onArtworkError: (url: string | null) => void;
};

/**
 * Whether the tab controller should still declare a bottom accessory.
 *
 * UIKit keeps the accessory's slot in the minimized tab bar reserved for as
 * long as one is declared, so a dismissed player leaves that slot sitting
 * empty between the two tab buttons. Undeclaring it gives the space back.
 *
 * The declaration outlives the dismissal by the length of UIKit's own hide
 * animation. Dropping it on the same commit that sets `bottomAccessoryHidden`
 * tears the accessory out before that animation can play, so it pops instead
 * of sliding away.
 */
export function useMediaPlayerAccessoryDeclared() {
    const { activeTrack, isPlayerDismissed } = usePlaybackTrackState();
    const wanted = activeTrack != null && !isPlayerDismissed;
    const [declared, setDeclared] = useState(wanted);
    const [previousWanted, setPreviousWanted] = useState(wanted);

    // Re-declaring has to land on the same render that wants it, or a song
    // starting after a dismissal shows an empty slot for a frame. Adjusting
    // state during render is React's own answer to that; only the delayed
    // undeclare below needs to wait for a timer.
    if (previousWanted !== wanted) {
        setPreviousWanted(wanted);
        if (wanted) setDeclared(true);
    }

    useEffect(() => {
        if (wanted || !declared) return;

        const timer = setTimeout(
            () => setDeclared(false),
            ACCESSORY_HIDE_ANIMATION_MS,
        );
        return () => clearTimeout(timer);
    }, [declared, wanted]);

    return declared;
}

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

/** Compact player owned by one zoom-dismiss card. */
export function MediaPlayerZoomOverlay() {
    return <StandalonePlayerOverlay />;
}

/** Compact player for pushed screens that do not own a zoom-dismiss card. */
export function MediaPlayerPushedScreenOverlay() {
    const visible = useShowsRootPlayerOverlay();

    if (!visible) return null;

    const player = <StandalonePlayerOverlay />;

    // A native screen sits above ordinary React siblings on iOS, regardless
    // of z-index. Query results do not own a zoom card, so their player stays
    // at the root and moves to the window layer.
    if (Platform.OS !== "ios") return player;

    return (
        <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
            {player}
        </FullWindowOverlay>
    );
}

/** The shared standalone-player surface used by both kinds of host. */
function StandalonePlayerOverlay() {
    const { activeTrack, isPlayerDismissed } = usePlaybackTrackState();
    const hidden = useBottomBarsHidden();
    const insets = useSafeAreaInsets();
    const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(
        null,
    );

    if (hidden || !activeTrack || isPlayerDismissed) return null;

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
