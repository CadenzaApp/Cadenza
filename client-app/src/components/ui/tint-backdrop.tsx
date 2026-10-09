import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    type SharedValue,
} from "react-native-reanimated";

import { Crossfade } from "@/components/ui/crossfade";
import type { TintGradient } from "@/lib/artwork-color-utils";

type TintBackdropProps = {
    /** Shared mode-aware gradient. Renders nothing when null. */
    gradient: TintGradient | null;
};

/**
 * Height in points of the bitmap the gradient is drawn into. The page sees it
 * stretched to its own height, which a smooth top to bottom fade survives.
 */
const BITMAP_HEIGHT = 256;

/**
 * The shared colored wash behind a page. Its Oklch stops are calculated before
 * rendering so every gradient-backed surface uses the same color treatment.
 *
 * Absolutely positioned to fill its parent, so it takes no part in the layout
 * it is dropped into. Inside a scroller's content it runs the whole content
 * height and scrolls with it, which is what the stops expect: they place the
 * color by how far down the page it is. Draws nothing for a null gradient, so
 * every caller can mount it unconditionally and let the color decide.
 *
 * On iOS expo-linear-gradient draws its colors into a bitmap the size of the
 * view, on the main thread, and draws it again on every size change. A page
 * tall view made that bitmap tens of megabytes, redrawn each time the content
 * height moved (the player docking changes the bottom inset), which stalled
 * the tab bar's glass. So the gradient is drawn once at a fixed small height
 * and scaled to the page on the UI thread, and a size change only moves the
 * scale.
 *
 * A change of gradient, including a page's first one, fades in over a second
 * rather than swapping. Null fades the last one out.
 */
export function TintBackdrop({ gradient }: TintBackdropProps) {
    const height = useSharedValue(0);

    function measure(event: LayoutChangeEvent) {
        height.set(event.nativeEvent.layout.height);
    }

    return (
        <View
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            onLayout={measure}
        >
            <Crossfade
                value={gradient}
                keyOf={tintKey}
                render={(shown) => (
                    <StretchedGradient gradient={shown} height={height} />
                )}
            />
        </View>
    );
}

/** One gradient drawn at `BITMAP_HEIGHT` and scaled to `height`. */
function StretchedGradient({
    gradient,
    height,
}: {
    gradient: TintGradient;
    height: SharedValue<number>;
}) {
    const stretch = useAnimatedStyle(() => ({
        // scale runs about the center, so shift it back to the top edge
        transform: [
            { translateY: (height.get() - BITMAP_HEIGHT) / 2 },
            { scaleY: height.get() / BITMAP_HEIGHT },
        ],
    }));

    return (
        <Animated.View style={[{ height: BITMAP_HEIGHT }, stretch]}>
            <LinearGradient
                style={StyleSheet.absoluteFill}
                colors={gradient.colors}
            />
        </Animated.View>
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
    return (
        <Crossfade
            value={gradient}
            keyOf={tintKey}
            render={(shown) => (
                <>
                    <View
                        className="flex-1"
                        style={{ backgroundColor: shown.colors[0] }}
                    />
                    <View
                        className="flex-1"
                        style={{
                            backgroundColor:
                                shown.colors[shown.colors.length - 1],
                        }}
                    />
                </>
            )}
        />
    );
}

function tintKey(gradient: TintGradient) {
    return gradient.colors.join(",");
}
