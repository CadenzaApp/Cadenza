import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";

/** How long a change of color takes to settle. */
export const CROSSFADE_MS = 1000;

type CrossfadeProps<T> = {
    /** What to show. Null fades the last value out. */
    value: T | null;
    /** Identity of a value. A new key starts a fade, the same key does not. */
    keyOf: (value: T) => string;
    /** Draws one value. Each layer fills the crossfade's parent. */
    render: (value: T) => ReactNode;
    /** What is showing before the first value. Null fades the first one in. */
    initial?: T | null;
    /**
     * How opaque a layer is at its most opaque. An opaque layer hides the one
     * under it, so the old layer stays put. A see through one would add to it
     * and flash brighter mid fade, so the old layer fades out just fast enough
     * that the two together stay as opaque as one.
     */
    alpha?: number;
    /**
     * Whether the first value fades in over nothing. Off, it appears at once
     * and only later changes fade. For a layer drawn over another that fades
     * the same way: both half see through at once let the bottom one show.
     */
    fadeFromNothing?: boolean;
};

/**
 * Fades from one value to the next instead of swapping. The new layer fades in
 * over the old one, which stays fully opaque under it, so the midpoint never
 * dips to the page behind. The old layer is dropped once the new one lands.
 *
 * Translucent layers pass their `alpha`, see the prop.
 *
 * Absolutely positioned to fill its parent. Opacity runs on the UI thread, so
 * the layers render once per change, not once per frame.
 */
export function Crossfade<T>({
    value,
    keyOf,
    render,
    initial = null,
    alpha = 1,
    fadeFromNothing = true,
}: CrossfadeProps<T>) {
    const [settled, setSettled] = useState<T | null>(
        initial ?? (fadeFromNothing ? null : value),
    );
    // the first value after nothing lands straight away, set during render so
    // it never draws a frame faded
    if (!fadeFromNothing && settled === null && value !== null) {
        setSettled(value);
    }
    const key = value === null ? null : keyOf(value);
    const settledKey = settled === null ? null : keyOf(settled);
    const fading = key !== settledKey;
    const progress = useSharedValue(0);

    useEffect(() => {
        // reset only once the landed layer is static, so nothing is ever
        // drawn at the wrong opacity, and the next fade mounts at zero
        if (!fading) {
            progress.set(0);
            return;
        }
        progress.set(
            withTiming(1, { duration: CROSSFADE_MS }, (finished) => {
                if (finished) runOnJS(setSettled)(value);
            }),
        );
    }, [fading, key, progress, value]);

    const incomingStyle = useAnimatedStyle(() => ({
        opacity: progress.get(),
    }));
    const toNothing = value === null;
    const outgoingStyle = useAnimatedStyle(() => ({
        opacity: toNothing
            ? 1 - progress.get()
            : underOpacity(progress.get(), alpha),
    }));

    return (
        <>
            {settled !== null ? (
                <Animated.View
                    key={settledKey}
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFill,
                        fading && (toNothing || alpha < 1)
                            ? outgoingStyle
                            : null,
                    ]}
                >
                    {render(settled)}
                </Animated.View>
            ) : null}
            {fading && value !== null ? (
                <Animated.View
                    key={key}
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, incomingStyle]}
                >
                    {render(value)}
                </Animated.View>
            ) : null}
        </>
    );
}

/**
 * Opacity of the old layer, `progress` into a fade, so that it and the new
 * layer over it (at `progress`) together are as opaque as one layer of
 * `alpha`. Solves 1 - (1 - o * alpha)(1 - progress * alpha) = alpha for o.
 */
export function underOpacity(progress: number, alpha: number) {
    "worklet";
    if (alpha >= 1) return 1;
    return (1 - (1 - alpha) / (1 - progress * alpha)) / alpha;
}
