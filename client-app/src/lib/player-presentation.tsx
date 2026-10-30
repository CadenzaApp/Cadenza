import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
    Gesture,
    type LegacyGestureStateManager as GestureStateManager,
    type GestureTouchEvent,
} from "react-native-gesture-handler";
import {
    cancelAnimation,
    Easing,
    interpolate,
    runOnJS,
    runOnUI,
    useAnimatedReaction,
    useDerivedValue,
    useSharedValue,
    withDelay,
    withSpring,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { usePlaybackCommands, usePlaybackTrackState } from "./playback";
import {
    BOTTOM_CONTROL_SPRING as SPRING,
    COMPACT_PLAYER_HEIGHT,
    PLAYER_CONTROL_SIZE as SIZE,
    PLAYER_SIDE_INSET,
    bubbleNearHome,
    clampBubblePosition,
    playerDragProgress,
    playerReleaseTarget,
    playerTouchMoved,
} from "./screen-overlay-geometry";

type Frame = { x: number; y: number; width: number; height: number };
type Pan = { translationX: number; translationY: number; velocityX: number };
type Phase =
    | "appearing"
    | "idle"
    | "drag"
    | "settling"
    | "snapping"
    | "returning"
    | "expanding";
const COLLAPSE_DRAG_THRESHOLD = 8;
const FOLLOW = { damping: 26, stiffness: 360, mass: 1.2 } as const;
const FREE_SCALE = 1.1;
const CAPTURE = (SIZE / 2) * FREE_SCALE * 1.5;
async function unlockHaptic() {
    try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
        // Unlocking still works when the device cannot provide haptics.
    }
}

/** One motion driver for all hosts. Views only register foreground bounds and render. */
function usePresentation() {
    const { activeTrack, isPlayerCollapsed } = usePlaybackTrackState();
    const { setPlayerCollapsed } = usePlaybackCommands();
    const { width: windowWidth } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const [expandedHeight, setExpandedHeight] = useState(COMPACT_PLAYER_HEIGHT);
    const [nativePresented, setNativePresented] = useState(false);
    const [inlinePlacement, setInlinePlacement] = useState(false);
    const [nativePresentation, setNativePresentation] = useState<{
        source: Frame | null;
    }>({ source: null });
    const nativeSource = nativePresentation.source;
    const setNativeSource = useCallback(
        (frame: Frame | null) => setNativePresentation({ source: frame }),
        [],
    );
    const hasTrack = activeTrack != null;
    const [entrance, setEntrance] = useState({
        hasTrack,
        pending: hasTrack && !isPlayerCollapsed,
    });
    if (entrance.hasTrack !== hasTrack) {
        setEntrance({ hasTrack, pending: hasTrack && !isPlayerCollapsed });
    }
    const finishEntrance = useCallback(
        () => setEntrance((current) => ({ ...current, pending: false })),
        [],
    );
    const entranceOpacity = useSharedValue(1);
    const entranceCentered = useSharedValue(false);
    const entranceWaiting = useSharedValue(false);
    const nativeFrame = useSharedValue<Frame | null>(null);
    const source = useSharedValue<Frame | null>(null);
    const nativeTakeover = useSharedValue(false);
    const host = useSharedValue<string | null>(null);
    const hostKind = useSharedValue<"tabs" | "detail">("tabs");
    const gestureOwner = useSharedValue<string | null>(null);
    const anchor = useSharedValue<Frame | null>(null);
    const visible = useSharedValue(true);
    const collapsed = useSharedValue(isPlayerCollapsed);
    const pageWidth = useSharedValue(windowWidth);
    const safeTop = useSharedValue(insets.top + 8);
    const height = useSharedValue(COMPACT_PLAYER_HEIGHT);
    const lift = useSharedValue(0);
    const progress = useSharedValue(isPlayerCollapsed ? 1 : 0);
    const target = useSharedValue(isPlayerCollapsed ? 1 : 0);
    const free = useSharedValue(false);
    const freeScale = useSharedValue(1);
    const position = useSharedValue<[number, number]>([PLAYER_SIDE_INSET, 0]);
    const phase = useSharedValue<Phase>("idle");
    const dragFree = useSharedValue(false);
    const dragStart = useSharedValue(0);
    const dragFromExpanded = useSharedValue(false);
    const travel = useSharedValue(1);
    const startPosition = useSharedValue<[number, number]>([0, 0]);
    const touch = useSharedValue<[number, number]>([0, 0]);
    const suppressPress = useSharedValue(false);
    const captureArmed = useSharedValue(false);
    const pause = useSharedValue(0);
    const inFlight = useDerivedValue(
        () =>
            phase.get() === "appearing" ||
            phase.get() === "returning" ||
            phase.get() === "expanding" ||
            (phase.get() === "drag" && !dragFree.get()),
    );

    // Register geometry's shared inputs directly with Reanimated's mapper.
    // Shared values captured only by a called worklet are not mapper inputs.
    const geometry = useDerivedValue(() => {
        const frame = anchor.get();
        const from = source.get();
        const p = progress.get(),
            width =
                from?.width ??
                frame?.width ??
                pageWidth.get() - PLAYER_SIDE_INSET * 2;
        const h = from?.height ?? height.get();
        return {
            opacity: frame ? entranceOpacity.get() : 0,
            width: interpolate(p, [0, 1], [width, SIZE]),
            height: interpolate(p, [0, 1], [h, SIZE]),
            borderRadius: interpolate(p, [0, 1], [h / 2, SIZE / 2]),
            transform: [
                {
                    translateX:
                        (from ? from.x - (frame?.x ?? PLAYER_SIDE_INSET) : 0) *
                            (1 - p) +
                        (entranceCentered.get()
                            ? (width - SIZE) / 2
                            : free.get()
                              ? position.get()[0] -
                                (frame?.x ?? PLAYER_SIDE_INSET)
                              : 0) *
                            p,
                },
                {
                    translateY:
                        (from
                            ? from.y + from.height - (frame?.y ?? 0) - SIZE
                            : 0) *
                            (1 - p) +
                        (free.get()
                            ? position.get()[1] - (frame?.y ?? 0)
                            : lift.get()) *
                            p,
                },
                { scale: 1 + (freeScale.get() - 1) * p },
            ],
        };
    });

    const motion = useMemo(() => {
        function usable() {
            "worklet";
            return (
                host.get() !== null && anchor.get() !== null && visible.get()
            );
        }
        function busy() {
            "worklet";
            return (
                phase.get() === "appearing" ||
                phase.get() === "returning" ||
                phase.get() === "expanding" ||
                (phase.get() === "settling" && source.get() !== null)
            );
        }
        function home(): [number, number] {
            "worklet";
            const frame = anchor.get();
            return [
                frame?.x ?? PLAYER_SIDE_INSET,
                (frame?.y ?? 0) + lift.get(),
            ];
        }
        function bounded(x: number, y: number): [number, number] {
            "worklet";
            const p = clampBubblePosition(
                x,
                y,
                PLAYER_SIDE_INSET,
                pageWidth.get() - PLAYER_SIDE_INSET - SIZE,
                safeTop.get(),
                anchor.get()?.y ?? 0,
            );
            return [p.x, p.y];
        }
        function near(p: [number, number]) {
            "worklet";
            const h = home();
            return bubbleNearHome(p[0], p[1], h[0], h[1], CAPTURE);
        }
        function releaseNative() {
            "worklet";
            if (nativeTakeover.get()) runOnJS(setNativeSource)(null);
        }
        function settle(next: 0 | 1, velocity = 0) {
            "worklet";
            phase.set(next === 0 ? "expanding" : "settling");
            target.set(next);
            progress.set(
                withSpring(next, { ...SPRING, velocity }, (finished) => {
                    if (!finished) return;
                    if (next === 0) {
                        free.set(false);
                        position.set(home());
                    }
                    phase.set("idle");
                    releaseNative();
                }),
            );
            runOnJS(setPlayerCollapsed)(Boolean(next));
        }
        function startEntrance() {
            "worklet";
            if (!entranceWaiting.get() || !usable()) return;
            entranceWaiting.set(false);
            entranceOpacity.set(
                withTiming(1, { duration: 100 }, (finished) => {
                    if (!finished) return;
                    phase.set("expanding");
                    progress.set(
                        withDelay(
                            150,
                            withSpring(0, SPRING, (complete) => {
                                if (!complete) return;
                                entranceCentered.set(false);
                                phase.set("idle");
                                runOnJS(finishEntrance)();
                            }),
                        ),
                    );
                }),
            );
        }
        function prepareEntrance() {
            "worklet";
            cancelAnimation(progress);
            entranceOpacity.set(0);
            progress.set(1);
            target.set(0);
            free.set(false);
            entranceCentered.set(true);
            entranceWaiting.set(true);
            phase.set("appearing");
            startEntrance();
        }
        function collapse(native = false) {
            "worklet";
            if (!usable() || busy() || collapsed.get()) return;
            dragStart.set(0);
            if (native) {
                const frame = nativeFrame.get();
                if (frame) {
                    source.set(frame);
                    nativeTakeover.set(true);
                    runOnJS(setNativeSource)(frame);
                }
            }
            settle(1);
        }
        function expand() {
            "worklet";
            if (!usable() || busy()) return;
            cancelAnimation(position);
            if (!free.get()) {
                settle(0);
                return;
            }
            phase.set("returning");
            position.set(
                withTiming<[number, number]>(
                    [position.get()[0], home()[1]],
                    { duration: 160, easing: Easing.out(Easing.cubic) },
                    (finished) => {
                        if (!finished) return;
                        pause.set(0);
                        pause.set(
                            withTiming(1, { duration: 80 }, (paused) => {
                                if (paused) settle(0);
                            }),
                        );
                    },
                ),
            );
        }
        function snapHome() {
            "worklet";
            if (!usable() || busy() || phase.get() === "snapping") return;
            phase.set("snapping");
            position.set(
                withSpring(home(), FOLLOW, (finished) => {
                    if (finished) {
                        free.set(false);
                        phase.set("idle");
                    }
                }),
            );
        }
        function reset(preserveEntrance = false) {
            "worklet";
            if (entranceCentered.get() && !preserveEntrance)
                runOnJS(finishEntrance)();
            cancelAnimation(position);
            cancelAnimation(progress);
            cancelAnimation(pause);
            cancelAnimation(entranceOpacity);
            entranceWaiting.set(false);
            entranceCentered.set(false);
            entranceOpacity.set(1);
            phase.set("idle");
            if (!collapsed.get()) free.set(false);
            gestureOwner.set(null);
            captureArmed.set(false);
            source.set(null);
            target.set(collapsed.get() ? 1 : 0);
            progress.set(target.get());
            releaseNative();
        }
        function claim(id: string, kind: "tabs" | "detail" = "tabs") {
            "worklet";
            if (host.get() === id) return;
            const entering = entranceCentered.get();
            reset(entering);
            host.set(id);
            hostKind.set(kind);
            anchor.set(null);
            lift.set(0);
            if (entering) prepareEntrance();
        }
        function release(id: string) {
            "worklet";
            if (host.get() === id) {
                reset();
                host.set(null);
                anchor.set(null);
            }
        }
        function sync() {
            "worklet";
            if (
                !usable() ||
                target.get() === Number(collapsed.get()) ||
                phase.get() === "drag" ||
                busy()
            )
                return;
            if (collapsed.get()) settle(1);
            else expand();
        }
        function reportFrame(id: string, frame: Frame) {
            "worklet";
            if (host.get() !== id || frame.width <= 0 || frame.height <= 0)
                return;
            anchor.set(frame);
            startEntrance();
            if (free.get() && !busy()) position.set(bounded(...position.get()));
            sync();
        }
        function touchDown(event: GestureTouchEvent) {
            "worklet";
            const p = event.allTouches[0];
            suppressPress.set(busy());
            if (p) touch.set([p.absoluteX, p.absoluteY]);
        }
        function touchMove(
            event: GestureTouchEvent,
            manager: GestureStateManager,
        ) {
            "worklet";
            const p = event.allTouches[0];
            if (!p || !usable() || busy() || phase.get() === "drag") return;
            const dx = p.absoluteX - touch.get()[0],
                dy = p.absoluteY - touch.get()[1];
            const moved = playerTouchMoved(false, dx, dy);
            suppressPress.set(suppressPress.get() || moved);
            if (collapsed.get() && free.get() && moved) manager.activate();
            else if (Math.abs(dy) > 16 || (collapsed.get() ? dx < -6 : dx > 6))
                manager.fail();
            else if (collapsed.get() ? dx > 6 : dx < -COLLAPSE_DRAG_THRESHOLD)
                manager.activate();
        }
        function start(native: boolean) {
            "worklet";
            if (!usable() || busy() || phase.get() === "drag") return;
            suppressPress.set(true);
            cancelAnimation(position);
            cancelAnimation(progress);
            dragFromExpanded.set(!collapsed.get());
            dragFree.set(!native && collapsed.get() && free.get());
            if (native) {
                const frame = nativeFrame.get();
                if (!frame) return;
                source.set(frame);
                nativeTakeover.set(true);
                runOnJS(setNativeSource)(frame);
                runOnJS(setPlayerCollapsed)(true);
            }
            phase.set("drag");
            startPosition.set(position.get());
            dragStart.set(progress.get());
            const from = (native ? nativeFrame.get() : null) ?? anchor.get()!;
            travel.set(Math.max(1, from.x + from.width - home()[0] - SIZE));
            captureArmed.set(!near(position.get()));
        }
        function update(event: Pan) {
            "worklet";
            if (!usable() || phase.get() !== "drag") return;
            if (dragFree.get())
                position.set(
                    withSpring(
                        bounded(
                            startPosition.get()[0] + event.translationX,
                            startPosition.get()[1] + event.translationY,
                        ),
                        FOLLOW,
                    ),
                );
            else
                progress.set(
                    playerDragProgress(
                        dragStart.get(),
                        dragFromExpanded.get()
                            ? Math.min(
                                  0,
                                  event.translationX + COLLAPSE_DRAG_THRESHOLD,
                              )
                            : event.translationX,
                        travel.get(),
                    ),
                );
        }
        function end(event: Pan) {
            "worklet";
            if (!usable() || phase.get() !== "drag") return;
            if (!dragFree.get()) {
                const next = playerReleaseTarget(
                    progress.get(),
                    event.velocityX,
                    travel.get(),
                );
                settle(next, -event.velocityX / travel.get());
                return;
            }
            const dropped = bounded(
                startPosition.get()[0] + event.translationX,
                startPosition.get()[1] + event.translationY,
            );
            phase.set("settling");
            if (near(dropped)) snapHome();
        }
        function finalize(_event: unknown, success: boolean) {
            "worklet";
            if (!usable() || success || phase.get() !== "drag") return;
            if (!dragFree.get()) settle(dragFromExpanded.get() ? 0 : 1);
            else {
                captureArmed.set(true);
                phase.set("settling");
                if (near(position.get())) snapHome();
            }
        }
        function unlock() {
            "worklet";
            if (
                !usable() ||
                busy() ||
                phase.get() === "drag" ||
                !collapsed.get()
            )
                return;
            suppressPress.set(true);
            if (free.get()) return;
            position.set(home());
            free.set(true);
            phase.set("idle");
            runOnJS(unlockHaptic)();
        }
        function pan(native = false, id = "native-player") {
            const valid = () => {
                "worklet";
                return native ? hostKind.get() === "tabs" : host.get() === id;
            };
            const gesture = Gesture.Pan()
                .onTouchesDown((event) => {
                    "worklet";
                    if (valid()) touchDown(event);
                })
                .onStart(() => {
                    "worklet";
                    if (
                        !valid() ||
                        !usable() ||
                        busy() ||
                        phase.get() === "drag" ||
                        (native &&
                            (!nativeFrame.get() ||
                                nativeFrame.get()!.width <
                                    pageWidth.get() * 0.75))
                    )
                        return;
                    gestureOwner.set(id);
                    start(native);
                })
                .onUpdate((event) => {
                    "worklet";
                    if (gestureOwner.get() === id) update(event);
                })
                .onEnd((event) => {
                    "worklet";
                    if (gestureOwner.get() === id) end(event);
                })
                .onFinalize((event, success) => {
                    "worklet";
                    if (gestureOwner.get() === id) {
                        finalize(event, success);
                        gestureOwner.set(null);
                    }
                });
            return native
                ? gesture
                      .onTouchesMove((event) => {
                          "worklet";
                          const p = event.allTouches[0];
                          if (valid() && p)
                              suppressPress.set(
                                  playerTouchMoved(
                                      suppressPress.get(),
                                      p.absoluteX - touch.get()[0],
                                      p.absoluteY - touch.get()[1],
                                  ),
                              );
                      })
                      .activeOffsetX(-COLLAPSE_DRAG_THRESHOLD)
                      .failOffsetX(10)
                      .failOffsetY([-16, 16])
                : gesture
                      .manualActivation(true)
                      .onTouchesMove((event, manager) => {
                          "worklet";
                          if (valid()) touchMove(event, manager);
                          else manager.fail();
                      })
                      .onTouchesUp((_event, manager) => {
                          "worklet";
                          if (gestureOwner.get() !== id) manager.fail();
                      });
        }
        function circleGesture(id: string) {
            return Gesture.Simultaneous(
                pan(false, id),
                Gesture.LongPress()
                    .minDuration(220)
                    .maxDistance(6)
                    .onStart(() => {
                        "worklet";
                        if (host.get() === id) unlock();
                    }),
            );
        }
        function setVisible(id: string, value: boolean) {
            "worklet";
            if (host.get() === id) {
                if (!value && phase.get() === "drag") reset();
                visible.set(value);
            }
        }
        function setLift(id: string, value: number) {
            "worklet";
            if (host.get() === id) lift.set(value);
        }
        function canPress() {
            "worklet";
            return (
                usable() &&
                !busy() &&
                phase.get() !== "drag" &&
                !suppressPress.get()
            );
        }
        return {
            geometry,
            anchor,
            progress,
            position,
            free,
            phase,
            suppressPress,
            host,
            visible,
            lift,
            source,
            nativeTakeover,
            height,
            canPress,
            home,
            near,
            sync,
            snapHome,
            claim,
            release,
            reportFrame,
            setVisible,
            setLift,
            pan,
            circleGesture,
            expand,
            collapse,
            prepareEntrance,
            unlock,
        };
    }, [
        entranceOpacity,
        entranceCentered,
        entranceWaiting,
        finishEntrance,
        geometry,
        anchor,
        captureArmed,
        collapsed,
        dragFree,
        dragFromExpanded,
        dragStart,
        free,
        height,
        host,
        hostKind,
        gestureOwner,
        lift,
        nativeFrame,
        nativeTakeover,
        pageWidth,
        pause,
        phase,
        position,
        progress,
        safeTop,
        setPlayerCollapsed,
        setNativeSource,
        source,
        startPosition,
        suppressPress,
        target,
        touch,
        travel,
        visible,
    ]);

    useEffect(() => {
        pageWidth.set(windowWidth);
        safeTop.set(insets.top + 8);
    }, [windowWidth, insets.top, pageWidth, safeTop]);
    useLayoutEffect(() => {
        collapsed.set(isPlayerCollapsed);
    }, [isPlayerCollapsed, collapsed]);
    useLayoutEffect(() => {
        if (entrance.pending) runOnUI(motion.prepareEntrance)();
    }, [entrance.pending, motion]);
    const { sync, near, snapHome } = motion;
    useAnimatedReaction(
        () => ({
            collapsed: collapsed.get(),
            ready: anchor.get() !== null,
            visible: visible.get(),
        }),
        () => sync(),
    );
    useAnimatedReaction(
        () => free.get(),
        (value) => freeScale.set(withSpring(value ? FREE_SCALE : 1, SPRING)),
    );
    useAnimatedReaction(
        () => ({
            host: host.get(),
            visible: visible.get(),
            phase: phase.get(),
            near: near(position.get()),
        }),
        (value) => {
            if (!value.host || !value.visible || !free.get()) return;
            if (value.phase === "drag" || value.phase === "settling") {
                if (!value.near) captureArmed.set(true);
                else if (value.phase === "settling" && captureArmed.get())
                    snapHome();
            }
        },
    );
    // Clear temporary source geometry after the floating artwork transition finishes.
    useLayoutEffect(() => {
        if (!nativeSource)
            runOnUI(() => {
                "worklet";
                nativeTakeover.set(false);
                source.set(null);
            })();
    }, [nativePresentation, nativeSource, nativeTakeover, source]);
    const reportRegularHeight = useCallback(
        (value: number) => {
            if (Number.isFinite(value) && value >= 32 && value <= 120) {
                height.set(value);
                setExpandedHeight(value);
            }
        },
        [height],
    );
    const reportNativeFrame = useCallback(
        (frame: Frame | null) => {
            if (
                frame &&
                (!Object.values(frame).every(Number.isFinite) ||
                    frame.width < 32 ||
                    frame.height < 32 ||
                    frame.height > 120)
            )
                return;
            nativeFrame.set(frame);
            setNativePresented(frame !== null);
            setInlinePlacement(
                frame !== null && frame.width < windowWidth * 0.75,
            );
        },
        [nativeFrame, windowWidth],
    );
    return useMemo(
        () => ({
            motion,
            nativeFrame,
            nativePresented,
            expandedHeight,
            reportRegularHeight,
            reportNativeFrame,
            inFlight,
            entrancePending: entrance.pending,
            nativeTakeover: nativeSource !== null,
            nativeInline: nativeSource
                ? nativeSource.width < windowWidth * 0.75
                : inlinePlacement,
            nativeHeight: nativeSource?.height,
        }),
        [
            motion,
            nativeFrame,
            nativePresented,
            expandedHeight,
            reportRegularHeight,
            reportNativeFrame,
            inFlight,
            entrance.pending,
            nativeSource,
            inlinePlacement,
            windowWidth,
        ],
    );
}
const PlayerContext = createContext<ReturnType<typeof usePresentation> | null>(
    null,
);
export function PlayerPresentationProvider({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <PlayerContext.Provider value={usePresentation()}>
            {children}
        </PlayerContext.Provider>
    );
}
export function usePlayerPresentation() {
    const value = useContext(PlayerContext);
    if (!value)
        throw new Error(
            "Player presentation requires PlayerPresentationProvider",
        );
    return value;
}

/** UI completion, rather than a timeout, gates insertion of a native accessory. */
export function useNativePlayerHandoff(
    wanted: boolean,
    inFlight: SharedValue<boolean>,
) {
    const [previous, setPrevious] = useState(wanted),
        [ready, setReady] = useState(wanted);
    if (previous !== wanted) {
        setPrevious(wanted);
        setReady(false);
    }
    useAnimatedReaction(
        () => inFlight.get(),
        (pending) => {
            if (wanted) runOnJS(setReady)(!pending);
        },
    );
    useEffect(() => {
        if (wanted)
            runOnUI(() => {
                "worklet";
                runOnJS(setReady)(!inFlight.get());
            })();
    }, [wanted, inFlight]);
    return wanted && ready;
}
