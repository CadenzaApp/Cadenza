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
export function useTintGradient(sourceColor?: string | null) {
    const { colorScheme = "light" } = useColorScheme();
    return useMemo<TintGradient | null>(
        () =>
            sourceColor ? createTintGradient(sourceColor, colorScheme) : null,
        [colorScheme, sourceColor],
    );
}
