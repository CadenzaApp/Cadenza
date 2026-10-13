import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { View } from "react-native";
import { useSharedValue, type SharedValue } from "react-native-reanimated";

import type { DragPayload, DragState, DropTarget } from "./types";

const CONDITION_REORDER_SETTLE_MS = 340;

type Rect = { x: number; y: number; width: number; height: number };
type RegisteredZone = {
    target: DropTarget;
    priority: number;
    measure: () => Promise<Rect | null>;
};

type ConditionReorderResolver = (
    payload: Extract<DragPayload, { source: "condition" }>,
    y: number,
) => number | null;

type DragContextValue = {
    dragState: DragState;
    dragX: SharedValue<number>;
    dragY: SharedValue<number>;
    conditionLayoutAnimationsSuppressed: boolean;
    hoveredTargetKey: string | null;
    rootOffset: { x: number; y: number };
    registerDropZone: (key: string, zone: RegisteredZone) => void;
    unregisterDropZone: (key: string) => void;
    beginDrag: (payload: DragPayload, x: number, y: number) => Promise<void>;
    moveDrag: (payload: DragPayload, x: number, y: number) => void;
    finishDrag: (payload: DragPayload, x: number, y: number) => void;
    setConditionReorderIndex: (index: number | null) => void;
    setConditionReorderResolver: (
        resolver: ConditionReorderResolver | null,
    ) => void;
    cancelDrag: () => void;
};

// The release portal must explicitly bridge this context; PortalHost reparents its children.
export const DragContext = createContext<DragContextValue | null>(null);

export function DragProvider({
    children,
    onDrop,
}: {
    children: ReactNode;
    onDrop: (payload: DragPayload, target: DropTarget) => void;
}) {
    const [dragState, setDragState] = useState<DragState>(null);
    const dragX = useSharedValue(0);
    const dragY = useSharedValue(0);
    const [
        conditionLayoutAnimationsSuppressed,
        setConditionLayoutAnimationsSuppressed,
    ] = useState(false);
    const [hoveredTargetKey, setHoveredTargetKey] = useState<string | null>(
        null,
    );
    const hoveredTargetKeyRef = useRef<string | null>(null);
    const [rootOffset, setRootOffset] = useState({ x: 0, y: 0 });
    const containerRef = useRef<View>(null);
    const zones = useRef(new Map<string, RegisteredZone>());
    const cachedRects = useRef(new Map<string, Rect>());
    const dragSession = useRef(0);
    const activePayload = useRef<DragPayload | null>(null);
    const conditionReorderIndex = useRef<number | null>(null);
    const conditionReorderResolver = useRef<ConditionReorderResolver | null>(
        null,
    );
    const conditionAnimationTimer = useRef<ReturnType<
        typeof setTimeout
    > | null>(null);

    useEffect(
        () => () => {
            if (conditionAnimationTimer.current)
                clearTimeout(conditionAnimationTimer.current);
        },
        [],
    );

    const registerDropZone = useCallback(
        (key: string, zone: RegisteredZone) => zones.current.set(key, zone),
        [],
    );
    const unregisterDropZone = useCallback((key: string) => {
        zones.current.delete(key);
    }, []);
    const updateHoveredTargetKey = useCallback((key: string | null) => {
        if (hoveredTargetKeyRef.current === key) return;
        hoveredTargetKeyRef.current = key;
        setHoveredTargetKey(key);
    }, []);

    const findZoneAt = useCallback(
        (payload: DragPayload, x: number, y: number) => {
            let best:
                | {
                      key: string;
                      target: DropTarget;
                      priority: number;
                      area: number;
                  }
                | undefined;
            for (const [key, rect] of cachedRects.current) {
                const zone = zones.current.get(key);
                if (!zone) continue;
                if (
                    x < rect.x ||
                    x > rect.x + rect.width ||
                    y < rect.y ||
                    y > rect.y + rect.height
                ) {
                    continue;
                }
                const candidate = {
                    key,
                    target: zone.target,
                    priority: zone.priority,
                    area: rect.width * rect.height,
                };
                if (
                    !best ||
                    candidate.priority > best.priority ||
                    (candidate.priority === best.priority &&
                        candidate.area < best.area)
                ) {
                    best = candidate;
                }
            }
            return best && acceptsDrop(payload, best.target) ? best : undefined;
        },
        [],
    );

    const beginDrag = useCallback(
        async (payload: DragPayload, x: number, y: number) => {
            dragSession.current += 1;
            activePayload.current = payload;
            if (payload.source === "condition") {
                if (conditionAnimationTimer.current) {
                    clearTimeout(conditionAnimationTimer.current);
                    conditionAnimationTimer.current = null;
                }
                setConditionLayoutAnimationsSuppressed(true);
            }
            conditionReorderIndex.current = null;
            const session = dragSession.current;
            dragX.set(x);
            dragY.set(y);
            setDragState({ payload, x, y });
            const measured = await Promise.all(
                [...zones.current.entries()].map(async ([key, zone]) => {
                    try {
                        return [key, await zone.measure()] as const;
                    } catch {
                        return [key, null] as const;
                    }
                }),
            );
            const nextRects = new Map(
                measured.filter((entry): entry is readonly [string, Rect] =>
                    Boolean(entry[1]),
                ),
            );
            if (session !== dragSession.current) return;
            cachedRects.current = nextRects;
            updateHoveredTargetKey(
                findZoneAt(payload, dragX.get(), dragY.get())?.key ?? null,
            );
        },
        [dragX, dragY, findZoneAt, updateHoveredTargetKey],
    );

    const moveDrag = useCallback(
        (payload: DragPayload, x: number, y: number) => {
            dragX.set(x);
            dragY.set(y);
            if (payload.source === "condition") {
                const nextIndex = conditionReorderResolver.current?.(
                    payload,
                    y,
                );
                if (nextIndex !== conditionReorderIndex.current) {
                    conditionReorderIndex.current = nextIndex ?? null;
                    setDragState({ payload, x, y });
                }
            }
            const nextHoveredKey = findZoneAt(payload, x, y)?.key ?? null;
            updateHoveredTargetKey(nextHoveredKey);
        },
        [dragX, dragY, findZoneAt, updateHoveredTargetKey],
    );
    const finishDrag = useCallback(
        (payload: DragPayload, x: number, y: number) => {
            const match = findZoneAt(payload, x, y);
            if (payload.source === "condition") {
                if (match?.target.kind === "delete") {
                    onDrop(payload, match.target);
                } else if (conditionReorderIndex.current != null) {
                    const insertionIndex = conditionReorderIndex.current;
                    const finalIndex =
                        insertionIndex > payload.originIndex
                            ? insertionIndex - 1
                            : insertionIndex;
                    if (finalIndex === payload.originIndex) return;
                    onDrop(payload, {
                        kind: "insert",
                        index: insertionIndex,
                    });
                }
                return;
            }
            if (match) onDrop(payload, match.target);
        },
        [findZoneAt, onDrop],
    );
    const setConditionReorderIndex = useCallback((index: number | null) => {
        conditionReorderIndex.current = index;
    }, []);
    const setConditionReorderResolver = useCallback(
        (resolver: ConditionReorderResolver | null) => {
            conditionReorderResolver.current = resolver;
        },
        [],
    );
    const cancelDrag = useCallback(() => {
        dragSession.current += 1;
        const cancelledSession = dragSession.current;
        const wasConditionDrag = activePayload.current?.source === "condition";
        activePayload.current = null;
        setDragState(null);
        updateHoveredTargetKey(null);
        cachedRects.current.clear();
        conditionReorderIndex.current = null;
        if (wasConditionDrag) {
            if (conditionAnimationTimer.current) {
                clearTimeout(conditionAnimationTimer.current);
            }
            conditionAnimationTimer.current = setTimeout(() => {
                if (dragSession.current === cancelledSession) {
                    setConditionLayoutAnimationsSuppressed(false);
                }
                conditionAnimationTimer.current = null;
            }, CONDITION_REORDER_SETTLE_MS);
        } else {
            setConditionLayoutAnimationsSuppressed(false);
        }
    }, [updateHoveredTargetKey]);

    return (
        <DragContext.Provider
            value={{
                dragState,
                dragX,
                dragY,
                conditionLayoutAnimationsSuppressed,
                hoveredTargetKey,
                rootOffset,
                registerDropZone,
                unregisterDropZone,
                beginDrag,
                moveDrag,
                finishDrag,
                setConditionReorderIndex,
                setConditionReorderResolver,
                cancelDrag,
            }}
        >
            <View
                ref={containerRef}
                className="flex-1"
                onLayout={() =>
                    containerRef.current?.measureInWindow((x, y) =>
                        setRootOffset({ x, y }),
                    )
                }
            >
                {children}
            </View>
        </DragContext.Provider>
    );
}

export function useDrag() {
    const context = useContext(DragContext);
    if (!context) throw new Error("useDrag must be used within DragProvider");
    return context;
}

function acceptsDrop(payload: DragPayload, target: DropTarget): boolean {
    if (target.kind === "delete") return payload.source !== "palette";
    if (payload.source === "condition") {
        return target.kind !== "condition";
    }
    if (target.kind === "condition" && payload.source === "query") {
        return payload.origin.conditionId !== target.conditionId;
    }
    return true;
}
