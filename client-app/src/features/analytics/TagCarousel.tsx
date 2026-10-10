import { useEffect, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    useAnimatedStyle,
    useFrameCallback,
    useSharedValue,
} from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import {
    useAnalyticsTopTags,
    type AnalyticsWindow,
} from "@/lib/routes/analytics";

/** The most the backend returns in one ranking. */
const MAX_TAGS = 100;
/** Drift, in points a second, leftward. */
const DRIFT = 28;
/** How fast a fling settles back to the drift, per second. */
const SETTLE = 3;
const ITEM_GAP = 20;
const HEIGHT = 20;

/** `x` wrapped into (-width, 0], so one copy's width loops back to the start. */
function wrap(x: number, width: number): number {
    "worklet";
    if (width <= 0) return 0;
    const r = x % width;
    return r > 0 ? r - width : r;
}

/**
 * Every tag played in the window, the user's own only, as one row that drifts
 * left forever. A swipe drags it and a fling carries on, then eases back to
 * the drift. A row that fits sits still.
 *
 * The loop is copies of the row side by side, enough to cover the box, moved
 * by one copy's width at most and wrapped, so the seam never shows.
 */
export function TagCarousel({ window }: { window: AnalyticsWindow }) {
    const { topTags } = useAnalyticsTopTags(window, MAX_TAGS);
    const tags = topTags?.entries ?? [];

    const [box, setBox] = useState(0);
    const [run, setRun] = useState(0);
    const loops = box > 0 && run > box;

    const offset = useSharedValue(0);
    const velocity = useSharedValue(-DRIFT);
    const dragging = useSharedValue(false);
    const loopWidth = useSharedValue(0);

    useEffect(() => {
        loopWidth.set(loops ? run : 0);
        if (!loops) offset.set(0);
    }, [loopWidth, loops, offset, run]);

    useFrameCallback((frame) => {
        "worklet";
        const width = loopWidth.get();
        if (width <= 0 || dragging.get()) return;
        const dt = (frame.timeSincePreviousFrame ?? 16) / 1000;
        const speed =
            velocity.get() +
            (-DRIFT - velocity.get()) * Math.min(1, dt * SETTLE);
        velocity.set(speed);
        offset.set(wrap(offset.get() + speed * dt, width));
    });

    const swipe = Gesture.Pan()
        .enabled(loops)
        // horizontal wins early, a clearly vertical drag scrolls the page
        .activeOffsetX([-6, 6])
        .failOffsetY([-24, 24])
        // a finger down holds it still, whether or not it drags
        .onBegin(() => dragging.set(true))
        .onChange((event) => {
            offset.set(wrap(offset.get() + event.changeX, loopWidth.get()));
        })
        .onEnd((event) => velocity.set(event.velocityX))
        .onFinalize(() => dragging.set(false));

    const slide = useAnimatedStyle(() => ({
        transform: [{ translateX: offset.get() }],
    }));

    if (topTags && tags.length === 0) {
        return (
            <Text
                className="text-muted-foreground text-xs"
                style={{ height: HEIGHT }}
            >
                No tags played
            </Text>
        );
    }

    const copies = loops ? Math.ceil(box / run) + 1 : 1;
    return (
        <GestureDetector gesture={swipe}>
            <View
                className="overflow-hidden"
                style={{ height: HEIGHT }}
                onLayout={(event) => setBox(event.nativeEvent.layout.width)}
                accessibilityLabel={`Tags played: ${tags.map((tag) => tag.name).join(", ")}`}
            >
                <Animated.View
                    className="absolute left-0 top-0 h-full flex-row"
                    style={slide}
                >
                    {Array.from({ length: copies }, (_, copy) => (
                        <View
                            key={copy}
                            className="flex-row"
                            onLayout={
                                copy === 0
                                    ? (event) =>
                                          setRun(event.nativeEvent.layout.width)
                                    : undefined
                            }
                        >
                            {tags.map((tag) => (
                                <View
                                    key={tag.id}
                                    className="flex-row items-center gap-1.5"
                                    style={{ marginRight: ITEM_GAP }}
                                >
                                    <View
                                        className="h-2.5 w-2.5 rounded-full"
                                        style={{ backgroundColor: tag.color }}
                                    />
                                    <Text className="text-xs" numberOfLines={1}>
                                        {tag.name}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    ))}
                </Animated.View>
            </View>
        </GestureDetector>
    );
}
