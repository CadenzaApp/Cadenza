import { useCallback, useMemo, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from "react-native-reanimated";

import * as Haptics from "expo-haptics";

import type { DragPayload } from "./types";
import { useDrag } from "./DragContext";

const DRAG_MIN_DISTANCE = 12;
const HANDLE_TOP_OFFSET = 8;
// The dedicated reorder grip has no tap action to protect, so it should
// engage at the first intentional movement rather than feeling like a hold.
const HANDLE_DRAG_MIN_DISTANCE = 3;

export function DraggablePill({
    payload,
    children,
    dragHandle,
    onPrepareDrag,
    verticalOnly = false,
}: {
    payload: DragPayload;
    children: ReactNode;
    dragHandle?: ReactNode;
    onPrepareDrag?: () => void;
    verticalOnly?: boolean;
}) {
    const { beginDrag, moveDrag, finishDrag, cancelDrag } = useDrag();
    const startX = useSharedValue(0);
    const startY = useSharedValue(0);
    const touchOffsetY = useSharedValue(0);
    const opacity = useSharedValue(1);
    const isDragging = useSharedValue(0);
    const measuredWidth = useSharedValue(0);
    const measuredHeight = useSharedValue(0);

    const start = useCallback(
        (x: number, y: number) => {
            void beginDrag(payload, x, y);
            if (payload.source === "palette") {
                void (async () => {
                    try {
                        await Haptics.impactAsync(
                            Haptics.ImpactFeedbackStyle.Light,
                        );
                    } catch {
                        /* Feedback is optional. */
                    }
                })();
            }
        },
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
            .minDistance(
                dragHandle ? HANDLE_DRAG_MIN_DISTANCE : DRAG_MIN_DISTANCE,
            )
            .maxPointers(1)
            .runOnJS(true);
        return gesture
            .onBegin((event) => {
                onPrepareDrag?.();
                startX.set(event.absoluteX);
                startY.set(event.absoluteY);
                touchOffsetY.set(event.y);
            })
            .onStart(() => {
                isDragging.set(1);
                opacity.set(verticalOnly ? withTiming(0, { duration: 80 }) : 0);
                start(
                    startX.get(),
                    verticalOnly
                        ? startY.get() -
                              touchOffsetY.get() -
                              HANDLE_TOP_OFFSET +
                              measuredHeight.get() / 2
                        : startY.get(),
                );
            })
            .onUpdate((event) => {
                if (!isDragging.get()) return;
                move(
                    verticalOnly
                        ? startX.get()
                        : startX.get() + event.translationX,
                    verticalOnly
                        ? startY.get() -
                              touchOffsetY.get() -
                              HANDLE_TOP_OFFSET +
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
                      touchOffsetY.get() -
                      HANDLE_TOP_OFFSET +
                      measuredHeight.get() / 2 +
                      event.translationY
                    : startY.get() + event.translationY;
                if (verticalOnly) {
                    move(endX, endY);
                    finish(endX, endY);
                    isDragging.set(0);
                    opacity.set(1);
                    cancelDrag();
                    return;
                }
                finish(endX, endY);
            })
            .onFinalize(() => {
                const didDrag = isDragging.get() === 1;
                isDragging.set(0);
                opacity.set(withSpring(1));
                if (didDrag) cancelDrag();
            });
    }, [
        cancelDrag,
        dragHandle,
        finish,
        isDragging,
        move,
        onPrepareDrag,
        measuredHeight,
        opacity,
        start,
        startX,
        startY,
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
        zIndex: isDragging.get() ? 1001 : 0,
        elevation: isDragging.get() ? 24 : 0,
        overflow: "visible",
    }));
    const content = (
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
                <GestureDetector gesture={pan}>
                    <Animated.View style={styles.dragHandle}>
                        {dragHandle}
                    </Animated.View>
                </GestureDetector>
            ) : null}
        </Animated.View>
    );

    return dragHandle ? (
        content
    ) : (
        <GestureDetector gesture={pan}>{content}</GestureDetector>
    );
}

const styles = StyleSheet.create({
    dragHandle: {
        position: "absolute",
        left: 0,
        top: HANDLE_TOP_OFFSET,
        zIndex: 2,
    },
});
