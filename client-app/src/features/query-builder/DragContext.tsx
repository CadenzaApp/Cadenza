import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from "react";
import { View } from "react-native";
import {
    runOnJS,
    useAnimatedReaction,
    useFrameCallback,
    useSharedValue,
    type SharedValue,
} from "react-native-reanimated";
import {
    DragMeasurementSession,
    intersectDropRects,
    movedDropRect,
    pickDropZone,
    type DropRect,
    measureDropRect,
    createDragHoverStore,
} from "./drag-utils";
import type { DropViewportGeometry } from "./DropViewport";
import type { DragPayload, DragState, DropTarget } from "./types";

type RegisteredZone = {
    target: DropTarget;
    priority: number;
    measure: () => Promise<DropRect | null>;
    viewport: DropViewportGeometry | null;
};
type MeasuredViewport = {
    rect: DropRect;
    scrollY: number;
    translationY: number;
};
type Measurements = {
    root: DropRect | null;
    zones: Map<string, DropRect>;
    viewports: Map<DropViewportGeometry, MeasuredViewport>;
};
type DragPresentation = {
    dragState: DragState;
    grabOffset: { x: number; y: number };
    rootOffset: { x: number; y: number };
    dragX: SharedValue<number>;
    dragY: SharedValue<number>;
};
type DragCommands = {
    dragX: SharedValue<number>;
    dragY: SharedValue<number>;
    dragActive: SharedValue<boolean>;
    registerDropZone: (key: string, zone: RegisteredZone) => void;
    unregisterDropZone: (key: string) => void;
    beginDrag: (
        payload: DragPayload,
        x: number,
        y: number,
        grabOffset?: { x: number; y: number },
    ) => Promise<void>;
    moveDrag: (x: number, y: number) => void;
    finishDrag: (
        payload: DragPayload,
        x: number,
        y: number,
        insertionIndex?: number,
    ) => Promise<boolean>;
    cancelDrag: () => void;
    refreshHover: () => void;
};
const DragContext = createContext<DragPresentation | null>(null);
const CommandsContext = createContext<DragCommands | null>(null);
const HoverContext = createContext<ReturnType<
    typeof createDragHoverStore
> | null>(null);

export function DragProvider({
    children,
    onDrop,
    bottomInset = 0,
}: {
    children: ReactNode;
    onDrop: (payload: DragPayload, target: DropTarget) => void;
    bottomInset?: number;
}) {
    const [dragState, setDragState] = useState<DragState>(null);
    const [grabOffset, setGrabOffset] = useState({ x: 0, y: 0 });
    const [rootOffset, setRootOffset] = useState({ x: 0, y: 0 });
    const dragX = useSharedValue(0);
    const dragY = useSharedValue(0);
    const dragActive = useSharedValue(false);
    const containerRef = useRef<View>(null);
    const zones = useRef(new Map<string, RegisteredZone>());
    const dropHandler = useRef(onDrop);
    useLayoutEffect(() => {
        dropHandler.current = onDrop;
    }, [onDrop]);
    const cached = useRef<Measurements | null>(null);
    const active = useRef<{
        payload: DragPayload;
        x: number;
        y: number;
        session: number;
    } | null>(null);
    const measurements = useRef(new DragMeasurementSession<Measurements>());
    const [hover] = useState(createDragHoverStore);
    useEffect(() => {
        const session = measurements.current;
        return () => session.cancel();
    }, []);
    const registerDropZone = useCallback(
        (key: string, zone: RegisteredZone) => {
            zones.current.set(key, zone);
        },
        [],
    );
    const unregisterDropZone = useCallback((key: string) => {
        zones.current.delete(key);
    }, []);
    const findZoneAt = useCallback(
        (payload: DragPayload, x: number, y: number) => {
            const sample = cached.current;
            if (!sample?.root) return undefined;
            // Read live offsets once per viewport, rather than once per target.
            const live = new Map<
                DropViewportGeometry,
                { scroll: number; translation: number; clip: DropRect | null }
            >();
            for (const [viewport, baseline] of sample.viewports) {
                const translation =
                    (viewport.translationY?.get() ?? 0) - baseline.translationY;
                const rect = movedDropRect(baseline.rect, 0, translation);
                const bottom =
                    typeof viewport.bottomInset === "number"
                        ? viewport.bottomInset
                        : viewport.bottomInset.get();
                live.set(viewport, {
                    scroll: (viewport.scrollY?.get() ?? 0) - baseline.scrollY,
                    translation,
                    clip: intersectDropRects(
                        {
                            ...rect,
                            y: rect.y + viewport.topInset,
                            height: Math.max(
                                0,
                                rect.height - viewport.topInset - bottom,
                            ),
                        },
                        sample.root,
                    ),
                });
            }
            const entries = [...sample.zones].flatMap(([key, raw]) => {
                const zone = zones.current.get(key);
                if (!zone) return [];
                const region = zone.viewport ? live.get(zone.viewport) : null;
                const clip = region
                    ? region.clip
                    : zone.viewport
                      ? null
                      : sample.root;
                const rect =
                    clip &&
                    intersectDropRects(
                        movedDropRect(
                            raw,
                            region?.scroll ?? 0,
                            region?.translation ?? 0,
                        ),
                        clip,
                    );
                return rect
                    ? [
                          {
                              key,
                              rect,
                              target: zone.target,
                              priority: zone.priority,
                          },
                      ]
                    : [];
            });
            return pickDropZone(entries, x, y, (target) =>
                acceptsDrop(payload, target),
            );
        },
        [],
    );
    const measureZones = useCallback(async (): Promise<Measurements> => {
        const registered = [...zones.current.entries()];
        const regions = [
            ...new Set(
                registered.flatMap(([, zone]) =>
                    zone.viewport ? [zone.viewport] : [],
                ),
            ),
        ];
        const [root, measuredZones, measuredRegions] = await Promise.all([
            measureDropRect(containerRef.current),
            Promise.all(
                registered.map(
                    async ([key, zone]) => [key, await zone.measure()] as const,
                ),
            ),
            Promise.all(
                regions.map(async (viewport) => {
                    const rect = await viewport.measure();
                    return [
                        viewport,
                        rect
                            ? {
                                  rect,
                                  scrollY: viewport.scrollY?.get() ?? 0,
                                  translationY:
                                      viewport.translationY?.get() ?? 0,
                              }
                            : null,
                    ] as const;
                }),
            ),
        ]);
        return {
            root: root
                ? { ...root, height: Math.max(0, root.height - bottomInset) }
                : null,
            zones: new Map(
                measuredZones.filter(
                    (entry): entry is readonly [string, DropRect] =>
                        entry[1] !== null,
                ),
            ),
            viewports: new Map(
                measuredRegions.filter(
                    (
                        entry,
                    ): entry is readonly [
                        DropViewportGeometry,
                        MeasuredViewport,
                    ] => entry[1] !== null,
                ),
            ),
        };
    }, [bottomInset]);
    const refreshHover = useCallback(() => {
        const current = active.current;
        if (current)
            hover.set(
                findZoneAt(current.payload, current.x, current.y)?.key ?? null,
            );
    }, [findZoneAt, hover]);
    const beginDrag = useCallback(
        async (
            payload: DragPayload,
            x: number,
            y: number,
            offset = { x: 0, y: 0 },
        ) => {
            cached.current = null;
            hover.set(null);
            setGrabOffset(offset);
            setDragState({ payload });
            dragActive.set(true);
            const session = measurements.current.begin(measureZones);
            active.current = { payload, x, y, session };
            const sample = await measurements.current.ready(session);
            if (!sample) return;
            cached.current = sample;
            if (sample.root)
                setRootOffset({ x: sample.root.x, y: sample.root.y });
            refreshHover();
        },
        [dragActive, hover, measureZones, refreshHover],
    );
    const moveDrag = useCallback(
        (x: number, y: number) => {
            if (!active.current) return;
            active.current.x = x;
            active.current.y = y;
            refreshHover();
        },
        [refreshHover],
    );
    const cancelDrag = useCallback(() => {
        measurements.current.cancel();
        active.current = null;
        cached.current = null;
        dragActive.set(false);
        setDragState(null);
        hover.set(null);
    }, [dragActive, hover]);
    const finishDrag = useCallback(
        async (
            payload: DragPayload,
            x: number,
            y: number,
            insertionIndex?: number,
        ) => {
            const current = active.current;
            if (!current || !samePayload(current.payload, payload))
                return false;
            const session = current.session;
            try {
                if (!(await measurements.current.ready(session))) return false;
                const sample = await measureZones();
                if (!measurements.current.isCurrent(session)) return false;
                cached.current = sample;
                const match = findZoneAt(payload, x, y);
                if (payload.source === "condition") {
                    if (match?.target.kind === "delete")
                        dropHandler.current(payload, match.target);
                    else {
                        if (insertionIndex === undefined) return false;
                        dropHandler.current(payload, {
                            kind: "insert",
                            index: insertionIndex,
                        });
                    }
                    return true;
                }
                if (match) dropHandler.current(payload, match.target);
                return Boolean(match);
            } catch (error) {
                console.error("Could not complete query drag:", error);
                return false;
            } finally {
                if (measurements.current.isCurrent(session)) cancelDrag();
            }
        },
        [measureZones, findZoneAt, cancelDrag],
    );
    const commands = useMemo(
        () => ({
            dragX,
            dragY,
            dragActive,
            registerDropZone,
            unregisterDropZone,
            beginDrag,
            moveDrag,
            finishDrag,
            cancelDrag,
            refreshHover,
        }),
        [
            dragX,
            dragY,
            dragActive,
            registerDropZone,
            unregisterDropZone,
            beginDrag,
            moveDrag,
            finishDrag,
            cancelDrag,
            refreshHover,
        ],
    );
    const presentation = useMemo(
        () => ({ dragState, grabOffset, rootOffset, dragX, dragY }),
        [dragState, grabOffset, rootOffset, dragX, dragY],
    );
    return (
        <CommandsContext.Provider value={commands}>
            <HoverContext.Provider value={hover}>
                <DragContext.Provider value={presentation}>
                    <View
                        ref={containerRef}
                        collapsable={false}
                        className="flex-1"
                        onLayout={() => {
                            containerRef.current?.measureInWindow((x, y) =>
                                setRootOffset((current) =>
                                    current.x === x && current.y === y
                                        ? current
                                        : { x, y },
                                ),
                            );
                        }}
                    >
                        {children}
                    </View>
                </DragContext.Provider>
            </HoverContext.Provider>
        </CommandsContext.Provider>
    );
}
export function useDrag() {
    const context = useContext(DragContext);
    if (!context) throw new Error("useDrag must be used within DragProvider");
    return context;
}
export function useDragCommands() {
    const context = useContext(CommandsContext);
    if (!context)
        throw new Error("useDragCommands must be used within DragProvider");
    return context;
}
export function useDropHover(key: string) {
    const store = useContext(HoverContext);
    if (!store)
        throw new Error("useDropHover must be used within DragProvider");
    const subscribe = useCallback(
        (listener: () => void) => store.subscribe(key, listener),
        [store, key],
    );
    const snapshot = useCallback(() => store.isHovered(key), [store, key]);
    return useSyncExternalStore(subscribe, snapshot, snapshot);
}
/** Scrolling can move the target under a stationary finger. */
export function useRefreshDragHover(
    scrollY: SharedValue<number>,
    movement?: SharedValue<number>,
) {
    const { dragActive, refreshHover } = useDragCommands();
    const last = useSharedValue(0);
    const dirty = useSharedValue(false);
    useAnimatedReaction(
        () => [scrollY.get(), movement?.get() ?? 0],
        () => {
            dirty.set(true);
        },
    );
    useFrameCallback(() => {
        if (dragActive.get() && dirty.get() && Date.now() - last.get() >= 80) {
            dirty.set(false);
            last.set(Date.now());
            runOnJS(refreshHover)();
        }
    });
}
function acceptsDrop(payload: DragPayload, target: DropTarget): boolean {
    if (target.kind === "delete") return payload.source !== "palette";
    if (payload.source === "condition") return target.kind !== "condition";
    if (target.kind === "condition" && payload.source === "query")
        return payload.origin.conditionId !== target.conditionId;
    return true;
}

function samePayload(a: DragPayload, b: DragPayload): boolean {
    if (a.source === "condition" && b.source === "condition")
        return a.condition.id === b.condition.id;
    if (a.source === "query" && b.source === "query")
        return a.queryTag.id === b.queryTag.id;
    return (
        a.source === "palette" &&
        b.source === "palette" &&
        a.tag.id === b.tag.id
    );
}
