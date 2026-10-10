import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
    Pressable,
    StyleSheet,
    View,
    type GestureResponderEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    Easing,
    FadeInLeft,
    FadeOut,
    useAnimatedStyle,
    useFrameCallback,
    useSharedValue,
    withTiming,
    type EntryAnimationsValues,
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
/** How far past the pinned tag the row takes to fade in from nothing. */
const FADE = 36;
/** How long a tapped tag takes to slide over to the pin. */
const PIN_MS = 280;

/** `x` wrapped into (-width, 0], so one copy's width loops back to the start. */
function wrap(x: number, width: number): number {
    "worklet";
    if (width <= 0) return 0;
    const r = x % width;
    return r > 0 ? r - width : r;
}

type Props = {
    /** Every tag listened to in the shown span, most first. */
    tags: TagListeningTime[];
    /** The span's listening time, which each chip's percent is of. */
    totalMs: number;
    /** False until the first read lands, so the empty state does not flash. */
    loaded: boolean;
    /** Pinned at the left, out of the drifting row. Null for none. */
    selected: TagListeningTime | null;
    onSelect: (id: number) => void;
    /** Lets go of the pinned tag, which drops back into the row. */
    onRelease: () => void;
};

/** A tag being pinned, and where in the carousel it was tapped from. */
type PinFrom = { id: number; x: number };

/**
 * The tags listened to in the shown span. The selected one is pinned at the
 * left and holds still; the rest drift behind it in a row that loops forever,
 * fading out as they pass under it rather than cutting off at its edge.
 * Tapping a drifting tag slides it over to the pin, tapping the pinned one
 * lets go of it and it drifts again.
 *
 * The row stays mounted through every state, empty included, so a new span
 * swaps its chips in place and the drift carries on where it was.
 */
export function TagCarousel({
    tags,
    totalMs,
    loaded,
    selected,
    onSelect,
    onRelease,
}: Props) {
    const box = useRef<View>(null);
    const [width, setWidth] = useState(0);
    const [pinnedWidth, setPinnedWidth] = useState(0);
    const [pinFrom, setPinFrom] = useState<PinFrom | null>(null);
    const drifting = tags.filter((tag) => tag.id !== selected?.id);

    // where the tapped chip sits in the carousel, so the pin can start there
    const pin = (id: number, chipPageX: number) => {
        const view = box.current;
        if (!view) return onSelect(id);
        view.measureInWindow((boxX) => {
            setPinFrom({ id, x: Math.max(0, chipPageX - boxX) });
            onSelect(id);
        });
    };

    const fades = selected != null && pinnedWidth > 0 && width > 0;
    const mask = fades ? (
        <LinearGradient
            style={StyleSheet.absoluteFill}
            colors={["transparent", "transparent", "black"]}
            locations={[
                0,
                Math.min(1, pinnedWidth / width),
                Math.min(1, (pinnedWidth + FADE) / width),
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
        />
    ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "black" }]} />
    );

    return (
        <View
            ref={box}
            style={{ height: HEIGHT }}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
            <MaskedView style={StyleSheet.absoluteFill} maskElement={mask}>
                <DriftingRow tags={drifting} totalMs={totalMs} onSelect={pin} />
            </MaskedView>
            {selected ? (
                // keyed by tag, so each pin animates in fresh
                <Animated.View
                    key={selected.id}
                    className="absolute left-0 top-0 h-full"
                    entering={
                        pinFrom?.id === selected.id
                            ? slideFrom(pinFrom.x)
                            : FadeInLeft.duration(220)
                    }
                    exiting={FadeOut.duration(150)}
                    onLayout={(event) =>
                        setPinnedWidth(event.nativeEvent.layout.width)
                    }
                >
                    <TagChip
                        tag={selected}
                        totalMs={totalMs}
                        selected
                        onPress={onRelease}
                    />
                </Animated.View>
            ) : null}
            {loaded && tags.length === 0 && !selected ? (
                <View
                    pointerEvents="none"
                    className="absolute inset-0 justify-center"
                >
                    <Text className="text-muted-foreground text-xs">
                        No tags listened to
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

/** An entering animation that slides in from `x` points right of its spot. */
function slideFrom(x: number) {
    return (values: EntryAnimationsValues) => {
        "worklet";
        return {
            initialValues: {
                originX: values.targetOriginX + x,
            },
            animations: {
                originX: withTiming(values.targetOriginX, {
                    duration: PIN_MS,
                    easing: Easing.out(Easing.cubic),
                }),
            },
        };
    };
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
    /** With the tapped chip's left edge, in window points. */
    onSelect: (id: number, chipPageX: number) => void;
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
                                    onPress={(event) =>
                                        onSelect(tag.id, chipLeft(event))
                                    }
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
    onPress: (event: GestureResponderEvent) => void;
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

/** The left edge of the chip a touch landed in, in window points. */
function chipLeft(event: GestureResponderEvent): number {
    return event.nativeEvent.pageX - event.nativeEvent.locationX;
}
