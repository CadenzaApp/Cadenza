import * as Haptics from "expo-haptics";
import {
    useCallback,
    useLayoutEffect,
    useMemo,
    useRef,
    type ReactNode,
} from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    ReduceMotion,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useDragCommands } from "./DragContext";
import type { DragPayload } from "./types";

/** Tag motion stays on the UI thread; React handles pickup, hover, and drop. */
export function DraggablePill({
    payload,
    children,
}: {
    payload: DragPayload;
    children: ReactNode;
}) {
    const { beginDrag, moveDrag, finishDrag, cancelDrag, dragX, dragY } =
        useDragCommands();
    const handlers = useRef({
        payload,
        beginDrag,
        moveDrag,
        finishDrag,
        cancelDrag,
    });
    useLayoutEffect(() => {
        handlers.current = {
            payload,
            beginDrag,
            moveDrag,
            finishDrag,
            cancelDrag,
        };
    }, [payload, beginDrag, moveDrag, finishDrag, cancelDrag]);
    const origin = useSharedValue({ x: 0, y: 0 });
    const opacity = useSharedValue(1);
    const started = useSharedValue(false);
    const released = useSharedValue(false);
    const lastHover = useSharedValue(0);
    const start = useCallback(
        (x: number, y: number, offset: { x: number; y: number }) => {
            void handlers.current.beginDrag(
                handlers.current.payload,
                x,
                y,
                offset,
            );
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => {},
            );
        },
        [],
    );
    const move = useCallback(
        (x: number, y: number) => handlers.current.moveDrag(x, y),
        [],
    );
    const finish = useCallback(
        async (x: number, y: number) => {
            try {
                await handlers.current.finishDrag(
                    handlers.current.payload,
                    x,
                    y,
                );
            } finally {
                opacity.set(
                    withTiming(1, {
                        duration: 100,
                        reduceMotion: ReduceMotion.System,
                    }),
                );
            }
        },
        [opacity],
    );
    const cancel = useCallback(() => handlers.current.cancelDrag(), []);
    // These callbacks execute later on the UI runtime, never during render.
    /* eslint-disable react-hooks/refs, react-hooks/purity */
    const pan = useMemo(
        () =>
            Gesture.Pan()
                .minDistance(6)
                .maxPointers(1)
                .onBegin((event) => {
                    origin.set({ x: event.x, y: event.y });
                    started.set(false);
                    released.set(false);
                })
                .onStart((event) => {
                    started.set(true);
                    opacity.set(0);
                    dragX.set(event.absoluteX);
                    dragY.set(event.absoluteY);
                    runOnJS(start)(
                        event.absoluteX,
                        event.absoluteY,
                        origin.get(),
                    );
                })
                .onUpdate((event) => {
                    dragX.set(event.absoluteX);
                    dragY.set(event.absoluteY);
                    const now = Date.now();
                    if (now - lastHover.get() >= 80) {
                        lastHover.set(now);
                        runOnJS(move)(event.absoluteX, event.absoluteY);
                    }
                })
                .onEnd((event) => {
                    released.set(true);
                    dragX.set(event.absoluteX);
                    dragY.set(event.absoluteY);
                    runOnJS(finish)(event.absoluteX, event.absoluteY);
                })
                .onFinalize(() => {
                    if (!released.get())
                        opacity.set(
                            withTiming(1, {
                                duration: 100,
                                reduceMotion: ReduceMotion.System,
                            }),
                        );
                    if (started.get() && !released.get()) runOnJS(cancel)();
                }),
        [
            origin,
            opacity,
            started,
            released,
            dragX,
            dragY,
            lastHover,
            start,
            move,
            finish,
            cancel,
        ],
    );
    /* eslint-enable react-hooks/refs, react-hooks/purity */
    const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
    return (
        <GestureDetector gesture={pan}>
            <Animated.View style={style}>{children}</Animated.View>
        </GestureDetector>
    );
}
