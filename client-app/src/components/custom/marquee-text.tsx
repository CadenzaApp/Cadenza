import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, {
    Easing,
    cancelAnimation,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming,
} from "react-native-reanimated";

import { Text } from "@/components/ui/text";

/** Points scrolled per second. */
const SPEED = 30;
/** Space between the end of the text and its next copy. */
const GAP = 32;
/** Rest at the start before each pass. */
const PAUSE_MS = 2000;

/**
 * One line of text that scrolls sideways when it does not fit, and sits still
 * like a plain truncated line when it does. Each pass rests at the start,
 * scrolls one copy out as the next comes in, and starts over. With reduce
 * motion on it stays truncated.
 */
export function MarqueeText({
    children,
    className,
}: {
    children: string;
    className?: string;
}) {
    const reducedMotion = useReducedMotion();
    const [boxWidth, setBoxWidth] = useState(0);
    const [textWidth, setTextWidth] = useState(0);
    const scrolls = !reducedMotion && boxWidth > 0 && textWidth > boxWidth + 1;
    const loop = textWidth + GAP;

    const offset = useSharedValue(0);
    useEffect(() => {
        cancelAnimation(offset);
        offset.set(0);
        if (!scrolls) return;
        offset.set(
            withRepeat(
                withSequence(
                    withDelay(
                        PAUSE_MS,
                        withTiming(-loop, {
                            duration: (loop / SPEED) * 1000,
                            easing: Easing.linear,
                        }),
                    ),
                    withTiming(0, { duration: 0 }),
                ),
                -1,
            ),
        );
        return () => cancelAnimation(offset);
    }, [scrolls, loop, offset]);
    const rowStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: offset.get() }],
    }));

    return (
        <View
            className="overflow-hidden"
            accessible
            accessibilityRole="text"
            accessibilityLabel={children}
            onLayout={(event) => setBoxWidth(event.nativeEvent.layout.width)}
        >
            {/* lays the text out unconstrained, only to learn its width */}
            <View
                pointerEvents="none"
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
                className="absolute flex-row opacity-0"
                style={{ width: 10000 }}
            >
                <Text
                    className={className}
                    onLayout={(event) =>
                        // rounded up, so the copies never wrap at their width
                        setTextWidth(Math.ceil(event.nativeEvent.layout.width))
                    }
                >
                    {children}
                </Text>
            </View>
            {scrolls ? (
                <Animated.View
                    className="flex-row"
                    style={[{ width: loop * 2 }, rowStyle]}
                >
                    <Text className={className} style={{ width: textWidth }}>
                        {children}
                    </Text>
                    <View style={{ width: GAP }} />
                    <Text className={className} style={{ width: textWidth }}>
                        {children}
                    </Text>
                </Animated.View>
            ) : (
                <Text className={className} numberOfLines={1}>
                    {children}
                </Text>
            )}
        </View>
    );
}
