import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useFrameCallback,
    useReducedMotion,
    useSharedValue,
    type SharedValue,
} from "react-native-reanimated";

import { Text } from "@/components/ui/text";

import { ASSISTANT_SUGGESTIONS, shuffled } from "./suggestions";

/** One row's height, in points. */
const ROW = 44;
/** Rows in view: the one in the middle and two on each side. */
const VISIBLE_ROWS = 5;
const HEIGHT = ROW * VISIBLE_ROWS;
/** The drift upward, in points a second: about a row every two and a half seconds. */
const DRIFT = 18;
/** How fast a fling or a stop eases toward the drift, per second. */
const SETTLE = 4;
/** How long the wheel holds still after a finger lifts, in milliseconds. */
const HOLD_MS = 1600;
/** The smallest a row gets, at the wheel's top and bottom edge. */
const EDGE_SCALE = 0.78;

/** `value` wrapped into [-span / 2, span / 2). */
function centered(value: number, span: number) {
    "worklet";
    const wrapped = (((value + span / 2) % span) + span) % span;
    return wrapped - span / 2;
}

/**
 * The empty chat's things to try: a vertical wheel of prompts drifting slowly
 * upward, in a random order that repeats. The row in the middle is full size
 * and the ones above and below shrink and fade, like a picker. A finger on it
 * holds it still, a drag scrolls it with a tick at each row, and it drifts on
 * again shortly after. Under Reduce Motion it does not drift; it still drags.
 * A tap hands the prompt to `onPick`.
 */
export function SuggestionWheel({
    onPick,
}: {
    onPick: (text: string) => void;
}) {
    const [order] = useState(() => shuffled(ASSISTANT_SUGGESTIONS));
    const reduceMotion = useReducedMotion();
    const loop = order.length * ROW;

    // how far the wheel has scrolled, in points; rows wrap around `loop`
    const offset = useSharedValue(0);
    const velocity = useSharedValue(reduceMotion ? 0 : DRIFT);
    const touching = useSharedValue(false);
    const holdMs = useSharedValue(0);
    const lastRow = useSharedValue(0);

    useFrameCallback((frame) => {
        "worklet";
        if (touching.get()) return;
        const dtMs = frame.timeSincePreviousFrame ?? 16;
        const dt = dtMs / 1000;
        const held = holdMs.get() > 0;
        holdMs.set(Math.max(0, holdMs.get() - dtMs));
        const target = reduceMotion || held ? 0 : DRIFT;
        const speed =
            velocity.get() +
            (target - velocity.get()) * Math.min(1, dt * SETTLE);
        velocity.set(speed);
        offset.set(offset.get() + speed * dt);
    });

    const tick = () => void Haptics.selectionAsync();
    const drag = usePanGesture({
        activeOffsetY: [-6, 6],
        maxPointers: 1,
        onBegin: () => {
            "worklet";
            touching.set(true);
            velocity.set(0);
            lastRow.set(Math.round(offset.get() / ROW));
        },
        onUpdate: (event) => {
            "worklet";
            offset.set(offset.get() - event.changeY);
            const row = Math.round(offset.get() / ROW);
            if (row !== lastRow.get()) {
                lastRow.set(row);
                runOnJS(tick)();
            }
        },
        onDeactivate: (event) => {
            "worklet";
            if (event.canceled) return;
            velocity.set(-event.velocityY);
        },
        onFinalize: () => {
            "worklet";
            touching.set(false);
            holdMs.set(HOLD_MS);
        },
    });

    return (
        <GestureDetector gesture={drag}>
            <View
                style={{ height: HEIGHT }}
                className="overflow-hidden"
                accessibilityRole="list"
                accessibilityLabel="Things to try"
            >
                {order.map((text, index) => (
                    <WheelRow
                        key={text}
                        text={text}
                        index={index}
                        loop={loop}
                        offset={offset}
                        onPick={onPick}
                    />
                ))}
            </View>
        </GestureDetector>
    );
}

/** One prompt, placed by the wheel's offset, larger and clearer near the middle. */
function WheelRow({
    text,
    index,
    loop,
    offset,
    onPick,
}: {
    text: string;
    index: number;
    loop: number;
    offset: SharedValue<number>;
    onPick: (text: string) => void;
}) {
    const style = useAnimatedStyle(() => {
        // where the row is from the middle of the wheel, in rows
        const fromMiddle = centered(index * ROW - offset.get(), loop) / ROW;
        const distance = Math.abs(fromMiddle) / ((VISIBLE_ROWS - 1) / 2 + 0.5);
        return {
            transform: [
                { translateY: (HEIGHT - ROW) / 2 + fromMiddle * ROW },
                {
                    scale: interpolate(
                        distance,
                        [0, 1],
                        [1, EDGE_SCALE],
                        "clamp",
                    ),
                },
            ],
            opacity: interpolate(distance, [0, 0.45, 1], [1, 0.45, 0], "clamp"),
        };
    });

    return (
        <Animated.View
            style={[
                {
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    height: ROW,
                },
                style,
            ]}
        >
            <Pressable
                onPress={() => onPick(text)}
                accessibilityRole="button"
                accessibilityLabel={text}
                accessibilityHint="Puts it in the message box"
                className="h-full items-center justify-center px-6 active:opacity-60"
            >
                <Text
                    className="text-center text-[17px] font-medium"
                    numberOfLines={1}
                >
                    {text}
                </Text>
            </Pressable>
        </Animated.View>
    );
}
