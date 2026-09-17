import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { Platform, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from "react-native-reanimated";

import type { DragPayload } from "./types";
import { useDrag } from "./DragContext";

const DRAG_SETTLE_DURATION = 320;
const DRAG_SETTLE_EASING = Easing.bezier(0.22, 0.8, 0.3, 1);
export const SCROLLABLE_TAG_DRAG_HOLD_MS =
    Platform.OS === "android" ? 240 : undefined;
const DRAG_MIN_DISTANCE = 8;
// A finger drifts a few points during an ordinary tap. A pill that also
// answers a tap needs a wider drag threshold than a drag-only pill, and the
// tap uses the same number so no travel distance falls between the two.
const TAP_TOLERANCE = 14;
// Long enough that a slow, deliberate tap still counts. On Android the pan
// takes over at the hold threshold well before this.
const TAP_MAX_DURATION = 600;

class ReleaseLatch {
    private pending = false;

    begin() {
        this.pending = true;
    }

    end() {
        this.pending = false;
    }

    isPending() {
        return this.pending;
    }
}

export function DraggablePill({
    payload,
    children,
    dragHandle,
    activateAfterLongPress,
    onPrepareDrag,
    onTap,
    verticalOnly = false,
    layoutCompensationY = 0,
}: {
    payload: DragPayload;
    children: ReactNode;
    dragHandle?: ReactNode;
    activateAfterLongPress?: number;
    onPrepareDrag?: () => void;
    onTap?: () => void;
    verticalOnly?: boolean;
    layoutCompensationY?: number;
}) {
    const { beginDrag, moveDrag, prepareDragRelease, finishDrag, cancelDrag } =
        useDrag();
    const startX = useSharedValue(0);
    const startY = useSharedValue(0);
    const touchOffsetY = useSharedValue(0);
    const opacity = useSharedValue(1);
    const translateY = useSharedValue(0);
    const isDragging = useSharedValue(0);
    const releaseLatch = useMemo(() => new ReleaseLatch(), []);
    const measuredWidth = useSharedValue(0);
    const measuredHeight = useSharedValue(0);
    const reservationHeight = useSharedValue(0);
    const compensationY = useSharedValue(layoutCompensationY);

    useEffect(() => {
        compensationY.set(
            withTiming(layoutCompensationY, {
                duration: DRAG_SETTLE_DURATION,
                easing: DRAG_SETTLE_EASING,
            }),
        );
    }, [compensationY, layoutCompensationY]);

    const start = useCallback(
        (x: number, y: number) => void beginDrag(payload, x, y),
        [beginDrag, payload],
    );
    const move = useCallback(
        (x: number, y: number) => moveDrag(payload, x, y),
        [moveDrag, payload],
    );
    const finish = useCallback(
        (x: number, y: number) => finishDrag(payload, x, y),
        [finishDrag, payload],
    );

    const pan = useMemo(() => {
        const gesture = Gesture.Pan().maxPointers(1).runOnJS(true);
        if (activateAfterLongPress) {
            // Never pair a minimum distance with the hold. Android activates a
            // pan as soon as its travel reaches that distance, so a zero
            // distance activates on the first touch event and the hold timer
            // never runs. Left alone, the distance stays at the platform touch
            // slop, which is the same number Android uses to fail a pan that
            // moves before the hold completes, so the scroll view still wins a
            // swipe and the timer owns activation.
            gesture.activateAfterLongPress(activateAfterLongPress);
        } else {
            gesture.minDistance(onTap ? TAP_TOLERANCE : DRAG_MIN_DISTANCE);
        }
        return gesture
            .onBegin((event) => {
                onPrepareDrag?.();
                startX.set(event.absoluteX);
                startY.set(event.absoluteY);
                touchOffsetY.set(event.y);
            })
            .onStart(() => {
                if (verticalOnly) {
                    reservationHeight.set(measuredHeight.get());
                    reservationHeight.set(
                        withTiming(0, {
                            duration: DRAG_SETTLE_DURATION,
                            easing: DRAG_SETTLE_EASING,
                        }),
                    );
                }
                isDragging.set(1);
                if (!verticalOnly) opacity.set(0);
                start(
                    startX.get(),
                    verticalOnly
                        ? startY.get() -
                              touchOffsetY.get() +
                              measuredHeight.get() / 2
                        : startY.get(),
                );
            })
            .onUpdate((event) => {
                if (!isDragging.get()) return;
                if (verticalOnly) translateY.set(event.translationY);
                move(
                    verticalOnly
                        ? startX.get()
                        : startX.get() + event.translationX,
                    verticalOnly
                        ? startY.get() -
                              touchOffsetY.get() +
                              measuredHeight.get() / 2 +
                              event.translationY
                        : startY.get() + event.translationY,
                );
            })
            .onEnd((event) => {
                if (!isDragging.get()) return;
                const endX = verticalOnly
                    ? startX.get()
                    : startX.get() + event.translationX;
                const endY = verticalOnly
                    ? startY.get() -
                      touchOffsetY.get() +
                      measuredHeight.get() / 2 +
                      event.translationY
                    : startY.get() + event.translationY;
                if (verticalOnly) {
                    releaseLatch.begin();
                    const releaseTranslationY = event.translationY;
                    translateY.set(releaseTranslationY);
                    const settlesThroughLayout = prepareDragRelease(endX, endY);
                    requestAnimationFrame(() => {
                        finish(endX, endY);
                        isDragging.set(0);
                        if (settlesThroughLayout) {
                            // The keyed card layout consumes the complete
                            // rendered offset. Clearing both pieces here
                            // leaves one Y animation instead of two competing
                            // animations in different coordinate spaces.
                            translateY.set(0);
                            compensationY.set(0);
                        } else {
                            translateY.set(
                                withTiming(0, {
                                    duration: DRAG_SETTLE_DURATION,
                                    easing: DRAG_SETTLE_EASING,
                                }),
                            );
                        }
                        opacity.set(withSpring(1));
                        releaseLatch.end();
                        cancelDrag();
                    });
                    return;
                }
                finish(endX, endY);
            })
            .onFinalize(() => {
                const didDrag = isDragging.get() === 1;
                if (releaseLatch.isPending()) return;
                isDragging.set(0);
                translateY.set(
                    withTiming(0, {
                        duration: DRAG_SETTLE_DURATION,
                        easing: DRAG_SETTLE_EASING,
                    }),
                );
                opacity.set(withSpring(1));
                if (didDrag) cancelDrag();
            });
    }, [
        activateAfterLongPress,
        onTap,
        cancelDrag,
        finish,
        compensationY,
        isDragging,
        move,
        onPrepareDrag,
        measuredHeight,
        opacity,
        prepareDragRelease,
        releaseLatch,
        reservationHeight,
        start,
        startX,
        startY,
        translateY,
        touchOffsetY,
        verticalOnly,
    ]);
    // A tap has to arbitrate with the drag inside the gesture system. A
    // Pressable child would compete through the separate React Native
    // responder system instead, and the pan wins that race often enough that
    // toggling NOT stops working.
    const tap = useMemo(
        () =>
            Gesture.Tap()
                .maxDuration(TAP_MAX_DURATION)
                .maxDistance(TAP_TOLERANCE)
                .runOnJS(true)
                .onEnd((_event, success) => {
                    if (success) onTap?.();
                }),
        [onTap],
    );
    const gesture = useMemo(
        () => (onTap ? Gesture.Race(pan, tap) : pan),
        [onTap, pan, tap],
    );
    const animatedStyle = useAnimatedStyle(() => ({
        width:
            verticalOnly && isDragging.get() && measuredWidth.get() > 0
                ? measuredWidth.get()
                : undefined,
        height: verticalOnly
            ? isDragging.get() && measuredHeight.get() > 0
                ? measuredHeight.get()
                : "auto"
            : undefined,
        opacity: opacity.get(),
        transform: [
            {
                translateY: verticalOnly
                    ? translateY.get() + compensationY.get()
                    : 0,
            },
        ],
        zIndex: isDragging.get() ? 1001 : 0,
        elevation: isDragging.get() ? 24 : 0,
        overflow: "visible",
    }));
    const reservationStyle = useAnimatedStyle(() => {
        return {
            height:
                verticalOnly && isDragging.get()
                    ? reservationHeight.get()
                    : verticalOnly
                      ? "auto"
                      : undefined,
            // The child continues translating after release. Clipping this
            // reservation makes a settling condition look like its height is
            // animating even though the card itself remains full-size.
            overflow: verticalOnly ? "visible" : "hidden",
            zIndex: isDragging.get() ? 1000 : 0,
            elevation: isDragging.get() ? 23 : 0,
        };
    });

    const content = (
        <Animated.View style={reservationStyle}>
            <Animated.View
                style={animatedStyle}
                onLayout={(event) => {
                    const { width, height } = event.nativeEvent.layout;
                    if (width > 0) {
                        measuredWidth.set(width);
                    }
                    if (height > 0) {
                        measuredHeight.set(height);
                    }
                }}
            >
                {children}
                {dragHandle ? (
                    <GestureDetector gesture={gesture}>
                        <Animated.View style={styles.dragHandle}>
                            {dragHandle}
                        </Animated.View>
                    </GestureDetector>
                ) : null}
            </Animated.View>
        </Animated.View>
    );

    return dragHandle ? (
        content
    ) : (
        <GestureDetector gesture={gesture}>{content}</GestureDetector>
    );
}

const styles = StyleSheet.create({
    dragHandle: {
        position: "absolute",
        left: 0,
        top: "50%",
        transform: [{ translateY: -22 }],
        zIndex: 2,
    },
});
