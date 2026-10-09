import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";

import type { TintGradient } from "@/lib/artwork-color-utils";

type TintBackdropProps = {
    /** Shared mode-aware gradient. Renders nothing when null. */
    gradient: TintGradient | null;
};

/**
 * The shared colored wash behind a page. Its Oklch stops are calculated before
 * rendering so every gradient-backed surface uses the same color treatment.
 *
 * Absolutely positioned to fill its parent, so it takes no part in the layout
 * it is dropped into. Inside a scroller's content it runs the whole content
 * height and scrolls with it, with nothing measured, which is what the stops
 * expect: they place the color by how far down the page it is. Renders null for
 * a null gradient, so every caller can mount it unconditionally and let the
 * color decide.
 */
export function TintBackdrop({ gradient }: TintBackdropProps) {
    if (!gradient) return null;

    return (
        <LinearGradient
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
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
