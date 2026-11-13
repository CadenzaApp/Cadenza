import { useEffect, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import {
    useExclusiveGestures,
    usePanGesture,
    InterceptingGestureDetector,
    VirtualGestureDetector,
} from "react-native-gesture-handler";
import Animated, {
    runOnJS,
    scrollTo,
    useAnimatedProps,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useFrameCallback,
    useSharedValue,
    withSpring,
    type SharedValue,
} from "react-native-reanimated";

/** How close to an edge a drag has to get before the list scrolls itself. */
const AUTOSCROLL_EDGE = 72;
/** Points per frame at the very edge, tapering to zero at `AUTOSCROLL_EDGE`. */
const AUTOSCROLL_MAX_SPEED = 12;

const SETTLE_SPRING = { damping: 20, stiffness: 220, mass: 0.6 };

type ReorderableListProps<T> = {
    data: readonly T[];
    keyExtractor: (item: T, index: number) => string;
    renderItem: (info: { item: T; index: number }) => ReactNode;
    /** Every row is this tall. The list positions rows rather than measuring. */
    itemHeight: number;
    /** Fires once on drop, with positions in the list's own index space. */
    onReorder: (fromIndex: number, toIndex: number) => void;
    header?: ReactNode;
    footer?: ReactNode;
    empty?: ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    /**
     * How wide a strip at each row's right edge drags on the first movement,
     * however long it was held, like a row's grab handle. The rest of the row
     * drags after a long press. 0, the default, is long press only.
     */
    handleWidth?: number;
};

/**
 * A vertical list whose rows can be dragged into a new order.
 *
 * Rows are absolutely positioned off a fixed `itemHeight` rather than measured,
 * so a drag never triggers layout: the only thing that moves is a transform.
 * That is also why the neighbours can shift live without the list reflowing
 * underneath the finger.
 *
 * Nothing here knows what a row is. It takes `data`, hands back two indices on
 * drop, and leaves the reordering to the caller, so the same list works for a
 * playback queue or anything else.
 *
 * A drag begins on a long press, which leaves short drags to the scroll view,
 * or straight away inside the `handleWidth` strip, which stops the list
 * scrolling from the moment it is touched. Both are one exclusive gesture on
 * the row's one detector, the strip's first, so they never race.
 * Near either edge the list scrolls itself, otherwise a queue longer than the
 * screen could only be reordered within one screenful.
 *
 * On drop the new order is applied on the UI thread first, through `slots`,
 * and the dropped row springs into its slot from where it was let go. The
 * caller's reorder lands a moment later and agrees with what is already on
 * screen, so nothing snaps back to the old order in between.
 */
export function ReorderableList<T>({
    data,
    keyExtractor,
    renderItem,
    itemHeight,
    onReorder,
    header,
    footer,
    empty,
    style,
    contentContainerStyle,
    handleWidth = 0,
}: ReorderableListProps<T>) {
    const scrollRef = useAnimatedRef<Animated.ScrollView>();
    const scrollY = useSharedValue(0);
    const viewportHeight = useSharedValue(0);
    /** Index of the row being dragged, or -1. */
    const activeIndex = useSharedValue(-1);
    /** Index the dragged row would land on if dropped now. */
    const targetIndex = useSharedValue(-1);
    /** Offset of the dragged row from where it started. */
    const dragOffset = useSharedValue(0);
    /** Distance the finger has travelled, before autoscroll is added in. */
    const fingerOffset = useSharedValue(0);
    /** Content the list has scrolled under the finger during this drag. */
    const autoScrolled = useSharedValue(0);
    /** Where the finger is inside the viewport, for the edge test. */
    const fingerViewportY = useSharedValue(0);
    /** Each row's slot by key, ahead of `data` between a drop and its reorder. */
    const slots = useSharedValue<Record<string, number>>({});
    /** True from a drag's start until its drop has settled. */
    const moving = useSharedValue(false);
    /** The row settling into its slot after a drop, and how far it has to go. */
    const droppedKey = useSharedValue("");
    const dropOffset = useSharedValue(0);
    /**
     * Which gesture runs the drag, as `rowKey:kind`, or "". Each row has two
     * (the long press and the handle), and whichever loses still finalizes, so
     * only the owner may touch the shared drag state.
     */
    const dragOwner = useSharedValue("");
    /**
     * True while a finger is on a drag handle. The list stops scrolling from
     * touch down, on the UI thread, so its pan cannot take the touch partway
     * into a handle drag and cancel it. Scrolling in code (autoscroll) still
     * works.
     */
    const handleHeld = useSharedValue(false);
    const scrollProps = useAnimatedProps(() => ({
        scrollEnabled: !handleHeld.get(),
    }));

    const rowCount = data.length;
    const contentHeight = rowCount * itemHeight;
    const keys = data.map(keyExtractor);
    const keyList = keys.join("\n");

    // follow the caller's order. after a drop this only confirms the slots the
    // UI thread already moved to
    useEffect(() => {
        slots.set(
            Object.fromEntries(keyList.split("\n").map((key, i) => [key, i])),
        );
    }, [keyList, slots]);

    const onScroll = useAnimatedScrollHandler((event) => {
        scrollY.set(event.contentOffset.y);
    });

    // Only runs while a drag is active. Scrolling the list under a held finger
    // is the same as moving the finger, so the two offsets add.
    const autoScroll = useFrameCallback(() => {
        if (activeIndex.get() < 0) return;

        const viewport = viewportHeight.get();
        const fingerY = fingerViewportY.get();
        const maxScroll = Math.max(0, contentHeight - viewport);
        let speed = 0;

        if (fingerY < AUTOSCROLL_EDGE) {
            speed = -AUTOSCROLL_MAX_SPEED * (1 - fingerY / AUTOSCROLL_EDGE);
        } else if (fingerY > viewport - AUTOSCROLL_EDGE) {
            speed =
                AUTOSCROLL_MAX_SPEED *
                (1 - (viewport - fingerY) / AUTOSCROLL_EDGE);
        }
        if (speed === 0) return;

        const current = scrollY.get();
        const next = Math.max(0, Math.min(current + speed, maxScroll));
        const applied = next - current;
        if (applied === 0) return;

        scrollY.set(next);
        autoScrolled.set(autoScrolled.get() + applied);
        dragOffset.set(fingerOffset.get() + autoScrolled.get());
        targetIndex.set(
            landingIndex(activeIndex, dragOffset, itemHeight, rowCount),
        );
        scrollTo(scrollRef, 0, next, false);
    }, false);

    function commitReorder(from: number, to: number) {
        if (from !== to) onReorder(from, to);
    }

    return (
        <InterceptingGestureDetector>
            <Animated.ScrollView
                ref={scrollRef}
                animatedProps={scrollProps}
                style={style}
                contentContainerStyle={contentContainerStyle}
                onScroll={onScroll}
                scrollEventThrottle={16}
                // Android sheets: scroll like the Tags page's list does. The
                // sheet still only lets drags through inside the area its
                // host marks (the player pager's SheetScrollRegion).
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                onLayout={(event) =>
                    viewportHeight.set(event.nativeEvent.layout.height)
                }
            >
                {header}
                {rowCount === 0 ? (
                    empty
                ) : (
                    <View style={{ height: contentHeight }}>
                        {data.map((item, index) => (
                            <ReorderableRow
                                key={keys[index]}
                                rowKey={keys[index]}
                                index={index}
                                rowCount={rowCount}
                                itemHeight={itemHeight}
                                activeIndex={activeIndex}
                                targetIndex={targetIndex}
                                dragOffset={dragOffset}
                                fingerOffset={fingerOffset}
                                autoScrolled={autoScrolled}
                                fingerViewportY={fingerViewportY}
                                scrollY={scrollY}
                                slots={slots}
                                moving={moving}
                                droppedKey={droppedKey}
                                dropOffset={dropOffset}
                                dragOwner={dragOwner}
                                handleHeld={handleHeld}
                                handleWidth={handleWidth}
                                setAutoScrollActive={autoScroll.setActive}
                                onCommit={commitReorder}
                                render={renderItem}
                                item={item}
                            />
                        ))}
                    </View>
                )}
                {footer}
            </Animated.ScrollView>
        </InterceptingGestureDetector>
    );
}

function ReorderableRow<T>({
    item,
    rowKey,
    index,
    rowCount,
    itemHeight,
    activeIndex,
    targetIndex,
    dragOffset,
    fingerOffset,
    autoScrolled,
    fingerViewportY,
    scrollY,
    slots,
    moving,
    droppedKey,
    dropOffset,
    dragOwner,
    handleHeld,
    handleWidth,
    setAutoScrollActive,
    onCommit,
    render,
}: {
    item: T;
    rowKey: string;
    index: number;
    rowCount: number;
    itemHeight: number;
    activeIndex: SharedValue<number>;
    targetIndex: SharedValue<number>;
    dragOffset: SharedValue<number>;
    fingerOffset: SharedValue<number>;
    autoScrolled: SharedValue<number>;
    fingerViewportY: SharedValue<number>;
    scrollY: SharedValue<number>;
    slots: SharedValue<Record<string, number>>;
    moving: SharedValue<boolean>;
    droppedKey: SharedValue<string>;
    dropOffset: SharedValue<number>;
    dragOwner: SharedValue<string>;
    handleHeld: SharedValue<boolean>;
    handleWidth: number;
    setAutoScrollActive: (active: boolean) => void;
    onCommit: (from: number, to: number) => void;
    render: (info: { item: T; index: number }) => ReactNode;
}) {
    const pressOwner = `${rowKey}:press`;
    const handleOwner = `${rowKey}:handle`;

    // The same drag either way; `owner` says which gesture is running it.
    const activate = (owner: string) => {
        "worklet";
        // the slot, not the render index: a drop's reorder may not have
        // re-rendered this row yet
        const slot = slots.get()[rowKey] ?? index;
        dragOwner.set(owner);
        moving.set(true);
        droppedKey.set("");
        activeIndex.set(slot);
        targetIndex.set(slot);
        fingerOffset.set(0);
        autoScrolled.set(0);
        dragOffset.set(0);
        runOnJS(setAutoScrollActive)(true);
    };
    const update = (owner: string, translationY: number) => {
        "worklet";
        if (dragOwner.get() !== owner) return;
        fingerOffset.set(translationY);
        fingerViewportY.set(
            activeIndex.get() * itemHeight + translationY - scrollY.get(),
        );
        dragOffset.set(translationY + autoScrolled.get());
        targetIndex.set(
            landingIndex(activeIndex, dragOffset, itemHeight, rowCount),
        );
    };
    const drop = (owner: string, canceled: boolean) => {
        "worklet";
        if (canceled || dragOwner.get() !== owner) return;

        const from = activeIndex.get();
        const to = targetIndex.get();
        // move to the new order here, before the caller's reorder renders
        slots.set(moveSlot(slots.get(), from, to));
        // and settle from where the finger let go into the new slot
        droppedKey.set(rowKey);
        dropOffset.set((from - to) * itemHeight + dragOffset.get());
        dropOffset.set(
            withSpring(0, SETTLE_SPRING, (finished) => {
                if (!finished || droppedKey.get() !== rowKey) return;
                droppedKey.set("");
                moving.set(false);
            }),
        );
        // the slot the drag held now belongs to a neighbour, so the drag
        // ends here rather than in finalize
        activeIndex.set(-1);
        targetIndex.set(-1);
        runOnJS(onCommit)(from, to);
    };
    const finalize = (owner: string, canceled: boolean) => {
        "worklet";
        // the gesture that lost to the other one has nothing to clean up, and
        // must not end the drag the winner is running
        if (dragOwner.get() !== owner) return;
        dragOwner.set("");
        runOnJS(setAutoScrollActive)(false);
        // a drag that never dropped has nothing to settle
        if (canceled && droppedKey.get() === "") moving.set(false);
        activeIndex.set(-1);
        targetIndex.set(-1);
        dragOffset.set(0);
        fingerOffset.set(0);
        autoScrolled.set(0);
    };

    // A long press anywhere on the row outside the handle strip.
    const pressGesture = usePanGesture({
        activateAfterLongPress: 220,
        failOffsetX: [-20, 20],
        onActivate: () => {
            "worklet";
            activate(pressOwner);
        },
        onUpdate: (event) => {
            "worklet";
            update(pressOwner, event.translationY);
        },
        onDeactivate: (event) => {
            "worklet";
            drop(pressOwner, event.canceled);
        },
        onFinalize: (event) => {
            "worklet";
            finalize(pressOwner, event.canceled);
        },
    });

    // The handle strip drags on the first point of movement, however long it
    // was held, before a sheet's own drag (which waits for its touch slop) can
    // claim the touch. Its hit area is only the strip, so a touch anywhere
    // else never begins it and goes straight to the long press.
    const handleGesture = usePanGesture({
        enabled: handleWidth > 0,
        hitSlop: { right: 0, width: handleWidth },
        minDistance: 1,
        onBegin: () => {
            "worklet";
            handleHeld.set(true);
        },
        onActivate: () => {
            "worklet";
            activate(handleOwner);
        },
        onUpdate: (event) => {
            "worklet";
            update(handleOwner, event.translationY);
        },
        onDeactivate: (event) => {
            "worklet";
            drop(handleOwner, event.canceled);
        },
        onFinalize: (event) => {
            "worklet";
            finalize(handleOwner, event.canceled);
            handleHeld.set(false);
        },
    });

    // the strip first: while it holds a touch, the long press waits on it
    const gesture = useExclusiveGestures(handleGesture, pressGesture);

    const rowStyle = useAnimatedStyle(() => {
        const active = activeIndex.get();
        const target = targetIndex.get();
        // while a drag runs or settles the UI thread's slots lead; otherwise
        // the render index is the truth
        const inMotion = moving.get();
        const slot = inMotion ? (slots.get()[rowKey] ?? index) : index;
        const base = slot * itemHeight;

        if (active >= 0 && active === slot) {
            return {
                transform: [{ translateY: base + dragOffset.get() }],
                zIndex: 2,
                shadowOpacity: 0.25,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
            };
        }

        if (droppedKey.get() === rowKey) {
            return {
                transform: [{ translateY: base + dropOffset.get() }],
                zIndex: 2,
                shadowOpacity: 0,
            };
        }

        // Everything the dragged row passed over steps one slot the other way,
        // which is what makes the gap follow the finger. The spring aims at
        // the absolute spot, so a drop that renumbers the slots keeps the
        // same target and the row carries straight on.
        let shift = 0;
        if (active >= 0) {
            if (active < target && slot > active && slot <= target) {
                shift = -itemHeight;
            } else if (active > target && slot < active && slot >= target) {
                shift = itemHeight;
            }
        }

        return {
            transform: [
                {
                    translateY: inMotion
                        ? withSpring(base + shift, SETTLE_SPRING)
                        : base,
                },
            ],
            zIndex: 1,
            shadowOpacity: 0,
        };
    });

    return (
        <VirtualGestureDetector gesture={gesture}>
            <Animated.View
                style={[
                    {
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: 0,
                        height: itemHeight,
                    },
                    rowStyle,
                ]}
            >
                {render({ item, index })}
            </Animated.View>
        </VirtualGestureDetector>
    );
}

/** Which slot the dragged row currently covers. */
function landingIndex(
    activeIndex: SharedValue<number>,
    dragOffset: SharedValue<number>,
    itemHeight: number,
    rowCount: number,
) {
    "worklet";
    const active = activeIndex.get();
    if (active < 0) return -1;

    const slots = Math.round(dragOffset.get() / itemHeight);
    return Math.max(0, Math.min(active + slots, rowCount - 1));
}

/** Slots with the row at `from` moved to `to`, and the rows between shifted. */
function moveSlot(
    slots: Record<string, number>,
    from: number,
    to: number,
): Record<string, number> {
    "worklet";
    if (from === to) return slots;
    const next: Record<string, number> = {};
    for (const key of Object.keys(slots)) {
        const slot = slots[key];
        if (slot === from) next[key] = to;
        else if (from < to && slot > from && slot <= to) next[key] = slot - 1;
        else if (from > to && slot >= to && slot < from) next[key] = slot + 1;
        else next[key] = slot;
    }
    return next;
}
