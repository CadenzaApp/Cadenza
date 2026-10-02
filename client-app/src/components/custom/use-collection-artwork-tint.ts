import type { MusicItem } from "@apple-musickit";
import { useMemo } from "react";

import { collectionArtworkGridTracks } from "@/components/custom/track-collection-utils";
import { averageArtworkColors, useArtworkTint } from "@/lib/artwork-color";

/**
 * Selects one four-cell artwork sample, then reuses it for both the collection
 * mosaic and its perceptually averaged background color.
 */
export function useCollectionArtworkTint(tracks: readonly MusicItem[]) {
    const representativeTracks = useMemo(
        () => collectionArtworkGridTracks(tracks),
        [tracks],
    );
    // Keep hook order fixed even when fewer than four distinct artworks exist.
    const firstTint = useArtworkTint(representativeTracks[0]).tint;
    const secondTint = useArtworkTint(representativeTracks[1]).tint;
    const thirdTint = useArtworkTint(representativeTracks[2]).tint;
    const fourthTint = useArtworkTint(representativeTracks[3]).tint;
    const tint = useMemo(
        () =>
            averageArtworkColors([
                firstTint,
                secondTint,
                thirdTint,
                fourthTint,
            ]),
        [firstTint, fourthTint, secondTint, thirdTint],
    );
    const artworkUrls = useMemo(
        () =>
            representativeTracks.flatMap((track) => {
                const url =
                    track.artworkUrlLarge?.trim() || track.artworkUrl?.trim();
                return url ? [url] : [];
            }),
        [representativeTracks],
    );

    return { tint, artworkUrls };
}
