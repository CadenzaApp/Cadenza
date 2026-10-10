import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    FadeIn,
    FadeOut,
    LinearTransition,
    runOnJS,
    useAnimatedReaction,
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
/** A chip fading out of the row or into it, and the selected tag's fade. */
export const CHIP_FADE_MS = 300;
/** The row closing or opening a gap. */
const GAP_MS = 525;

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
    /** The tag shown elsewhere as the filter, left out of the row. */
    selectedId: number | null;
    onSelect: (id: number) => void;
};

/**
 * Tags on their way to the back of the row. `waiting` were let go and wait
 * for the back to be off screen; `order` is every tag sent back so far,
 * oldest first, drawn after the rest.
 */
type Back = { waiting: number[]; order: number[] };

/**
 * The tags listened to in the shown span, in a row that drifts left and loops
 * forever. Tapping a tag selects it: it fades out of the row and the row
 * closes the gap. The selected tag is drawn by the caller, not here.
 *
 * A tag let go never goes back to its old slot, which may be on screen. It
 * joins the back of the row once the back has drifted out of sight, so
 * nothing visible moves.
 *
 * The row stays mounted through every state, empty included, so a new span
 * swaps its chips in place and the drift carries on where it was.
 */
export function TagCarousel({
    tags,
    totalMs,
    loaded,
    selectedId,
    onSelect,
}: Props) {
    const [back, setBack] = useState<Back>({ waiting: [], order: [] });

    // a tag let go waits for the back. set during render, so the row never
    // draws it in its old slot even for a frame
    const [shownId, setShownId] = useState(selectedId);
    if (selectedId !== shownId) {
        setShownId(selectedId);
        if (shownId != null) {
            setBack(({ waiting, order }) => ({
                waiting: [
                    ...waiting.filter(
                        (id) => id !== shownId && id !== selectedId,
                    ),
                    shownId,
                ],
                order,
            }));
        }
    }

    // tags sent back go after the rest, in the order they were sent
    const sentBack = new Set(back.order);
    const ordered = [
        ...tags.filter((tag) => !sentBack.has(tag.id)),
        ...back.order.flatMap((id) => tags.filter((tag) => tag.id === id)),
    ];
    const waiting = new Set(back.waiting);
    const drifting = ordered.filter(
        (tag) => tag.id !== selectedId && !waiting.has(tag.id),
    );

    // the back is off screen, so the waiting tags join it unseen
    const sendBack = () =>
        setBack((state) =>
            state.waiting.length === 0
                ? state
                : {
                      waiting: [],
                      order: [
                          ...state.order.filter(
                              (id) => !state.waiting.includes(id),
                          ),
                          ...state.waiting,
                      ],
                  },
        );

    return (
        <View style={{ height: HEIGHT }}>
            <DriftingRow
                tags={drifting}
                waiting={back.waiting.length > 0}
                totalMs={totalMs}
                onSelect={onSelect}
                onBackHidden={sendBack}
            />
            {loaded && tags.length === 0 ? (
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
 * Tags in one row that drifts left forever. A swipe drags it and a fling
 * carries on, then eases back to the drift. A row that fits sits still.
 *
 * The loop is copies of the row side by side, enough to cover the box, moved
 * by one copy's width at most and wrapped, so the seam never shows. Only the
 * first copy is read by a screen reader. A chip fades as it leaves or joins,
 * and the rest slide to close or open its gap.
 */
function DriftingRow({
    tags,
    waiting,
    totalMs,
    onSelect,
    onBackHidden,
}: {
    tags: TagListeningTime[];
    /** A tag waits to join the back, so watch for the back to leave sight. */
    waiting: boolean;
    totalMs: number;
    onSelect: (id: number) => void;
    /**
     * The end of the row is off screen, so a chip added there moves nothing
     * the user can see. Called each time it goes out of sight while waiting.
     */
    onBackHidden: () => void;
}) {
    const [box, setBox] = useState(0);
    const [run, setRun] = useState(0);
    const loops = box > 0 && run > box;
    const copies = loops ? Math.ceil(box / run) + 1 : 1;

    const offset = useSharedValue(0);
    const velocity = useSharedValue(-DRIFT);
    const dragging = useSharedValue(false);
    const watching = useSharedValue(false);
    const loopWidth = useSharedValue(0);
    const boxWidth = useSharedValue(0);

    useEffect(() => {
        loopWidth.set(loops ? run : 0);
        if (!loops) offset.set(0);
    }, [loopWidth, loops, offset, run]);
    useEffect(() => {
        watching.set(waiting);
        boxWidth.set(box);
    }, [box, boxWidth, waiting, watching]);

    // the end of the first copy is the seam the next copy starts at. a row
    // that fits has no seam on screen at all
    useAnimatedReaction(
        () =>
            watching.get() &&
            (loopWidth.get() <= 0 ||
                offset.get() + loopWidth.get() > boxWidth.get()),
        (hidden, wasHidden) => {
            if (hidden && !wasHidden) runOnJS(onBackHidden)();
        },
        [onBackHidden],
    );

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
                                    entering={FadeIn.duration(CHIP_FADE_MS)}
                                    exiting={FadeOut.duration(CHIP_FADE_MS)}
                                >
                                    <TagShareChip
                                        tag={tag}
                                        totalMs={totalMs}
                                        onPress={() => onSelect(tag.id)}
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
 * One tag, drawn as the app's tag pill with its share of the span as the
 * count. Outline in the row, solid where it is the selected filter, the same
 * way available and chosen tags read everywhere else.
 */
export function TagShareChip({
    tag,
    totalMs,
    selected = false,
    onPress,
}: {
    tag: TagListeningTime;
    totalMs: number;
    selected?: boolean;
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
            style={selected ? undefined : { marginRight: ITEM_GAP }}
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
