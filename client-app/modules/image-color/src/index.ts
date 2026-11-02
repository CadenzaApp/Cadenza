import { requireOptionalNativeModule } from "expo";

/** Part of an image, in fractions of its size from the top left. */
export type ImageRegion = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export interface ImageColorNativeModule {
    getAverageColor(
        url: string,
        region: ImageRegion | null,
    ): Promise<string | null>;
}

const nativeModule =
    requireOptionalNativeModule<ImageColorNativeModule>("ImageColorModule");

/** A `#rrggbb` string, or null for anything that is not one. */
function normalizeHex(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const hex = value.trim();
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : null;
}

export const ImageColor = {
    /**
     * Average color of the image at `url`, as `#rrggbb`. With `region`, only
     * that part of it, like the bottom half.
     *
     * Null rather than a throw for everything that does not produce one: a
     * blank URL, a fetch that fails, an undecodable image, or no native module
     * at all, which is what Expo Go has. Callers render untinted in that case
     * rather than branching on a platform.
     */
    getAverageColor: async (
        url?: string | null,
        region?: ImageRegion | null,
    ): Promise<string | null> => {
        const target = url?.trim();
        if (!target || !nativeModule) return null;
        try {
            return normalizeHex(
                await nativeModule.getAverageColor(target, region ?? null),
            );
        } catch {
            return null;
        }
    },
};
