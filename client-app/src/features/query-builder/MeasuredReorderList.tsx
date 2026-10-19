import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    type ReactNode,
} from "react";
import { Gesture, type PanGesture } from "react-native-gesture-handler";
import Animated, {
    measure,
    ReduceMotion,
    runOnJS,
    runOnUI,
    scrollTo,
    useAnimatedReaction,
    useAnimatedRef,
    useAnimatedStyle,
    useFrameCallback,
    useDerivedValue,
    useSharedValue,
    withSpring,
    withTiming,
    type AnimatedRef,
    type SharedValue,
} from "react-native-reanimated";
import {
    edgeScrollDelta,
    reorderLayout,
    reorderIndexAtCenter,
    moveReorderKey,
    reorderLayoutMatches,
    completeReorderDrop,
} from "./reorder-utils";

const SPRING = {
    damping: 20,
    stiffness: 220,
    mass: 0.6,
    reduceMotion: ReduceMotion.System,
};
const HandleContext = createContext<PanGesture | null>(null);
export function useReorderHandle() {
    return useContext(HandleContext);
}

type State = {
    order: SharedValue<string[]>;
    original: SharedValue<string[]>;
    heights: SharedValue<Record<string, number>>;
    layout: SharedValue<ReturnType<typeof reorderLayout>>;
    originalCenters: SharedValue<Record<string, number>>;
    nativeTops: SharedValue<Record<string, number>>;
    active: SharedValue<string>;
    phase: SharedValue<"idle" | "dragging" | "settling">;
    top: SharedValue<number>;
    fingerY: SharedValue<number>;
    startTop: SharedValue<number>;
    startScroll: SharedValue<number>;
    translation: SharedValue<number>;
    committed: SharedValue<boolean>;
    settled: SharedValue<boolean>;
};

/** Variable-height counterpart of the queue's transform-only reorder list. */
export function MeasuredReorderList<T>({
    data,
    keyFor,
    renderItem,
    scrollRef,
    onStart,
    onMove,
    onDrop,
    onCancel,
    scrollOffset,
    viewportTopInset = 0,
    viewportBottomInset,
    bottomClearance = 0,
}: {
    scrollOffset: SharedValue<number>;
    viewportTopInset?: number;
    viewportBottomInset: SharedValue<number>;
    bottomClearance?: number;
    data: readonly T[];
    keyFor: (item: T) => string;
    renderItem: (item: T, index: number) => ReactNode;
    scrollRef: AnimatedRef<Animated.ScrollView>;
    onStart: (item: T, index: number, x: number, y: number) => void;
    onMove: (x: number, y: number) => void;
    onDrop: (
        item: T,
        from: number,
        to: number,
        x: number,
        y: number,
    ) => Promise<boolean>;
    onCancel: () => void;
}) {
    const order = useSharedValue(data.map(keyFor));
    const original = useSharedValue<string[]>([]);
    const acknowledgedOrder = useSharedValue(data.map(keyFor));
    const heights = useSharedValue<Record<string, number>>({});
    const nativeTops = useSharedValue<Record<string, number>>({});
    const originalCenters = useSharedValue<Record<string, number>>({});
    const layout = useDerivedValue(() =>
        reorderLayout(order.get(), heights.get()),
    );
    const viewport = useSharedValue({ pageY: 0, height: 0, contentOrigin: 0 });
    const active = useSharedValue("");
    const phase = useSharedValue<State["phase"]["value"]>("idle");
    const top = useSharedValue(0);
    const fingerY = useSharedValue(0);
    const startTop = useSharedValue(0);
    const startScroll = useSharedValue(0);
    const translation = useSharedValue(0);
    const committed = useSharedValue(true);
    const settled = useSharedValue(true);
    const scrollY = scrollOffset;
    const listRef = useAnimatedRef<Animated.View>();
    const keys = JSON.stringify(data.map(keyFor));
    useEffect(() => {
        // A drop already moved UI slots. React confirms them without resetting
        // the released card's position or restarting its spring.
        const next: string[] = JSON.parse(keys);
        order.set(next);
        acknowledgedOrder.set(next);
        if (active.get() && !next.includes(active.get())) {
            active.set("");
            phase.set("idle");
        }
        runOnUI(() => {
            // Read and write together on the UI runtime. JS read/replace can
            // overwrite measurements queued by sibling onLayout callbacks.
            heights.modify((current) =>
                Object.fromEntries(next.map((key) => [key, current[key] ?? 0])),
            );
            nativeTops.modify((current) =>
                Object.fromEntries(
                    next
                        .filter((key) => current[key] !== undefined)
                        .map((key) => [key, current[key]]),
                ),
            );
        })();
    }, [keys, order, heights, nativeTops, active, phase, acknowledgedOrder]);
    const state = useMemo<State>(
        () => ({
            order,
            original,
            heights,
            layout,
            originalCenters,
            nativeTops,
            active,
            phase,
            top,
            fingerY,
            startTop,
            startScroll,
            translation,
            committed,
            settled,
        }),
        [
            order,
            original,
            heights,
            layout,
            originalCenters,
            nativeTops,
            active,
            phase,
            top,
            fingerY,
            startTop,
            startScroll,
            translation,
            committed,
            settled,
        ],
    );
    useAnimatedReaction(
        () =>
            committed.get() &&
            settled.get() &&
            reorderLayoutMatches(
                order.get(),
                acknowledgedOrder.get(),
                layout.get().tops,
                nativeTops.get(),
            ),
        (ready) => {
            if (ready && phase.get() === "settling") {
                active.set("");
                phase.set("idle");
            }
        },
    );
    // Geometry is captured at pickup. The frame loop only drives edge scrolling.
    const captureViewport = useCallback(() => {
        "worklet";
        const bounds = measure(scrollRef);
        const list = measure(listRef);
        if (bounds && list)
            viewport.set({
                pageY: bounds.pageY,
                height: bounds.height,
                contentOrigin: list.pageY - bounds.pageY + scrollY.get(),
            });
    }, [scrollRef, listRef, scrollY, viewport]);
    useFrameCallback((frame) => {
        if (phase.get() !== "dragging") return;
        const bounds = viewport.get();
        const visible = Math.max(
            0,
            bounds.height - viewportTopInset - viewportBottomInset.get(),
        );
        const delta = edgeScrollDelta(
            fingerY.get() - bounds.pageY - viewportTopInset,
            visible,
            frame.timeSincePreviousFrame ?? 16,
        );
        if (!delta) return;
        const max = Math.max(
            0,
            bounds.contentOrigin +
                layout.get().total +
                bottomClearance -
                bounds.height,
        );
        const next = Math.max(0, Math.min(max, scrollY.get() + delta));
        if (next !== scrollY.get()) {
            scrollTo(scrollRef, 0, next, false);
            scrollY.set(next);
        }
    });
    useAnimatedReaction(
        () => ({
            phase: phase.get(),
            translation: translation.get(),
            scroll: scrollY.get(),
        }),
        (current) => {
            if (current.phase !== "dragging") return;
            const y =
                startTop.get() +
                current.translation +
                current.scroll -
                startScroll.get();
            top.set(y);
            const key = active.get();
            const index = reorderIndexAtCenter(
                original.get(),
                originalCenters.get(),
                key,
                y + (heights.get()[key] ?? 0) / 2,
            );
            if (order.get()[index] !== key)
                order.set(moveReorderKey(original.get(), key, index));
        },
    );
    return (
        <Animated.View ref={listRef} collapsable={false}>
            {data.map((item, index) => (
                <ReorderRow
                    key={keyFor(item)}
                    rowKey={keyFor(item)}
                    state={state}
                    scrollY={scrollY}
                    captureViewport={captureViewport}
                    onStart={(x, y) => onStart(item, index, x, y)}
                    onMove={onMove}
                    onDrop={(to, x, y) => onDrop(item, index, to, x, y)}
                    onCancel={onCancel}
                >
                    {renderItem(item, index)}
                </ReorderRow>
            ))}
        </Animated.View>
    );
}

function ReorderRow({
    rowKey,
    state: s,
    scrollY,
    captureViewport,
    children,
    onStart,
    onMove,
    onDrop,
    onCancel,
}: {
    rowKey: string;
    state: State;
    scrollY: SharedValue<number>;
    captureViewport: () => void;
    children: ReactNode;
    onStart: (x: number, y: number) => void;
    onMove: (x: number, y: number) => void;
    onDrop: (to: number, x: number, y: number) => Promise<boolean>;
    onCancel: () => void;
}) {
    const y = useSharedValue(0);
    const naturalTop = useSharedValue(0);
    const entryOffset = useSharedValue(10);
    useEffect(() => {
        entryOffset.set(
            withTiming(0, {
                duration: 180,
                reduceMotion: ReduceMotion.System,
            }),
        );
    }, [entryOffset]);
    const entryStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: entryOffset.get() }],
    }));
    const recordLayout = useCallback(
        (layoutY: number, height: number) => {
            "worklet";
            naturalTop.set(layoutY);
            if (height <= 0) return;
            s.nativeTops.modify((current) => ({
                ...current,
                [rowKey]: layoutY,
            }));
            s.heights.modify((current) => {
                if (current[rowKey] === height) return current;
                return { ...current, [rowKey]: height };
            });
        },
        [naturalTop, s, rowKey],
    );
    const accepted = useSharedValue(false);
    const released = useSharedValue(false);
    const lastHover = useSharedValue(0);
    useAnimatedReaction(
        () => s.layout.get().tops[rowKey] ?? 0,
        (next, previous) => {
            if (next === previous) return;
            y.set(
                s.active.get() === rowKey || previous === null
                    ? next
                    : withSpring(next, SPRING),
            );
        },
    );
    const handlers = useRef({ onStart, onMove, onDrop, onCancel });
    useLayoutEffect(() => {
        handlers.current = { onStart, onMove, onDrop, onCancel };
    }, [onStart, onMove, onDrop, onCancel]);
    const start = useCallback(
        (x: number, y: number) => handlers.current.onStart(x, y),
        [],
    );
    const move = useCallback(
        (x: number, y: number) => handlers.current.onMove(x, y),
        [],
    );
    const cancel = useCallback(() => handlers.current.onCancel(), []);
    const drop = useCallback(
        (to: number, x: number, pointerY: number) =>
            completeReorderDrop({
                drop: () => handlers.current.onDrop(to, x, pointerY),
                rollback: () => {
                    runOnUI(() => {
                        if (s.active.get() !== rowKey) return;
                        s.order.set(s.original.get());
                        s.settled.set(false);
                        const target = reorderLayout(
                            s.original.get(),
                            s.heights.get(),
                        ).tops[rowKey];
                        y.set(target);
                        s.top.set(
                            withSpring(target, SPRING, (finished) => {
                                if (finished) s.settled.set(true);
                            }),
                        );
                    })();
                },
                onError: (error) => {
                    console.error("Could not reorder query group:", error);
                    handlers.current.onCancel();
                },
                complete: () => {
                    s.committed.set(true);
                },
            }),
        [s, rowKey, y],
    );
    // These callbacks execute later on the UI runtime, never during render.
    /* eslint-disable react-hooks/refs, react-hooks/purity */
    const pan = useMemo(
        () =>
            Gesture.Pan()
                .minDistance(3)
                .maxPointers(1)
                .onBegin(() => {
                    accepted.set(false);
                    released.set(false);
                })
                .onStart((event) => {
                    if (
                        s.phase.get() !== "idle" ||
                        s.order.get().some((key) => !(s.heights.get()[key] > 0))
                    )
                        return;
                    captureViewport();
                    accepted.set(true);
                    s.committed.set(false);
                    s.settled.set(false);
                    s.original.set([...s.order.get()]);
                    s.originalCenters.set(s.layout.get().centers);
                    s.active.set(rowKey);
                    s.phase.set("dragging");
                    s.startTop.set(naturalTop.get());
                    s.top.set(naturalTop.get());
                    s.startScroll.set(scrollY.get());
                    s.translation.set(0);
                    s.fingerY.set(event.absoluteY);
                    runOnJS(start)(event.absoluteX, event.absoluteY);
                })
                .onUpdate((event) => {
                    if (!accepted.get()) return;
                    s.translation.set(event.translationY);
                    s.fingerY.set(event.absoluteY);
                    s.top.set(
                        s.startTop.get() +
                            event.translationY +
                            scrollY.get() -
                            s.startScroll.get(),
                    );
                    // Hover feedback is low-frequency JS work; position and scrolling
                    // remain entirely on the UI thread even when JS is busy.
                    const now = Date.now();
                    if (now - lastHover.get() >= 80) {
                        lastHover.set(now);
                        runOnJS(move)(event.absoluteX, event.absoluteY);
                    }
                })
                .onEnd((event) => {
                    if (!accepted.get()) return;
                    released.set(true);
                    const releaseTop =
                        s.startTop.get() +
                        event.translationY +
                        scrollY.get() -
                        s.startScroll.get();
                    s.top.set(releaseTop);
                    const index = reorderIndexAtCenter(
                        s.original.get(),
                        s.originalCenters.get(),
                        rowKey,
                        releaseTop + s.heights.get()[rowKey] / 2,
                    );
                    const next = moveReorderKey(
                        s.original.get(),
                        rowKey,
                        index,
                    );
                    s.order.set(next);
                    s.phase.set("settling");
                    const target = reorderLayout(next, s.heights.get()).tops[
                        rowKey
                    ];
                    y.set(target);
                    s.top.set(
                        withSpring(target, SPRING, (finished) => {
                            if (finished) s.settled.set(true);
                        }),
                    );
                    runOnJS(drop)(
                        next.indexOf(rowKey),
                        event.absoluteX,
                        event.absoluteY,
                    );
                })
                .onFinalize(() => {
                    if (!accepted.get() || released.get()) return;
                    s.order.set(s.original.get());
                    s.phase.set("settling");
                    const target = reorderLayout(
                        s.original.get(),
                        s.heights.get(),
                    ).tops[rowKey];
                    y.set(target);
                    s.top.set(
                        withSpring(target, SPRING, (finished) => {
                            if (finished) s.settled.set(true);
                        }),
                    );
                    s.committed.set(true);
                    runOnJS(cancel)();
                }),
        [
            s,
            rowKey,
            y,
            naturalTop,
            captureViewport,
            scrollY,
            accepted,
            released,
            lastHover,
            start,
            move,
            drop,
            cancel,
        ],
    );
    /* eslint-enable react-hooks/refs, react-hooks/purity */
    const style = useAnimatedStyle(() => ({
        // In the settled state Yoga owns every gap. During a drag, translate
        // from each row's natural position to its projected position.
        transform: [
            {
                translateY:
                    s.phase.get() === "idle"
                        ? 0
                        : (s.active.get() === rowKey ? s.top.get() : y.get()) -
                          naturalTop.get(),
            },
        ],
        zIndex: s.active.get() === rowKey ? 100 : 0,
        elevation: s.active.get() === rowKey ? 24 : 0,
    }));
    return (
        <Animated.View
            collapsable={false}
            style={style}
            onLayout={(event) => {
                const { y: layoutY, height } = event.nativeEvent.layout;
                runOnUI(recordLayout)(layoutY, height);
            }}
        >
            <Animated.View collapsable={false} style={entryStyle}>
                <HandleContext.Provider value={pan}>
                    {children}
                </HandleContext.Provider>
            </Animated.View>
        </Animated.View>
    );
}
