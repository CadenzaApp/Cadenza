import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";

import type { TintGradient } from "@/lib/artwork-color-utils";

type TintBackdropProps = {
    /** Shared mode-aware gradient. Renders nothing when null. */
    gradient: TintGradient | null;
    /**
     * Runs the gradient over only this much from the top and holds its end
     * color below. For a long scrolling page: a gradient layer as tall as
     * the whole page is expensive to composite, and the tab bar's glass
     * resamples it every frame it animates. A flat color costs nothing.
     */
    span?: number;
};

/**
 * The shared colored wash behind a page. Its Oklch stops are calculated before
 * rendering so every gradient-backed surface uses the same color treatment.
 *
 * Absolutely positioned to fill its parent, so it takes no part in the layout
 * it is dropped into. Inside a scroller's content it runs the whole content
 * height and scrolls with it, with nothing measured. Renders null for a null gradient, so every caller can mount it
 * unconditionally and let the color decide.
 */
export function TintBackdrop({ gradient, span }: TintBackdropProps) {
    if (!gradient) return null;

    if (span === undefined) {
        return (
            <LinearGradient
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
                colors={gradient.colors}
            />
        );
    }

    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <LinearGradient style={{ height: span }} colors={gradient.colors} />
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
