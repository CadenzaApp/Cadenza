import { ImageColor, type ImageRegion } from "@image-color";
import { useColorScheme } from "nativewind";
import { useMemo } from "react";
import useSWRImmutable from "swr/immutable";

import { readableTextColor } from "@/components/custom/tag-pill";
import { coverPageColor } from "@/lib/artwork-color-utils";
export { averageArtworkColors } from "@/lib/artwork-color-utils";

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
    const averaged = useSWRImmutable<string | null>(key, () =>
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

/** The bottom half of an image, where a full-bleed cover meets its page. */
export const BOTTOM_HALF: ImageRegion = { x: 0, y: 0.5, width: 1, height: 0.5 };

/**
 * The top edge of an image cut into `count` side by side strips, left to
 * right, each `depth` of the image tall. What a full-bleed cover's room above
 * it is colored from, a strip at a time.
 */
export function topEdgeSections(count: number, depth: number): ImageRegion[] {
    return Array.from({ length: count }, (_, index) => ({
        x: index / count,
        y: 0,
        width: 1 / count,
        height: depth,
    }));
}

/**
 * Average color of each region of the image at `url`, in order, null for one
 * with none. Null as a whole until they land. Always the averaged pixels,
 * never Apple's color, since Apple's describes the whole image.
 */
export function useArtworkRegionColors(
    url: string | null | undefined,
    regions: readonly ImageRegion[],
): (string | null)[] | null {
    const { data } = useSWRImmutable<(string | null)[]>(
        url
            ? [
                  "ImageColor.getAverageColors",
                  url,
                  ...regions.flatMap(({ x, y, width, height }) => [
                      x,
                      y,
                      width,
                      height,
                  ]),
              ]
            : null,
        () =>
            Promise.all(
                regions.map((region) =>
                    ImageColor.getAverageColor(url, region),
                ),
            ),
    );
    return data ?? null;
}

/** `useArtworkRegionColors` for one region. */
export function useArtworkRegionColor(
    url: string | null | undefined,
    region: ImageRegion,
): string | null {
    return useArtworkRegionColors(url, [region])?.[0] ?? null;
}

/**
 * The flat page color under a full-bleed cover at `url`: the average of the
 * cover's bottom half, where the fade meets the page, set to the mode's cover
 * page lightness (`coverPageColor`). `fallback`, usually the whole cover's
 * tint, stands in until that lands. Null with neither.
 */
export function useCoverPageColor(
    url: string | null | undefined,
    fallback?: string | null,
): string | null {
    const { colorScheme = "light" } = useColorScheme();
    const source = useArtworkRegionColor(url, BOTTOM_HALF) ?? fallback ?? null;
    return useMemo(
        () => (source ? coverPageColor(source, colorScheme) : null),
        [source, colorScheme],
    );
}

/**
 * The color of each source, in order, null for one with none. Apple's color
 * where there is one, else the averaged image, the same as `useArtworkTint`,
 * but for a list in one read.
 */
export function useArtworkColors(
    sources: readonly (ArtworkSource | null | undefined)[],
): (string | null)[] {
    const toAverage = sources.map((source) =>
        source && !source.artworkColor
            ? (source.artworkUrlSmall ?? source.artworkUrl ?? null)
            : null,
    );
    const urls = toAverage.filter((url): url is string => url !== null);
    const averaged = useSWRImmutable<(string | null)[]>(
        urls.length > 0 ? ["ImageColor.getAverageColors", ...urls] : null,
        () => Promise.all(urls.map((url) => ImageColor.getAverageColor(url))),
    );

    let next = 0;
    return sources.map((source, index) => {
        if (source?.artworkColor) return source.artworkColor;
        if (toAverage[index] === null) return null;
        return averaged.data?.[next++] ?? null;
    });
}
