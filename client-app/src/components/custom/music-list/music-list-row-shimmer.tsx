import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "expo-router/react-navigation";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
    cancelAnimation,
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

const SWEEP_MS = 1700;
const SWEEPS = 2;
/** The band's width as a fraction of the row's. */
const BAND = 0.4;
/** How far the band leans off vertical. */
const TILT_DEG = 20;

/**
 * A soft, slightly tilted band of light swept across a row a couple of times,
 * to point it out.
 * Lays over the row without taking touches, and calls `onDone` once it has
 * finished so the caller can drop it for good.
 */
export function MusicListRowShimmer({ onDone }: { onDone: () => void }) {
    const { dark } = useTheme();
    const [size, setSize] = useState({ width: 0, height: 0 });
    const { width, height } = size;
    const progress = useSharedValue(0);
    const band = width * BAND;

    useEffect(() => {
        if (width === 0) return;
        progress.set(
            withRepeat(
                withTiming(1, {
                    duration: SWEEP_MS,
                    easing: Easing.inOut(Easing.quad),
                }),
                SWEEPS,
                false,
                (finished) => {
                    if (finished) runOnJS(onDone)();
                },
            ),
        );
        return () => cancelAnimation(progress);
    }, [onDone, progress, width]);

    // tilted, the band reaches past its own width at the top and bottom, so
    // it starts and ends that much further out to clear the row
    const reach = band + height;
    const sweep = useAnimatedStyle(() => ({
        transform: [
            { translateX: -reach + progress.get() * (width + 2 * reach) },
            { rotate: `${TILT_DEG}deg` },
        ],
    }));
    const light = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)";

    return (
        <View
            pointerEvents="none"
            className="absolute inset-0 overflow-hidden"
            onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                setSize({ width, height });
            }}
        >
            {/* three rows tall, so the tilted band still covers the row */}
            <Animated.View
                className="absolute left-0"
                style={[
                    { top: -height, height: height * 3, width: band },
                    sweep,
                ]}
            >
                <LinearGradient
                    colors={["transparent", light, "transparent"]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={StyleSheet.absoluteFill}
                />
            </Animated.View>
        </View>
    );
}
