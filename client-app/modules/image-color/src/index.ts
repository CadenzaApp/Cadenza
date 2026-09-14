import { requireOptionalNativeModule } from "expo-modules-core";

export interface ImageColorNativeModule {
    getAverageColor(url: string): Promise<string | null>;
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
     * Average color of the image at `url`, as `#rrggbb`.
     *
     * Null rather than a throw for everything that does not produce one: a
     * blank URL, a fetch that fails, an undecodable image, or no native module
     * at all, which is what Expo Go has. Callers render untinted in that case
     * rather than branching on a platform.
     */
    getAverageColor: async (url?: string | null): Promise<string | null> => {
        const target = url?.trim();
        if (!target || !nativeModule) return null;
        try {
            return normalizeHex(await nativeModule.getAverageColor(target));
        } catch {
            return null;
        }
    },
};
