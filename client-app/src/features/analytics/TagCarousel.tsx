import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    FadeInLeft,
    FadeOut,
    useAnimatedStyle,
    useFrameCallback,
    useSharedValue,
} from "react-native-reanimated";

import { TagPill } from "@/components/custom/tag-pill";
import { Text } from "@/components/ui/text";
import type { TagListeningTime } from "@/lib/routes/analytics";

import { shareOf, sharePercent } from "./tag-share";

/** Drift, in points a second, leftward. */
const DRIFT = 28;
/** How fast a fling settles back to the drift, per second. */
const SETTLE = 3;
const ITEM_GAP = 8;
const HEIGHT = 28;
/** The pill's size unit, its font size; it fits inside `HEIGHT`. */
const PILL_HEIGHT = 12;

/** `x` wrapped into (-width, 0], so one copy's width loops back to the start. */
function wrap(x: number, width: number): number {
    "worklet";
    if (width <= 0) return 0;
    const r = x % width;
    return r > 0 ? r - width : r;
}

type Props = {
    /** Every tag listened to in the displayed period, most first. */
    tags: TagListeningTime[];
    /** The period's listening time, which each chip's percent is of. */
    totalMs: number;
    /** False until the first read lands, so the empty state does not flash. */
    loaded: boolean;
    /** Pinned at the left, out of the drifting row. Null for none. */
    selected: TagListeningTime | null;
    onSelect: (id: number) => void;
    /** Lets go of the pinned tag, which drops back into the row. */
    onRelease: () => void;
};

/**
 * The tags listened to in the displayed period. The selected one is pinned
 * at the left and holds still; the rest drift past it in a row that loops
 * forever. Tapping a drifting tag pins it, tapping the pinned one lets go of
 * it and it drifts again.
 */
export function TagCarousel({
    tags,
    totalMs,
    loaded,
    selected,
    onSelect,
    onRelease,
}: Props) {
    if (loaded && tags.length === 0) {
        return (
            <View className="justify-center" style={{ height: HEIGHT }}>
                <Text className="text-muted-foreground text-xs">
                    No tags listened to
                </Text>
            </View>
        );
    }

    const drifting = tags.filter((tag) => tag.id !== selected?.id);
    return (
        <View className="flex-row" style={{ height: HEIGHT }}>
            {selected ? (
                // keyed by tag, so a new pick slides in from the left
                <Animated.View
                    key={selected.id}
                    entering={FadeInLeft.duration(220)}
                    exiting={FadeOut.duration(150)}
                >
                    <TagChip
                        tag={selected}
                        totalMs={totalMs}
                        selected
                        onPress={onRelease}
                    />
                </Animated.View>
            ) : null}
            <DriftingRow
                tags={drifting}
                totalMs={totalMs}
                onSelect={onSelect}
            />
        </View>
    );
}

/**
 * Tags in one row that drifts left forever. A swipe drags it and a fling
 * carries on, then eases back to the drift. A row that fits sits still.
 *
 * The loop is copies of the row side by side, enough to cover the box, moved
 * by one copy's width at most and wrapped, so the seam never shows. Only the
 * first copy is read by a screen reader.
 */
function DriftingRow({
    tags,
    totalMs,
    onSelect,
}: {
    tags: TagListeningTime[];
    totalMs: number;
    onSelect: (id: number) => void;
}) {
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
        // a finger down holds it still, so a tag can be tapped
        .onBegin(() => dragging.set(true))
        .onChange((event) => {
            offset.set(wrap(offset.get() + event.changeX, loopWidth.get()));
        })
        .onEnd((event) => velocity.set(event.velocityX))
        .onFinalize(() => dragging.set(false));

    const slide = useAnimatedStyle(() => ({
        transform: [{ translateX: offset.get() }],
    }));

    const copies = loops ? Math.ceil(box / run) + 1 : 1;
    return (
        <GestureDetector gesture={swipe}>
            <View
                className="flex-1 overflow-hidden"
                onLayout={(event) => setBox(event.nativeEvent.layout.width)}
            >
                <Animated.View
                    className="absolute left-0 top-0 h-full flex-row"
                    style={slide}
                >
                    {Array.from({ length: copies }, (_, copy) => (
                        <View
                            key={copy}
                            className="flex-row"
                            accessibilityElementsHidden={copy > 0}
                            importantForAccessibility={
                                copy > 0 ? "no-hide-descendants" : "auto"
                            }
                            onLayout={
                                copy === 0
                                    ? (event) =>
                                          setRun(event.nativeEvent.layout.width)
                                    : undefined
                            }
                        >
                            {tags.map((tag) => (
                                <TagChip
                                    key={tag.id}
                                    tag={tag}
                                    totalMs={totalMs}
                                    selected={false}
                                    onPress={() => onSelect(tag.id)}
                                />
                            ))}
                        </View>
                    ))}
                </Animated.View>
            </View>
        </GestureDetector>
    );
}

/**
 * One tag, drawn as the app's tag pill with its share as the count. Pinned is
 * solid, drifting is outline, the same way chosen and available tags read
 * everywhere else. Both keep the same width, so pinning never shifts the row.
 */
function TagChip({
    tag,
    totalMs,
    selected,
    onPress,
}: {
    tag: TagListeningTime;
    totalMs: number;
    selected: boolean;
    onPress: () => void;
}) {
    const percent = sharePercent(shareOf(tag.listening_ms, totalMs));
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`${tag.name}, ${percent}% of listening time`}
            accessibilityHint={
                selected ? "Shows every tag again" : "Filters to this tag"
            }
            accessibilityState={{ selected }}
            className="h-full justify-center active:opacity-60"
            style={{ marginRight: ITEM_GAP }}
        >
            <TagPill
                tag={tag}
                height={PILL_HEIGHT}
                count={`${percent}%`}
                appearance={selected ? "solid" : "outline"}
            />
        </Pressable>
    );
}
