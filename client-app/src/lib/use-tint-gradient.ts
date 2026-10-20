import { useColorScheme } from "nativewind";
import { useMemo } from "react";

import {
    createTintGradient,
    type TintGradient,
} from "@/lib/artwork-color-utils";

/**
 * Converts one source color into the shared light/dark Oklch gradient used by
 * artwork- and tag-tinted surfaces.
 */
export function useTintGradient(
    sourceColor?: string | null,
    useLoadingFallback = false,
) {
    const { colorScheme = "light" } = useColorScheme();
    const color =
        sourceColor ??
        (useLoadingFallback
            ? colorScheme === "dark"
                ? "#000000"
                : "#ffffff"
            : null);
    return useMemo<TintGradient | null>(
        () => (color ? createTintGradient(color, colorScheme) : null),
        [colorScheme, color],
    );
}
