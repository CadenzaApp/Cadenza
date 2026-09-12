import { type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    runOnJS,
    scrollTo,
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
 * A drag begins on a long press, which leaves short drags to the scroll view.
 * Near either edge the list scrolls itself, otherwise a queue longer than the
 * screen could only be reordered within one screenful.
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

    const rowCount = data.length;
    const contentHeight = rowCount * itemHeight;

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
        targetIndex.set(landingIndex(activeIndex, dragOffset, itemHeight, rowCount));
        scrollTo(scrollRef, 0, next, false);
    }, false);

    function commitReorder(from: number, to: number) {
        if (from !== to) onReorder(from, to);
    }

    return (
        <Animated.ScrollView
            ref={scrollRef}
            style={style}
            contentContainerStyle={contentContainerStyle}
            onScroll={onScroll}
            scrollEventThrottle={16}
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
                            key={keyExtractor(item, index)}
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
    );
}

function ReorderableRow<T>({
    item,
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
    setAutoScrollActive,
    onCommit,
    render,
}: {
    item: T;
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
    setAutoScrollActive: (active: boolean) => void;
    onCommit: (from: number, to: number) => void;
    render: (info: { item: T; index: number }) => ReactNode;
}) {
    const gesture = Gesture.Pan()
        .activateAfterLongPress(220)
        // A drag is vertical. Let a horizontal swipe through to whatever the
        // row put behind it.
        .failOffsetX([-20, 20])
        .onStart(() => {
            activeIndex.set(index);
            targetIndex.set(index);
            fingerOffset.set(0);
            autoScrolled.set(0);
            dragOffset.set(0);
            runOnJS(setAutoScrollActive)(true);
        })
        .onUpdate((event) => {
            fingerOffset.set(event.translationY);
            fingerViewportY.set(
                index * itemHeight + event.translationY - scrollY.get(),
            );
            dragOffset.set(event.translationY + autoScrolled.get());
            targetIndex.set(
                landingIndex(activeIndex, dragOffset, itemHeight, rowCount),
            );
        })
        .onEnd(() => {
            runOnJS(onCommit)(index, targetIndex.get());
        })
        .onFinalize(() => {
            runOnJS(setAutoScrollActive)(false);
            activeIndex.set(-1);
            targetIndex.set(-1);
            dragOffset.set(0);
            fingerOffset.set(0);
            autoScrolled.set(0);
        });

    const rowStyle = useAnimatedStyle(() => {
        const active = activeIndex.get();
        const target = targetIndex.get();

        if (active === index) {
            return {
                transform: [{ translateY: dragOffset.get() }],
                zIndex: 2,
                shadowOpacity: 0.25,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
            };
        }

        // Everything the dragged row passed over steps one slot the other way,
        // which is what makes the gap follow the finger.
        let shift = 0;
        if (active >= 0) {
            if (active < target && index > active && index <= target) {
                shift = -itemHeight;
            } else if (active > target && index < active && index >= target) {
                shift = itemHeight;
            }
        }

        return {
            transform: [{ translateY: withSpring(shift, SETTLE_SPRING) }],
            zIndex: 1,
            shadowOpacity: 0,
        };
    });

    return (
        <GestureDetector gesture={gesture}>
            <Animated.View
                style={[
                    {
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: index * itemHeight,
                        height: itemHeight,
                    },
                    rowStyle,
                ]}
            >
                {render({ item, index })}
            </Animated.View>
        </GestureDetector>
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
