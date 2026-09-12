import { useRouter } from "expo-router";
import { useEffect } from "react";

import { MediaPlayerExpanded } from "@/components/custom/media-player/expanded";
import { SheetScreen } from "@/components/ui/sheet-screen";
import { usePlayback } from "@/lib/playback";

export default function PlayerScreen() {
    const router = useRouter();
    const { activeTrack } = usePlayback();

    // Playback can stop while the sheet is open. Close rather than sit here
    // showing an empty sheet.
    useEffect(() => {
        if (!activeTrack && router.canGoBack()) router.back();
    }, [activeTrack, router]);

    if (!activeTrack) return null;

    return (
        <SheetScreen title="Now Playing">
            <MediaPlayerExpanded />
        </SheetScreen>
    );
}
