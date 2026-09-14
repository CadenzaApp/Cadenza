import {
    createContext,
    useCallback,
    useContext,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { View } from "react-native";

import type { DragPayload, DragState, DropTarget } from "./types";

const CONDITION_REORDER_SETTLE_MS = 340;
const CONNECTOR_REVEAL_SETTLE_MS = 240;

type Rect = { x: number; y: number; width: number; height: number };
type RegisteredZone = {
    target: DropTarget;
    priority: number;
    measure: () => Promise<Rect | null>;
};

type ConditionRelease = {
    condition: Extract<DragPayload, { source: "condition" }>["condition"];
    finalIndex: number;
    height: number;
    originIndex: number;
    startCenterY: number;
    targetCenterY: number | null;
};

type DragContextValue = {
    dragState: DragState;
    conditionLayoutAnimationsSuppressed: boolean;
    settlingConditionId: string | null;
    conditionRelease: ConditionRelease | null;
    hoveredTargetKey: string | null;
    rootOffset: { x: number; y: number };
    registerDropZone: (key: string, zone: RegisteredZone) => void;
    unregisterDropZone: (key: string) => void;
    beginDrag: (payload: DragPayload, x: number, y: number) => Promise<void>;
    moveDrag: (payload: DragPayload, x: number, y: number) => void;
    prepareDragRelease: (x: number, y: number) => boolean;
    finishDrag: (payload: DragPayload, x: number, y: number) => void;
    setConditionReorderIndex: (index: number | null) => void;
    setConditionReleaseTarget: (centerY: number) => void;
    completeConditionRelease: () => void;
    cancelDrag: () => void;
};

const DragContext = createContext<DragContextValue | null>(null);

export function DragProvider({
    children,
    onDrop,
}: {
    children: ReactNode;
    onDrop: (payload: DragPayload, target: DropTarget) => void;
}) {
    const [dragState, setDragState] = useState<DragState>(null);
    const [
        conditionLayoutAnimationsSuppressed,
        setConditionLayoutAnimationsSuppressed,
    ] = useState(false);
    const [settlingConditionId, setSettlingConditionId] = useState<
        string | null
    >(null);
    const [conditionRelease, setConditionRelease] =
        useState<ConditionRelease | null>(null);
    const [hoveredTargetKey, setHoveredTargetKey] = useState<string | null>(
        null,
    );
    const [rootOffset, setRootOffset] = useState({ x: 0, y: 0 });
    const containerRef = useRef<View>(null);
    const zones = useRef(new Map<string, RegisteredZone>());
    const cachedRects = useRef(new Map<string, Rect>());
    const dragSession = useRef(0);
    const activePayload = useRef<DragPayload | null>(null);
    const conditionReorderIndex = useRef<number | null>(null);
    const pendingConditionReorderIndex = useRef<number | null>(null);
    const conditionReleasePending = useRef(false);
    const conditionAnimationTimer = useRef<ReturnType<
        typeof setTimeout
    > | null>(null);

    const registerDropZone = useCallback(
        (key: string, zone: RegisteredZone) => zones.current.set(key, zone),
        [],
    );
    const unregisterDropZone = useCallback((key: string) => {
        zones.current.delete(key);
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
                setSettlingConditionId(null);
                setConditionRelease(null);
                conditionReleasePending.current = false;
                setConditionLayoutAnimationsSuppressed(true);
            }
            conditionReorderIndex.current = null;
            pendingConditionReorderIndex.current = null;
            const session = dragSession.current;
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
            setHoveredTargetKey(findZoneAt(payload, x, y)?.key ?? null);
        },
        [findZoneAt],
    );

    const moveDrag = useCallback(
        (payload: DragPayload, x: number, y: number) => {
            setDragState({ payload, x, y });
            setHoveredTargetKey(findZoneAt(payload, x, y)?.key ?? null);
        },
        [findZoneAt],
    );
    const prepareDragRelease = useCallback(
        (x: number, y: number) => {
            pendingConditionReorderIndex.current =
                conditionReorderIndex.current;
            const payload = activePayload.current;
            const releaseTarget = payload
                ? findZoneAt(payload, x, y)
                : undefined;
            const willReorder = Boolean(
                payload?.source === "condition" &&
                releaseTarget?.target.kind !== "delete" &&
                pendingConditionReorderIndex.current != null &&
                pendingConditionReorderIndex.current !== payload.originIndex,
            );
            if (payload?.source === "condition") {
                setSettlingConditionId(payload.condition.id);
                if (willReorder) {
                    const insertionIndex =
                        pendingConditionReorderIndex.current!;
                    const finalIndex =
                        insertionIndex > payload.originIndex
                            ? insertionIndex - 1
                            : insertionIndex;
                    conditionReleasePending.current = true;
                    setConditionRelease({
                        condition: payload.condition,
                        finalIndex,
                        height: payload.height,
                        originIndex: payload.originIndex,
                        startCenterY: y,
                        targetCenterY: null,
                    });
                }
            }
            setDragState((current) =>
                current ? { ...current, releasing: true } : current,
            );
            return willReorder;
        },
        [findZoneAt],
    );
    const finishDrag = useCallback(
        (payload: DragPayload, x: number, y: number) => {
            const match = findZoneAt(payload, x, y);
            if (payload.source === "condition") {
                if (match?.target.kind === "delete") {
                    onDrop(payload, match.target);
                } else if (
                    (pendingConditionReorderIndex.current ??
                        conditionReorderIndex.current) != null
                ) {
                    onDrop(payload, {
                        kind: "insert",
                        index:
                            pendingConditionReorderIndex.current ??
                            conditionReorderIndex.current!,
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
    const setConditionReleaseTarget = useCallback((centerY: number) => {
        setConditionRelease((current) =>
            current ? { ...current, targetCenterY: centerY } : current,
        );
    }, []);
    const completeConditionRelease = useCallback(() => {
        conditionReleasePending.current = false;
        setConditionRelease(null);
        if (conditionAnimationTimer.current) {
            clearTimeout(conditionAnimationTimer.current);
        }
        const completedSession = dragSession.current;
        // Keep the committed connector slots fixed while the newly visible
        // divider fades in. Re-enabling layout animation at the same moment as
        // the reveal can briefly restore the slot's pre-release height.
        conditionAnimationTimer.current = setTimeout(() => {
            if (dragSession.current === completedSession) {
                setSettlingConditionId(null);
                setConditionLayoutAnimationsSuppressed(false);
            }
            conditionAnimationTimer.current = null;
        }, CONNECTOR_REVEAL_SETTLE_MS);
    }, []);
    const cancelDrag = useCallback(() => {
        dragSession.current += 1;
        const cancelledSession = dragSession.current;
        const wasConditionDrag = activePayload.current?.source === "condition";
        activePayload.current = null;
        setDragState(null);
        setHoveredTargetKey(null);
        cachedRects.current.clear();
        conditionReorderIndex.current = null;
        pendingConditionReorderIndex.current = null;
        if (wasConditionDrag) {
            if (conditionAnimationTimer.current) {
                clearTimeout(conditionAnimationTimer.current);
            }
            conditionAnimationTimer.current = setTimeout(
                () => {
                    if (dragSession.current === cancelledSession) {
                        setConditionLayoutAnimationsSuppressed(false);
                        setSettlingConditionId(null);
                        setConditionRelease(null);
                        conditionReleasePending.current = false;
                    }
                    conditionAnimationTimer.current = null;
                },
                conditionReleasePending.current
                    ? 1000
                    : CONDITION_REORDER_SETTLE_MS,
            );
        } else {
            setConditionLayoutAnimationsSuppressed(false);
            setSettlingConditionId(null);
        }
    }, []);

    return (
        <DragContext.Provider
            value={{
                dragState,
                conditionLayoutAnimationsSuppressed,
                settlingConditionId,
                conditionRelease,
                hoveredTargetKey,
                rootOffset,
                registerDropZone,
                unregisterDropZone,
                beginDrag,
                moveDrag,
                prepareDragRelease,
                finishDrag,
                setConditionReorderIndex,
                setConditionReleaseTarget,
                completeConditionRelease,
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
