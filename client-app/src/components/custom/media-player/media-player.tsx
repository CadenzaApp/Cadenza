import { useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useCallback } from "react";

import { usePlayback } from "@/lib/playback";

import { MediaPlayerCompact, type MediaPlayerPlacement } from "./compact";

type Props = {
    placement: MediaPlayerPlacement;
    standalone?: boolean;
    failedArtworkUrl: string | null;
    onArtworkError: (url: string | null) => void;
};

/** Playback wiring shared by both native accessory placements and the fallback. */
export function MediaPlayer({
    placement,
    standalone,
    failedArtworkUrl,
    onArtworkError,
}: Props) {
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
    const artworkUrl = activeTrack?.artworkUrl?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" &&
        artworkUrl !== failedArtworkUrl &&
        /^https?:\/\//i.test(artworkUrl);
    const openPlayer = useCallback(() => router.push("/player"), [router]);

    if (!activeTrack) return null;

    return (
        <MediaPlayerCompact
            track={activeTrack}
            placement={placement}
            standalone={standalone}
            artworkUrl={artworkUrl}
            canRenderArtwork={canRenderArtwork}
            isPlaying={isPlaying}
            isLoading={isLoading}
            canSkipToNext={canSkipToNext}
            textColor={colors.text}
            onExpand={openPlayer}
            onArtworkError={() => onArtworkError(artworkUrl ?? null)}
            onTogglePlayback={() => void togglePlayback(activeTrack)}
            onSkipToNext={() => void skipToNext()}
        />
    );
}
