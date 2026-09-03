import { useSegments } from "expo-router";

import { MediaPlayer } from "./media-player";

/**
 * Keeps playback state global while limiting the visual player to authenticated
 * application routes. Stack routes without a tab bar use the safe-area edge.
 */
export function MediaPlayerHost() {
    const segments = useSegments();
    const rootSegment = segments[0];

    if (rootSegment === "(tabs)") {
        return <MediaPlayer compactBottomOffset={54} />;
    }

    if (rootSegment === "tag") {
        return <MediaPlayer compactBottomOffset={0} />;
    }

    return null;
}
