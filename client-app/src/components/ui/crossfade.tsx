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
};

/**
 * Fades from one value to the next instead of swapping. The new layer fades in
 * over the old one, which stays fully opaque under it, so the midpoint never
 * dips to the page behind. The old layer is dropped once the new one lands.
 *
 * Absolutely positioned to fill its parent. Opacity runs on the UI thread, so
 * the layers render once per change, not once per frame.
 */
export function Crossfade<T>({
    value,
    keyOf,
    render,
    initial = null,
}: CrossfadeProps<T>) {
    const [settled, setSettled] = useState<T | null>(initial);
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
    const outgoingStyle = useAnimatedStyle(() => ({
        opacity: 1 - progress.get(),
    }));

    return (
        <>
            {settled !== null ? (
                <Animated.View
                    key={settledKey}
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFill,
                        fading && value === null ? outgoingStyle : null,
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
