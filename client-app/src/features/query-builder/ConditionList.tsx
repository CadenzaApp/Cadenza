import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated, {
    Easing,
    FadeOut,
    Keyframe,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withTiming,
    type LayoutAnimationFunction,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useColorScheme } from "nativewind";
import { DraggablePill, SCROLLABLE_TAG_DRAG_HOLD_MS } from "./DraggablePill";
import { useDrag } from "./DragContext";
import { DropSlot } from "./DropSlot";
import { QueryTagPill } from "./QueryTagPill";
import {
    conditionConnectorLabel,
    getConditionReorderPosition,
} from "./QueryUtils";
import type { QueryCondition, QueryGroupMode, QueryTag } from "./types";

const REORDER_DURATION = 320;
const CONNECTOR_REVEAL_DURATION = 220;
const SOFT_EASING = Easing.bezier(0.22, 0.8, 0.3, 1);
const CONDITION_LAYOUT_TRANSITION: LayoutAnimationFunction = (values) => {
    "worklet";
    return {
        initialValues: {
            originX: values.currentOriginX,
            originY: values.currentOriginY,
            width: values.currentWidth,
            height: values.currentHeight,
        },
        animations: {
            originX: withTiming(values.targetOriginX, {
                duration: REORDER_DURATION,
                easing: SOFT_EASING,
            }),
            originY: withTiming(values.targetOriginY, {
                duration: REORDER_DURATION,
                easing: SOFT_EASING,
            }),
            width: withTiming(values.targetWidth, {
                duration: REORDER_DURATION,
                easing: SOFT_EASING,
            }),
            height: withTiming(values.targetHeight, {
                duration: REORDER_DURATION,
                easing: SOFT_EASING,
            }),
        },
    };
};
const POSITION_ONLY_LAYOUT_TRANSITION: LayoutAnimationFunction = (values) => {
    "worklet";
    return {
        initialValues: {
            originX: values.targetOriginX,
            originY: values.currentOriginY,
            width: values.targetWidth,
            height: values.targetHeight,
        },
        animations: {
            originY: withTiming(values.targetOriginY, {
                duration: REORDER_DURATION,
                easing: SOFT_EASING,
            }),
        },
    };
};
const TAG_LAYOUT_TRANSITION = CONDITION_LAYOUT_TRANSITION;
const CONNECTOR_HEIGHT = 42;
const SELECTOR_ENTER_TRANSITION = new Keyframe({
    0: { opacity: 0, transform: [{ translateY: -6 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }] },
}).duration(220);
const SELECTOR_EXIT_TRANSITION = new Keyframe({
    0: { opacity: 1, transform: [{ translateY: 0 }] },
    100: { opacity: 0, transform: [{ translateY: -6 }] },
}).duration(180);

export function ConditionList({
    conditions,
    onToggleNegation,
    onModeChange,
    onConnectorToggle,
}: {
    conditions: readonly QueryCondition[];
    onToggleNegation: (queryTagId: string) => void;
    onModeChange: (groupId: string, mode: QueryGroupMode) => void;
    onConnectorToggle: (conditionId: string) => void;
}) {
    const {
        conditionLayoutAnimationsSuppressed,
        conditionRelease,
        dragState,
        hoveredTargetKey,
        settlingConditionId,
        setConditionReleaseTarget,
        setConditionReorderIndex,
    } = useDrag();
    const [conditionCenters, setConditionCenters] = useState(
        () => new Map<string, number>(),
    );
    const conditionRefs = useRef(new Map<string, View>());
    const queryEndHovered = hoveredTargetKey === "query-end";
    const conditionDrag =
        dragState?.payload.source === "condition" ? dragState.payload : null;
    const releaseConditionId = conditionRelease?.condition.id ?? null;
    const releaseCommitted = Boolean(
        conditionRelease &&
        conditions.findIndex(
            (condition) => condition.id === conditionRelease.condition.id,
        ) === conditionRelease.finalIndex,
    );
    // Keep the live destination reservation until the reordered array has
    // committed. The following render swaps it atomically for the permanent
    // boundary slot, so there is never a frame with neither reservation.
    const previewConditionDrag =
        conditionRelease && releaseCommitted ? null : conditionDrag;
    const queryEndPreviewVisible = Boolean(queryEndHovered && !conditionDrag);
    const previewColor = dragState ? dragTagColor(dragState.payload) : null;
    const previewLabel = "CREATE A NEW TAG GROUP";
    const recordConditionCenter = useCallback(
        (conditionId: string, centerY: number) => {
            if (conditionDrag) return;
            setConditionCenters((current) => {
                if (current.get(conditionId) === centerY) return current;
                const next = new Map(current);
                next.set(conditionId, centerY);
                return next;
            });
        },
        [conditionDrag],
    );
    const registerConditionRef = useCallback(
        (conditionId: string, view: View | null) => {
            if (view) conditionRefs.current.set(conditionId, view);
            else conditionRefs.current.delete(conditionId);
        },
        [],
    );
    const refreshConditionCenters = useCallback(() => {
        conditionRefs.current.forEach((view, conditionId) => {
            view.measureInWindow((_x, y, _width, height) => {
                if (height <= 0) return;
                setConditionCenters((current) => {
                    const centerY = y + height / 2;
                    if (current.get(conditionId) === centerY) return current;
                    const next = new Map(current);
                    next.set(conditionId, centerY);
                    return next;
                });
            });
        });
    }, []);
    useEffect(() => {
        if (!releaseConditionId || !settlingConditionId || dragState) return;
        let secondFrame: number | undefined;
        const firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => {
                conditionRefs.current
                    .get(releaseConditionId)
                    ?.measureInWindow((_x, y, _width, height) => {
                        if (height > 0) {
                            setConditionReleaseTarget(y + height / 2);
                        }
                    });
            });
        });
        return () => {
            cancelAnimationFrame(firstFrame);
            if (secondFrame != null) cancelAnimationFrame(secondFrame);
        };
    }, [
        dragState,
        releaseConditionId,
        settlingConditionId,
        setConditionReleaseTarget,
    ]);

    const reorderPosition =
        previewConditionDrag && dragState
            ? getConditionReorderPosition(
                  conditions,
                  previewConditionDrag.condition.id,
                  dragState.y,
                  conditionCenters,
              )
            : null;
    const reorderFinalIndex = reorderPosition?.finalIndex ?? null;
    const reorderInsertionIndex = reorderPosition?.insertionIndex ?? null;
    useEffect(() => {
        setConditionReorderIndex(reorderInsertionIndex);
    }, [reorderInsertionIndex, setConditionReorderIndex]);

    const remainingConditions = previewConditionDrag
        ? conditions.filter(
              (condition) => condition.id !== previewConditionDrag.condition.id,
          )
        : [];
    const originalFinalIndex = previewConditionDrag
        ? Math.min(previewConditionDrag.originIndex, remainingConditions.length)
        : null;
    const effectiveFinalIndex = reorderFinalIndex ?? originalFinalIndex;
    const staysAtOrigin = Boolean(
        previewConditionDrag && effectiveFinalIndex === originalFinalIndex,
    );
    const movedFromOrigin = Boolean(previewConditionDrag && !staysAtOrigin);
    const collapsedConnectorIndex = movedFromOrigin
        ? previewConditionDrag!.originIndex === 0
            ? 1
            : previewConditionDrag!.originIndex
        : undefined;
    const releaseConnectorIndex = conditionRelease
        ? conditionRelease.originIndex === 0
            ? 1
            : conditionRelease.originIndex
        : undefined;
    const spacerBeforeId = previewConditionDrag
        ? staysAtOrigin
            ? undefined
            : remainingConditions[effectiveFinalIndex ?? -1]?.id
        : undefined;
    const spacerAfterId = staysAtOrigin
        ? previewConditionDrag?.condition.id
        : undefined;
    const spacerAtEnd = Boolean(
        previewConditionDrag && !staysAtOrigin && !spacerBeforeId,
    );
    const movingUp = Boolean(
        previewConditionDrag &&
        effectiveFinalIndex != null &&
        originalFinalIndex != null &&
        effectiveFinalIndex < originalFinalIndex,
    );
    const destinationHeight = previewConditionDrag
        ? previewConditionDrag.height + (movedFromOrigin ? CONNECTOR_HEIGHT : 0)
        : 0;

    return (
        <DropSlot
            targetKey="query-end"
            target={{ kind: "query-end" }}
            className={cn(
                "min-h-40 rounded-xl",
                conditions.length > 0 && "pb-14",
                conditions.length === 0 && "items-center justify-center",
                conditions.length === 0 &&
                    "border border-dashed border-border bg-background",
            )}
            style={{ flexGrow: 1 }}
        >
            {conditions.length === 0 ? (
                queryEndHovered && previewColor ? (
                    <NewGroupInsertionPreview
                        color={previewColor}
                        label={previewLabel}
                    />
                ) : (
                    <Text className="px-5 text-center text-sm text-muted-foreground">
                        Drag a tag here to start a query.
                    </Text>
                )
            ) : (
                <>
                    {conditions.flatMap((condition, index) => [
                        <InsertionSlot
                            key={`connector-slot-${index}`}
                            index={index}
                            condition={condition}
                            settleImmediately={!previewConditionDrag}
                            collapse={collapsedConnectorIndex === index}
                            deferReveal={movedFromOrigin}
                            hidden={
                                releaseConnectorIndex === index ||
                                previewConditionDrag?.condition.id ===
                                    condition.id ||
                                collapsedConnectorIndex === index
                            }
                            visible={index > 0}
                            expanded={index === 0}
                            onConnectorToggle={() =>
                                onConnectorToggle(condition.id)
                            }
                        />,
                        <Animated.View
                            key={`condition-${condition.layoutId ?? condition.id}`}
                            collapsable={false}
                            layout={
                                conditionDrag?.condition.id === condition.id ||
                                settlingConditionId === condition.id
                                    ? undefined
                                    : conditionLayoutAnimationsSuppressed
                                      ? POSITION_ONLY_LAYOUT_TRANSITION
                                      : CONDITION_LAYOUT_TRANSITION
                            }
                            style={{
                                zIndex:
                                    conditionDrag?.condition.id ===
                                        condition.id ||
                                    settlingConditionId === condition.id
                                        ? 1000
                                        : 0,
                            }}
                        >
                            <Animated.View
                                exiting={FadeOut.duration(180).easing(
                                    SOFT_EASING,
                                )}
                            >
                                <View
                                    style={{
                                        opacity:
                                            releaseConditionId === condition.id
                                                ? 0
                                                : 1,
                                    }}
                                >
                                    <ReorderSpacer
                                        active={spacerBeforeId === condition.id}
                                        height={destinationHeight}
                                        settleImmediately={
                                            !previewConditionDrag
                                        }
                                    />
                                    <DraggableCondition
                                        condition={condition}
                                        index={index}
                                        layoutCompensationY={
                                            previewConditionDrag?.condition
                                                .id === condition.id
                                                ? movingUp
                                                    ? -previewConditionDrag.height
                                                    : movedFromOrigin &&
                                                        index > 0
                                                      ? CONNECTOR_HEIGHT
                                                      : 0
                                                : 0
                                        }
                                        onToggleNegation={onToggleNegation}
                                        onModeChange={onModeChange}
                                        onCenterChange={recordConditionCenter}
                                        onPrepareDrag={refreshConditionCenters}
                                        onRefChange={registerConditionRef}
                                    />
                                    <ReorderSpacer
                                        active={spacerAfterId === condition.id}
                                        height={destinationHeight}
                                        settleImmediately={
                                            !previewConditionDrag
                                        }
                                    />
                                </View>
                            </Animated.View>
                        </Animated.View>,
                    ])}
                    <ReorderSpacer
                        active={spacerAtEnd}
                        height={destinationHeight}
                        settleImmediately={!previewConditionDrag}
                    />
                    {queryEndPreviewVisible && previewColor ? (
                        <NewGroupInsertionPreview
                            color={previewColor}
                            label={previewLabel}
                        />
                    ) : null}
                </>
            )}
        </DropSlot>
    );
}

function DraggableCondition({
    condition,
    index,
    layoutCompensationY,
    onToggleNegation,
    onModeChange,
    onCenterChange,
    onPrepareDrag,
    onRefChange,
}: {
    condition: QueryCondition;
    index: number;
    layoutCompensationY: number;
    onToggleNegation: (queryTagId: string) => void;
    onModeChange: (groupId: string, mode: QueryGroupMode) => void;
    onCenterChange: (conditionId: string, centerY: number) => void;
    onPrepareDrag: () => void;
    onRefChange: (conditionId: string, view: View | null) => void;
}) {
    const conditionRef = useRef<View>(null);
    const [height, setHeight] = useState(0);
    const setConditionRef = useCallback(
        (view: View | null) => {
            conditionRef.current = view;
            onRefChange(condition.id, view);
        },
        [condition.id, onRefChange],
    );
    const dragPayload = useMemo(
        () => ({
            source: "condition" as const,
            condition,
            originIndex: index,
            height,
        }),
        [condition, height, index],
    );
    return (
        <DraggablePill
            payload={dragPayload}
            dragHandle={<ConditionDragHandle condition={condition} />}
            layoutCompensationY={layoutCompensationY}
            onPrepareDrag={onPrepareDrag}
            verticalOnly
        >
            <View
                ref={setConditionRef}
                onLayout={(event) => {
                    setHeight(event.nativeEvent.layout.height);
                    conditionRef.current?.measureInWindow(
                        (_x, y, _width, measuredHeight) =>
                            onCenterChange(
                                condition.id,
                                y + measuredHeight / 2,
                            ),
                    );
                }}
            >
                <ConditionCard
                    condition={condition}
                    onToggleNegation={onToggleNegation}
                    onModeChange={onModeChange}
                />
            </View>
        </DraggablePill>
    );
}

export function ConditionDragHandle({
    condition,
}: {
    condition: QueryCondition;
}) {
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];
    const label = condition.kind === "group" ? "tag group" : "tag";

    return (
        <View
            className="h-11 w-11 items-center justify-center"
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Reorder ${label}`}
            accessibilityHint="Drag to move this condition"
        >
            <Ionicons
                name="reorder-two"
                size={22}
                color={theme.mutedForeground}
                accessibilityElementsHidden
                importantForAccessibility="no"
            />
        </View>
    );
}

function ReorderSpacer({
    active,
    height,
    settleImmediately = false,
}: {
    active: boolean;
    height: number;
    settleImmediately?: boolean;
}) {
    const targetHeight = active ? height : 0;
    const spacerHeight = useSharedValue(targetHeight);
    useLayoutEffect(() => {
        spacerHeight.set(
            settleImmediately
                ? targetHeight
                : withTiming(targetHeight, {
                      duration: REORDER_DURATION,
                      easing: SOFT_EASING,
                  }),
        );
    }, [settleImmediately, spacerHeight, targetHeight]);
    const animatedStyle = useAnimatedStyle(() => ({
        height: spacerHeight.get(),
    }));
    return <Animated.View pointerEvents="none" style={animatedStyle} />;
}

function ConditionCard({
    condition,
    onToggleNegation,
    onModeChange,
}: {
    condition: QueryCondition;
    onToggleNegation: (queryTagId: string) => void;
    onModeChange: (groupId: string, mode: QueryGroupMode) => void;
}) {
    const group = condition.kind === "group" ? condition : null;
    const members = group ? group.members : [condition as QueryTag];
    const { conditionLayoutAnimationsSuppressed, dragState, hoveredTargetKey } =
        useDrag();
    const hovered = Boolean(
        dragState && hoveredTargetKey === `condition-${condition.id}`,
    );
    return (
        <Animated.View
            layout={
                conditionLayoutAnimationsSuppressed
                    ? undefined
                    : CONDITION_LAYOUT_TRANSITION
            }
            className={cn(
                "overflow-hidden rounded-xl border",
                hovered ? "border-ring" : "border-border",
            )}
        >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface
                    variant="regular"
                    style={StyleSheet.absoluteFill}
                />
            </View>
            <DropSlot
                targetKey={`condition-${condition.id}`}
                target={{ kind: "condition", conditionId: condition.id }}
                priority={30}
                className={cn(
                    "pl-12 pr-3",
                    group
                        ? "pb-2.5 pt-2"
                        : "min-h-12 flex-row items-center py-1.5",
                    hovered && "bg-accent",
                )}
            >
                {group ? (
                    <Animated.View
                        collapsable={false}
                        entering={
                            conditionLayoutAnimationsSuppressed
                                ? undefined
                                : SELECTOR_ENTER_TRANSITION
                        }
                        exiting={
                            conditionLayoutAnimationsSuppressed
                                ? undefined
                                : SELECTOR_EXIT_TRANSITION
                        }
                    >
                        <ModeToggle
                            mode={group.mode}
                            onChange={(mode) => onModeChange(group.id, mode)}
                        />
                    </Animated.View>
                ) : null}
                <View
                    className={cn(
                        "flex-row flex-wrap items-center gap-2",
                        group && "mt-2",
                    )}
                >
                    {members.map((queryTag, index) => (
                        <Animated.View
                            key={queryTag.id}
                            layout={
                                conditionLayoutAnimationsSuppressed
                                    ? undefined
                                    : TAG_LAYOUT_TRANSITION
                            }
                            className="flex-row items-center gap-2"
                        >
                            {group && index > 0 ? (
                                <Text className="text-[10px] font-bold text-muted-foreground">
                                    {group.mode === "any" ? "OR" : "AND"}
                                </Text>
                            ) : null}
                            <Animated.View
                                layout={
                                    conditionLayoutAnimationsSuppressed
                                        ? undefined
                                        : TAG_LAYOUT_TRANSITION
                                }
                            >
                                <DraggableQueryTag
                                    queryTag={queryTag}
                                    conditionId={condition.id}
                                    onToggleNegation={onToggleNegation}
                                />
                            </Animated.View>
                        </Animated.View>
                    ))}
                </View>
            </DropSlot>
        </Animated.View>
    );
}

function ModeToggle({
    mode,
    onChange,
}: {
    mode: QueryGroupMode;
    onChange: (mode: QueryGroupMode) => void;
}) {
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];

    return (
        <Pressable
            onPress={() => onChange(mode === "any" ? "all" : "any")}
            className="self-start flex-row rounded-full bg-secondary p-0.5"
            hitSlop={{ top: 7, bottom: 7, left: 4, right: 4 }}
            accessibilityRole="switch"
            accessibilityState={{ checked: mode === "all" }}
            accessibilityLabel={
                mode === "any"
                    ? "Match any tag in group. Tap to match all tags."
                    : "Match all tags in group. Tap to match any tag."
            }
        >
            {(["any", "all"] as const).map((option) => {
                const selected = option === mode;
                return (
                    <View
                        key={option}
                        className="min-h-7 justify-center rounded-full px-3"
                        style={
                            selected
                                ? { backgroundColor: theme.background }
                                : undefined
                        }
                    >
                        <Text
                            className="text-[10px] font-bold tracking-wider"
                            style={{
                                color: selected
                                    ? theme.foreground
                                    : theme.mutedForeground,
                            }}
                        >
                            {option === "any" ? "HAVE ANY" : "HAVE ALL"}
                        </Text>
                    </View>
                );
            })}
        </Pressable>
    );
}

function InsertionSlot({
    index,
    condition,
    settleImmediately = false,
    collapse = false,
    deferReveal = false,
    hidden = false,
    visible = true,
    expanded = false,
    onConnectorToggle,
}: {
    index: number;
    condition: QueryCondition;
    settleImmediately?: boolean;
    collapse?: boolean;
    deferReveal?: boolean;
    hidden?: boolean;
    visible?: boolean;
    expanded?: boolean;
    onConnectorToggle: () => void;
}) {
    const { dragState, hoveredTargetKey } = useDrag();
    const hovered = Boolean(
        dragState && hoveredTargetKey === `insert-${index}`,
    );
    const conditionDrag =
        dragState?.payload.source === "condition" ? dragState.payload : null;
    const previewVisible = Boolean(hovered && !conditionDrag);
    const previewColor = dragState ? dragTagColor(dragState.payload) : null;
    const previewLabel = "CREATE A NEW TAG GROUP";
    const connectorVisible = visible && !hidden && !previewVisible;
    const baseHeight = collapse
        ? 0
        : previewVisible
          ? CONNECTOR_HEIGHT
          : visible
            ? CONNECTOR_HEIGHT
            : expanded
              ? 16
              : 8;
    const slotHeight = useSharedValue(baseHeight);
    const connectorProgress = useSharedValue(0);
    const connectorNeedsSettling = useRef(false);
    useLayoutEffect(() => {
        slotHeight.set(
            settleImmediately
                ? baseHeight
                : withTiming(baseHeight, {
                      duration: REORDER_DURATION,
                      easing: SOFT_EASING,
                  }),
        );
    }, [baseHeight, settleImmediately, slotHeight]);
    useEffect(() => {
        const animation = withTiming(connectorVisible ? 1 : 0, {
            duration: CONNECTOR_REVEAL_DURATION,
            easing: SOFT_EASING,
        });
        if (!connectorVisible) {
            connectorNeedsSettling.current = deferReveal;
        }
        connectorProgress.set(
            connectorVisible && connectorNeedsSettling.current
                ? withDelay(REORDER_DURATION, animation)
                : animation,
        );
        if (connectorVisible) connectorNeedsSettling.current = false;
    }, [connectorProgress, connectorVisible, deferReveal]);
    const connectorStyle = useAnimatedStyle(() => ({
        opacity: connectorProgress.get(),
        transform: [{ scaleX: connectorProgress.get() }],
    }));
    const slotStyle = useAnimatedStyle(() => ({
        height: slotHeight.get(),
    }));

    return (
        <Animated.View style={slotStyle}>
            <DropSlot
                targetKey={`insert-${index}`}
                target={{ kind: "insert", index }}
                priority={20}
                className="flex-1 flex-row items-center"
            >
                {previewVisible && previewColor ? (
                    <NewGroupInsertionPreview
                        color={previewColor}
                        label={previewLabel}
                    />
                ) : (
                    <Pressable
                        onPress={onConnectorToggle}
                        className="flex-1 flex-row items-center"
                        accessible={connectorVisible}
                        disabled={!connectorVisible}
                        pointerEvents={connectorVisible ? "auto" : "none"}
                        style={({ pressed }) => ({
                            opacity: pressed ? 0.72 : 1,
                        })}
                        accessibilityRole="button"
                        accessibilityLabel={`${conditionConnectorLabel(condition)} connector`}
                        accessibilityHint={`Changes this connector to ${condition.connector === "and" ? "OR" : "AND"}`}
                    >
                        <Animated.View
                            className="flex-1 flex-row items-center"
                            style={connectorStyle}
                        >
                            <View className="h-px flex-1 bg-border" />
                            <Text className="mx-2 overflow-hidden rounded-full bg-secondary px-3 py-1.5 text-[10px] font-bold text-secondary-foreground">
                                {conditionConnectorLabel(condition)}
                            </Text>
                            <View className="h-px flex-1 bg-border" />
                        </Animated.View>
                    </Pressable>
                )}
            </DropSlot>
        </Animated.View>
    );
}

function NewGroupInsertionPreview({
    color,
    label,
}: {
    color: string;
    label: string;
}) {
    const reveal = useSharedValue(0);
    const lineStyle = useAnimatedStyle(() => ({
        transform: [{ scaleX: reveal.get() }],
    }));

    useEffect(() => {
        reveal.set(0);
        reveal.set(
            withTiming(1, {
                duration: REORDER_DURATION,
                easing: SOFT_EASING,
            }),
        );
    }, [color, reveal]);

    return (
        <View className="h-10 w-full items-center justify-center">
            <View className="w-full flex-row items-center">
                <Animated.View
                    className="h-0.5 flex-1"
                    style={[{ backgroundColor: color }, lineStyle]}
                />
                <View className="bg-background px-3">
                    <Text className="text-[10px] font-bold" style={{ color }}>
                        {label}
                    </Text>
                </View>
                <Animated.View
                    className="h-0.5 flex-1"
                    style={[{ backgroundColor: color }, lineStyle]}
                />
            </View>
        </View>
    );
}

function dragTagColor(payload: import("./types").DragPayload) {
    if (payload.source === "palette") return payload.tag.color;
    if (payload.source === "query") return payload.queryTag.tag.color;
    const condition = payload.condition;
    return condition.kind === "tag"
        ? condition.tag.color
        : (condition.members[0]?.tag.color ?? "#737373");
}

function DraggableQueryTag({
    queryTag,
    conditionId,
    onToggleNegation,
}: {
    queryTag: QueryTag;
    conditionId: string;
    onToggleNegation: (queryTagId: string) => void;
}) {
    const dragPayload = useMemo(
        () => ({
            source: "query" as const,
            queryTag,
            origin: { conditionId },
        }),
        [conditionId, queryTag],
    );
    return (
        <DraggablePill
            payload={dragPayload}
            activateAfterLongPress={SCROLLABLE_TAG_DRAG_HOLD_MS}
        >
            <QueryTagPill
                queryTag={queryTag}
                onToggle={() => onToggleNegation(queryTag.id)}
            />
        </DraggablePill>
    );
}
