import { useRouter } from "expo-router";
import { useEffect } from "react";

import { MediaPlayerExpanded } from "@/components/custom/media-player/expanded";
import { DetailScreen } from "@/components/ui/detail-screen";
import { useArtworkTint } from "@/lib/artwork-color";
import { usePlayback } from "@/lib/playback";

export default function PlayerScreen() {
    const router = useRouter();
    const { activeTrack } = usePlayback();
    const { tint } = useArtworkTint(activeTrack);

    // Playback can stop while the sheet is open. Close rather than sit here
    // showing an empty sheet.
    useEffect(() => {
        if (!activeTrack && router.canGoBack()) router.back();
    }, [activeTrack, router]);

    if (!activeTrack) return null;

    return (
        <DetailScreen presentation="sheet" title="Now Playing" tint={tint}>
            <MediaPlayerExpanded />
        </DetailScreen>
    );
}
