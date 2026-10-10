import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import {
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    type ReactNode,
    type Ref,
} from "react";
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
/** A tag sliding to the pin, or back into the row. */
const MOVE_MS = 560;
/** The row closing or opening a gap: a little quicker, so it is ready first. */
const GAP_MS = 420;
/** A tag going back with no slot in this span just fades. */
const FADE_OUT_MS = 260;
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

/** A tag on its way back into the row. `to` is null until its slot lays out. */
type Returning = { tag: TagListeningTime; to: number | null };

/**
 * The tags listened to in the shown span. The selected one is pinned at the
 * left and holds still; the rest drift behind it in a row that loops forever,
 * fading out as they pass under it rather than cutting off at its edge.
 *
 * Tapping a drifting tag slides it to the pin while the row closes the gap
 * behind it. Letting go slides it back into a gap the row opens for it, and
 * picking another tag does both at once. The drift holds still while anything
 * moves, so a slot never runs away from the tag headed for it.
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
    const row = useRef<RowHandle>(null);
    const [width, setWidth] = useState(0);
    const [pinnedWidth, setPinnedWidth] = useState(0);
    // where the pinned tag slides in from, while that pin is moving
    const [pinFrom, setPinFrom] = useState<{ id: number; x: number } | null>(
        null,
    );
    const [returning, setReturning] = useState<Returning[]>([]);

    // a pin that changes sends the old one back. set during render, so the
    // row and the overlays switch in the same frame
    const [shownPin, setShownPin] = useState(selected);
    if (selected?.id !== shownPin?.id) {
        setShownPin(selected);
        // a pin cut off mid slide never reports landing, so let it go here
        // or the drift would stay held
        if (pinFrom && pinFrom.id !== selected?.id) setPinFrom(null);
        setReturning((list) => {
            const rest = list.filter(
                (entry) =>
                    entry.tag.id !== shownPin?.id &&
                    entry.tag.id !== selected?.id,
            );
            return shownPin ? [...rest, { tag: shownPin, to: null }] : rest;
        });
    }

    const drifting = tags.filter((tag) => tag.id !== selected?.id);
    const returningIds = new Set(returning.map((entry) => entry.tag.id));
    const moving = pinFrom != null || returning.length > 0;

    const pin = (id: number, chipPageX: number) => {
        const view = box.current;
        if (!view) return onSelect(id);
        view.measureInWindow((boxX) => {
            setPinFrom({ id, x: Math.max(0, chipPageX - boxX) });
            onSelect(id);
        });
    };
    // a returning tag's slot just laid out, so now it knows where to fly
    const placeReturning = (id: number) => {
        const to = row.current?.placeOf(id) ?? null;
        if (to == null) return;
        setReturning((list) =>
            list.map((entry) =>
                entry.tag.id === id && entry.to == null
                    ? { ...entry, to }
                    : entry,
            ),
        );
    };
    const landed = (id: number) =>
        setReturning((list) => list.filter((entry) => entry.tag.id !== id));

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
                <DriftingRow
                    ref={row}
                    tags={drifting}
                    hidden={returningIds}
                    paused={moving}
                    totalMs={totalMs}
                    onSelect={pin}
                    onHiddenLayout={placeReturning}
                />
            </MaskedView>

            {/* over the row and outside its mask, so a tag in flight stays
                sharp. a tag this span lacks has no slot, so it just fades */}
            {returning.map(({ tag, to }) => {
                const hasSlot = drifting.some((each) => each.id === tag.id);
                if (hasSlot && to == null) return null;
                return (
                    <Flying
                        key={`back:${tag.id}`}
                        from={0}
                        to={to ?? 0}
                        fade={!hasSlot}
                        onDone={() => landed(tag.id)}
                    >
                        <TagChip tag={tag} totalMs={totalMs} selected={false} />
                    </Flying>
                );
            })}

            {selected ? (
                pinFrom?.id === selected.id ? (
                    <Flying
                        key={`pin:${selected.id}`}
                        from={pinFrom.x}
                        to={0}
                        onDone={() => setPinFrom(null)}
                        onWidth={setPinnedWidth}
                    >
                        <TagChip
                            tag={selected}
                            totalMs={totalMs}
                            selected
                            onPress={onRelease}
                        />
                    </Flying>
                ) : (
                    // pinned some other way, like a span without the tag
                    <Animated.View
                        key={`pin:${selected.id}`}
                        className="absolute left-0 top-0 h-full"
                        entering={FadeInLeft.duration(220)}
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
                )
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
 * A chip sliding from `from` to `to`, in points from the carousel's left.
 * `fade` fades it out in place instead, for a tag with nowhere to land.
 * Calls `onDone` once it arrives. Keyed by tag, so each flight starts fresh.
 */
function Flying({
    from,
    to,
    fade = false,
    onDone,
    onWidth,
    children,
}: {
    from: number;
    to: number;
    fade?: boolean;
    onDone: () => void;
    onWidth?: (width: number) => void;
    children: ReactNode;
}) {
    const x = useSharedValue(from);
    const opacity = useSharedValue(1);

    useEffect(() => {
        const finish = (finished?: boolean) => {
            "worklet";
            if (finished) runOnJS(onDone)();
        };
        if (fade) {
            opacity.set(withTiming(0, { duration: FADE_OUT_MS }, finish));
        } else {
            x.set(withTiming(to, { duration: MOVE_MS, easing: EASE }, finish));
        }
        // once per flight: a new flight is a new key, not new props
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

type RowHandle = {
    /**
     * Where a chip sits from the carousel's left, at the first copy of it
     * that is on screen. Null before it has laid out.
     */
    placeOf: (id: number) => number | null;
};

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
    ref,
    tags,
    hidden,
    paused,
    totalMs,
    onSelect,
    onHiddenLayout,
}: {
    ref: Ref<RowHandle>;
    tags: TagListeningTime[];
    /** Laid out but not drawn: tags still flying back to their slot. */
    hidden: ReadonlySet<number>;
    /** Holds the drift still, without stopping a drag. */
    paused: boolean;
    totalMs: number;
    /** With the tapped chip's left edge, in window points. */
    onSelect: (id: number, chipPageX: number) => void;
    /** A hidden chip laid out, so its slot can be found. */
    onHiddenLayout: (id: number) => void;
}) {
    const [box, setBox] = useState(0);
    const [run, setRun] = useState(0);
    const loops = box > 0 && run > box;
    const copies = loops ? Math.ceil(box / run) + 1 : 1;
    // the latest layout, read by `placeOf` from handlers, never in render
    const layout = useRef({ box: 0, run: 0, chips: new Map<number, number>() });

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

    useImperativeHandle(ref, () => ({
        placeOf: (id) => {
            const chipX = layout.current.chips.get(id);
            if (chipX == null) return null;
            const { box: shown, run: loop } = layout.current;
            const first = offset.get() + chipX;
            if (loop <= 0 || first >= 0) return first;
            // the first copy has slid off the left; a later one is on screen
            for (let at = first; at < shown; at += loop) {
                if (at >= 0) return at;
            }
            return first;
        },
    }));

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
                onLayout={(event) => {
                    layout.current.box = event.nativeEvent.layout.width;
                    setBox(event.nativeEvent.layout.width);
                }}
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
                                    ? (event) => {
                                          const runWidth =
                                              event.nativeEvent.layout.width;
                                          layout.current.run = runWidth;
                                          setRun(runWidth);
                                      }
                                    : undefined
                            }
                        >
                            {tags.map((tag) => (
                                <RowChip
                                    key={tag.id}
                                    tag={tag}
                                    totalMs={totalMs}
                                    hidden={hidden.has(tag.id)}
                                    onPress={(event) =>
                                        onSelect(tag.id, chipLeft(event))
                                    }
                                    onLayoutX={
                                        copy === 0
                                            ? (x) => {
                                                  layout.current.chips.set(
                                                      tag.id,
                                                      x,
                                                  );
                                                  if (hidden.has(tag.id)) {
                                                      onHiddenLayout(tag.id);
                                                  }
                                              }
                                            : undefined
                                    }
                                />
                            ))}
                        </Animated.View>
                    ))}
                </Animated.View>
            </View>
        </GestureDetector>
    );
}

/** A chip in the row. Hidden keeps its slot open but draws nothing there. */
function RowChip({
    tag,
    totalMs,
    hidden,
    onPress,
    onLayoutX,
}: {
    tag: TagListeningTime;
    totalMs: number;
    hidden: boolean;
    onPress: (event: GestureResponderEvent) => void;
    onLayoutX?: (x: number) => void;
}) {
    return (
        <Animated.View
            layout={LinearTransition.duration(GAP_MS)}
            style={{ opacity: hidden ? 0 : 1 }}
            pointerEvents={hidden ? "none" : "auto"}
            onLayout={
                onLayoutX
                    ? (event) => onLayoutX(event.nativeEvent.layout.x)
                    : undefined
            }
        >
            <TagChip
                tag={tag}
                totalMs={totalMs}
                selected={false}
                onPress={onPress}
            />
        </Animated.View>
    );
}

/**
 * One tag, drawn as the app's tag pill with its share as the count. Pinned is
 * solid, drifting is outline, the same way chosen and available tags read
 * everywhere else. Both keep the same width, so pinning never shifts the row.
 * With no `onPress` it is only a picture of a tag, for one in flight.
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
