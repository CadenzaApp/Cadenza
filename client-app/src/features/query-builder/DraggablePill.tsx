import { useCallback, useEffect, useMemo, type MutableRefObject } from "react";
import {
    Gesture,
    GestureDetector,
    type GestureType,
} from "react-native-gesture-handler";
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

export class DragBlocker {
    private blocked = false;

    block() {
        this.blocked = true;
    }

    unblock() {
        this.blocked = false;
    }

    isBlocked() {
        return this.blocked;
    }
}

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
    activateAfterLongPress,
    gestureRef,
    blocksExternalGesture,
    dragBlocker,
    onPrepareDrag,
    onTouchBegin,
    onTouchFinalize,
    verticalOnly = false,
    layoutCompensationY = 0,
}: {
    payload: DragPayload;
    children: React.ReactNode;
    activateAfterLongPress?: number;
    gestureRef?: MutableRefObject<GestureType | undefined>;
    blocksExternalGesture?: MutableRefObject<GestureType | undefined>;
    dragBlocker?: DragBlocker;
    onPrepareDrag?: () => void;
    onTouchBegin?: () => void;
    onTouchFinalize?: () => void;
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
        const gesture = Gesture.Pan()
            .minDistance(activateAfterLongPress ? 0 : 8)
            .maxPointers(1)
            .runOnJS(true);
        if (activateAfterLongPress) {
            gesture.activateAfterLongPress(activateAfterLongPress);
        }
        if (gestureRef) gesture.withRef(gestureRef);
        if (blocksExternalGesture) {
            gesture.blocksExternalGesture(blocksExternalGesture);
        }
        return gesture
            .onBegin((event) => {
                onTouchBegin?.();
                onPrepareDrag?.();
                startX.set(event.absoluteX);
                startY.set(event.absoluteY);
                touchOffsetY.set(event.y);
            })
            .onStart(() => {
                if (dragBlocker?.isBlocked()) return;
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
                onTouchFinalize?.();
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
        cancelDrag,
        finish,
        blocksExternalGesture,
        compensationY,
        dragBlocker,
        gestureRef,
        isDragging,
        move,
        onPrepareDrag,
        onTouchBegin,
        onTouchFinalize,
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

    return (
        <GestureDetector gesture={pan}>
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
                </Animated.View>
            </Animated.View>
        </GestureDetector>
    );
}
