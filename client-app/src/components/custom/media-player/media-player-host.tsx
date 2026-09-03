import { useSegments } from "expo-router";

import { MediaPlayer } from "./media-player";
import { TAB_BAR_HEIGHT } from "@/lib/screen-overlay";

/**
 * Keeps playback state global while limiting the visual player to authenticated
 * application routes. Stack routes without a tab bar use the safe-area edge.
 */
export function MediaPlayerHost() {
    const segments = useSegments();
    const rootSegment = segments[0];

    if (rootSegment === "(tabs)") {
        return <MediaPlayer compactBottomOffset={TAB_BAR_HEIGHT} />;
    }

    if (rootSegment === "tag") {
        return <MediaPlayer compactBottomOffset={0} />;
    }

    return null;
}
