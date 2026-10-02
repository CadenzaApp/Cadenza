import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";

import type { TintGradient } from "@/lib/artwork-color-utils";

type TintBackdropProps = {
    /** Shared mode-aware gradient. Renders nothing when null. */
    gradient: TintGradient | null;
    /**
     * Height to run the gradient over, for a surface whose content is taller
     * than the screen. Omit to fill the surface it sits in.
     */
    height?: number;
};

/**
 * The shared colored wash behind a page. Its Oklch stops are calculated before
 * rendering so every gradient-backed surface uses the same color treatment.
 *
 * Absolutely positioned, so it takes no part in the layout it is dropped into.
 * Renders null for a null gradient, so every caller can mount it
 * unconditionally and let the color decide.
 */
export function TintBackdrop({ gradient, height }: TintBackdropProps) {
    if (!gradient) return null;

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
            colors={gradient.colors}
        />
    );
}

/**
 * Fixed colors beneath a scrolling tint. The scrolling gradient hides the
 * center boundary; elastic overscroll reveals only the matching endpoint at
 * the edge being pulled.
 */
export function TintOverscrollBackdrop({
    gradient,
}: Pick<TintBackdropProps, "gradient">) {
    if (!gradient) return null;

    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View
                className="flex-1"
                style={{ backgroundColor: gradient.colors[0] }}
            />
            <View
                className="flex-1"
                style={{
                    backgroundColor:
                        gradient.colors[gradient.colors.length - 1],
                }}
            />
        </View>
    );
}
