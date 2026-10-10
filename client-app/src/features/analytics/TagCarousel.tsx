import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
    Pressable,
    StyleSheet,
    View,
    type GestureResponderEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    Easing,
    LinearTransition,
    runOnJS,
    useAnimatedStyle,
    useFrameCallback,
    useSharedValue,
    withTiming,
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
/** A tag sliding to the pin. */
const MOVE_MS = 560;
/** The row closing or opening a gap: a little quicker, so it is ready first. */
const GAP_MS = 420;
/** A tag leaving the pin: how long it takes to blend away, and how far left. */
const LEAVE_MS = 420;
const LEAVE_DISTANCE = 40;
/** A tag appearing at the pin without a slide. */
const APPEAR_MS = 260;
const EASE = Easing.inOut(Easing.cubic);

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

/**
 * The tags listened to in the shown span. The selected one is pinned at the
 * left and holds still; the rest drift behind it in a row that loops forever,
 * fading out as they pass under it rather than cutting off at its edge.
 *
 * Tapping a drifting tag slides it to the pin while the row closes the gap
 * behind it; the drift holds still for the slide. A tag that leaves the pin,
 * let go or replaced, slides a little left and blends away, and its slot opens
 * back up in the row. Nothing ever trades places.
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
    // where the pinned tag slides in from, while that pin is moving
    const [pinFrom, setPinFrom] = useState<{ id: number; x: number } | null>(
        null,
    );
    const [leaving, setLeaving] = useState<TagListeningTime[]>([]);

    // a pin that changes sends the old one off. set during render, so the row
    // and the overlays switch in the same frame
    const [shownPin, setShownPin] = useState(selected);
    if (selected?.id !== shownPin?.id) {
        setShownPin(selected);
        // a pin cut off mid slide never reports landing, so let it go here
        // or the drift would stay held
        if (pinFrom && pinFrom.id !== selected?.id) setPinFrom(null);
        if (shownPin) {
            setLeaving((list) => [
                ...list.filter(
                    (tag) => tag.id !== shownPin.id && tag.id !== selected?.id,
                ),
                shownPin,
            ]);
        }
    }

    const drifting = tags.filter((tag) => tag.id !== selected?.id);

    const pin = (id: number, chipPageX: number) => {
        const view = box.current;
        if (!view) return onSelect(id);
        view.measureInWindow((boxX) => {
            setPinFrom({ id, x: Math.max(0, chipPageX - boxX) });
            onSelect(id);
        });
    };
    const gone = (id: number) =>
        setLeaving((list) => list.filter((tag) => tag.id !== id));

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
            className="overflow-hidden"
            style={{ height: HEIGHT }}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
            <MaskedView style={StyleSheet.absoluteFill} maskElement={mask}>
                <DriftingRow
                    tags={drifting}
                    paused={pinFrom != null}
                    totalMs={totalMs}
                    onSelect={pin}
                />
            </MaskedView>

            {/* under the new pin, so a replacement slides in over it */}
            {leaving.map((tag) => (
                <Moving
                    key={`leave:${tag.id}`}
                    mode="leave"
                    onDone={() => gone(tag.id)}
                >
                    <TagChip tag={tag} totalMs={totalMs} selected />
                </Moving>
            ))}

            {/* one component for the pin's whole life, keyed by tag: how it
                enters is read once at mount, so landing never remounts it */}
            {selected ? (
                <Moving
                    key={`pin:${selected.id}`}
                    from={pinFrom?.id === selected.id ? pinFrom.x : 0}
                    // pinned some other way, like a span without the tag
                    mode={pinFrom?.id === selected.id ? "slide" : "appear"}
                    onDone={() =>
                        setPinFrom((from) =>
                            from?.id === selected.id ? null : from,
                        )
                    }
                    onWidth={setPinnedWidth}
                >
                    <TagChip
                        tag={selected}
                        totalMs={totalMs}
                        selected
                        onPress={onRelease}
                    />
                </Moving>
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

/**
 * A chip at the pin that got there, or is going, one of three ways: `slide`
 * in from `from` points right of it, `appear` in place, or `leave`, sliding a
 * little left as it blends away. Calls `onDone` once it finishes.
 *
 * The mode is read once, at mount. Later props are ignored, so a parent can
 * drop its in-flight state on landing without a remount. Keyed by tag, so
 * each move starts fresh.
 */
function Moving({
    from = 0,
    mode,
    onDone,
    onWidth,
    children,
}: {
    from?: number;
    mode: "slide" | "appear" | "leave";
    onDone: () => void;
    onWidth?: (width: number) => void;
    children: ReactNode;
}) {
    const x = useSharedValue(mode === "slide" ? from : 0);
    const opacity = useSharedValue(mode === "appear" ? 0 : 1);

    useEffect(() => {
        const finish = (finished?: boolean) => {
            "worklet";
            if (finished) runOnJS(onDone)();
        };
        if (mode === "slide") {
            x.set(withTiming(0, { duration: MOVE_MS, easing: EASE }, finish));
        } else if (mode === "appear") {
            opacity.set(withTiming(1, { duration: APPEAR_MS }, finish));
        } else {
            const leave = { duration: LEAVE_MS, easing: EASE };
            x.set(withTiming(-LEAVE_DISTANCE, leave));
            opacity.set(withTiming(0, leave, finish));
        }
        // once per move: a new move is a new key, not new props
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const style = useAnimatedStyle(() => ({
        transform: [{ translateX: x.get() }],
        opacity: opacity.get(),
    }));

    return (
        <Animated.View
            className="absolute left-0 top-0 h-full"
            style={style}
            pointerEvents={mode === "leave" ? "none" : "auto"}
            onLayout={
                onWidth
                    ? (event) => onWidth(event.nativeEvent.layout.width)
                    : undefined
            }
        >
            {children}
        </Animated.View>
    );
}

/**
 * Tags in one row that drifts left forever. A swipe drags it and a fling
 * carries on, then eases back to the drift. A row that fits sits still.
 *
 * The loop is copies of the row side by side, enough to cover the box, moved
 * by one copy's width at most and wrapped, so the seam never shows. Only the
 * first copy is read by a screen reader. Chips slide when one leaves or comes
 * back, so a gap closes or opens rather than jumping.
 */
function DriftingRow({
    tags,
    paused,
    totalMs,
    onSelect,
}: {
    tags: TagListeningTime[];
    /** Holds the drift still, without stopping a drag. */
    paused: boolean;
    totalMs: number;
    /** With the tapped chip's left edge, in window points. */
    onSelect: (id: number, chipPageX: number) => void;
}) {
    const [box, setBox] = useState(0);
    const [run, setRun] = useState(0);
    const loops = box > 0 && run > box;
    const copies = loops ? Math.ceil(box / run) + 1 : 1;

    const offset = useSharedValue(0);
    const velocity = useSharedValue(-DRIFT);
    const dragging = useSharedValue(false);
    const holding = useSharedValue(false);
    const loopWidth = useSharedValue(0);

    useEffect(() => {
        loopWidth.set(loops ? run : 0);
        if (!loops) offset.set(0);
    }, [loopWidth, loops, offset, run]);
    useEffect(() => {
        holding.set(paused);
    }, [holding, paused]);

    useFrameCallback((frame) => {
        "worklet";
        const width = loopWidth.get();
        if (width <= 0 || dragging.get() || holding.get()) return;
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
                        <Animated.View
                            key={copy}
                            className="flex-row"
                            layout={LinearTransition.duration(GAP_MS)}
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
                                <Animated.View
                                    key={tag.id}
                                    layout={LinearTransition.duration(GAP_MS)}
                                >
                                    <TagChip
                                        tag={tag}
                                        totalMs={totalMs}
                                        selected={false}
                                        onPress={(event) =>
                                            onSelect(tag.id, chipLeft(event))
                                        }
                                    />
                                </Animated.View>
                            ))}
                        </Animated.View>
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
 * With no `onPress` it is only a picture of a tag, for one on its way out.
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
    onPress?: (event: GestureResponderEvent) => void;
}) {
    const percent = sharePercent(shareOf(tag.listening_ms, totalMs));
    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
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
