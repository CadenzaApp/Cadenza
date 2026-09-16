import { ImageColor } from "@image-color";
import useSWR from "swr";

import { readableTextColor } from "@/components/custom/tag-pill";

/**
 * Anything with artwork. `MusicItem`, `ArtistItem`, and `ArtistDetail` all
 * satisfy it, so a screen hands over whatever it already has.
 */
export type ArtworkSource = {
    artworkColor?: string;
    /**
     * Hand this the *small* artwork. Averaging only needs a thumbnail, and the
     * hero-sized one costs a megabyte to reach the same answer.
     */
    artworkUrl?: string;
    /** Preferred over `artworkUrl` when present, for the same reason. */
    artworkUrlSmall?: string;
};

/**
 * `#rrggbb` to `rgba()`. Gradients fade a color into *itself* rather than into
 * a second color, or the middle of the fade picks up a cast that is not in
 * either end.
 */
export function withAlpha(hex: string, alpha: number) {
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * The same color at a fraction of its brightness. A tinted page bottoms out
 * here rather than at black, which is what keeps it reading as one color
 * instead of a gradient into a hole.
 */
export function darken(hex: string, factor: number) {
    const channel = (start: number) =>
        Math.round(parseInt(hex.slice(start, start + 2), 16) * factor);
    return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
}

export type ArtworkTint = {
    /** `#rrggbb`, or null when the artwork has no color to give. */
    tint: string | null;
    /** Black or white, whichever is readable on `tint`. */
    textColor: string;
    isLoading: boolean;
};

const UNTINTED: ArtworkTint = {
    tint: null,
    textColor: "#ffffff",
    isLoading: false,
};

/**
 * The color a surface paints itself with, from its own artwork.
 *
 * Two sources, in order. Apple ships a representative color on most catalog
 * artwork and it is what Music itself tints with, so it wins and costs nothing.
 * Library artwork usually has none, and only then is the image averaged, which
 * is a download and a decode.
 *
 * SWR because averaging is an idempotent read of a remote thing, keyed by URL,
 * and the same artwork is asked for by the player, the album sheet, and the
 * artist page.
 */
export function useArtworkTint(source?: ArtworkSource | null): ArtworkTint {
    const appleColor = source?.artworkColor;
    const artworkUrl = source?.artworkUrlSmall ?? source?.artworkUrl;
    const key =
        !appleColor && artworkUrl
            ? (["ImageColor.getAverageColor", artworkUrl] as const)
            : null;
    const averaged = useSWR<string | null>(key, () =>
        ImageColor.getAverageColor(artworkUrl),
    );

    const tint = appleColor ?? averaged.data ?? null;
    if (!tint) {
        return averaged.isLoading ? { ...UNTINTED, isLoading: true } : UNTINTED;
    }

    return {
        tint,
        textColor: readableTextColor(tint),
        isLoading: false,
    };
}
