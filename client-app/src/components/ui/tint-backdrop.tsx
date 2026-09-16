import { StyleSheet } from "react-native";

import { LinearGradient } from "@/components/ui/linear-gradient";
import { darken } from "@/lib/artwork-color";

type TintBackdropProps = {
    /** `#rrggbb` from `useArtworkTint`. Renders nothing when null. */
    tint: string | null;
    /**
     * Height to run the gradient over, for a surface whose content is taller
     * than the screen. Omit to fill the surface it sits in.
     */
    height?: number;
    /** Brightness the bottom of the gradient lands on, as a fraction. */
    depth?: number;
};

const DEFAULT_DEPTH = 0.3;

/**
 * The artwork-colored wash behind a page. Full strength at the top, darkening
 * with distance down it.
 *
 * It never reaches black. The bottom is the same color at `depth` of its
 * brightness, which is what keeps a page reading as one color rather than a
 * gradient into a hole. Music does the same.
 *
 * Absolutely positioned, so it takes no part in the layout it is dropped into.
 * Renders null for a null tint, so every caller can mount it unconditionally
 * and let the color decide.
 */
export function TintBackdrop({
    tint,
    height,
    depth = DEFAULT_DEPTH,
}: TintBackdropProps) {
    if (!tint) return null;

    return (
        <LinearGradient
            pointerEvents="none"
            style={
                height === undefined
                    ? StyleSheet.absoluteFill
                    : {
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          height,
                      }
            }
            colors={[tint, darken(tint, depth)]}
        />
    );
}
