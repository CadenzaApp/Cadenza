import { useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePlayback } from "./playback";

export const COMPACT_PLAYER_HEIGHT = 64;
export const TAB_BAR_HEIGHT = 54;
export const FLOATING_ACTION_SIZE = 56;

const DEFAULT_ACTION_BOTTOM = 24;
const OVERLAY_GAP = 12;

/** Insets expressed in the coordinate space of the active screen content. */
export function useScreenOverlayInsets() {
    const { activeTrack } = usePlayback();
    const segments = useSegments();
    const insets = useSafeAreaInsets();
    const rootSegment = segments[0];
    const supportsCompactPlayer =
        rootSegment === "(tabs)" || rootSegment === "tag";
    const compactPlayerVisible = activeTrack != null && supportsCompactPlayer;

    // Tab content already ends above the tab bar and its safe-area inset.
    const playerBottomInset = compactPlayerVisible
        ? COMPACT_PLAYER_HEIGHT + (rootSegment === "tag" ? insets.bottom : 0)
        : 0;
    const floatingActionBottom = compactPlayerVisible
        ? playerBottomInset + OVERLAY_GAP
        : DEFAULT_ACTION_BOTTOM;

    return {
        compactPlayerVisible,
        playerBottomInset,
        floatingActionBottom,
        listBottomInset: Math.max(
            40,
            floatingActionBottom + FLOATING_ACTION_SIZE + OVERLAY_GAP,
        ),
    };
}
