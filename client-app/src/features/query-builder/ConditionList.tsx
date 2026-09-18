import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    Easing,
    FadeOut,
    Keyframe,
    interpolateColor,
    runOnJS,
    useAnimatedStyle,
    useAnimatedProps,
    useSharedValue,
    withDelay,
    withTiming,
    type LayoutAnimationFunction,
    type SharedValue,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useColorScheme } from "nativewind";
import { DraggablePill } from "./DraggablePill";
import { useDrag } from "./DragContext";
import { DropSlot } from "./DropSlot";
import { QueryTagPill } from "./QueryTagPill";
import {
    conditionConnectorLabel,
    getConditionReorderPosition,
    groupMemberConnectorLabel,
} from "./QueryUtils";
import type {
    DragPayload,
    QueryCondition,
    QueryGroupMode,
    QueryTag,
} from "./types";

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
const GROUP_MODES = ["any", "all", "none"] as const;
const MODE_OPTION_WIDTH = 70;
const MODE_OPTION_GAP = 5;
const MODE_OPTION_STEP = MODE_OPTION_WIDTH + MODE_OPTION_GAP;
const MODE_KNOB_WIDTH = MODE_OPTION_WIDTH + 8;
const MODE_KNOB_OFFSET = (MODE_KNOB_WIDTH - MODE_OPTION_WIDTH) / 2;
const MODE_CONTROL_VERTICAL_PADDING = 2;
const MODE_CONTROL_HORIZONTAL_PADDING = 6;
const MODE_KNOB_EASING = {
    duration: 270,
    easing: Easing.inOut(Easing.cubic),
};
const AnimatedPath = Animated.createAnimatedComponent(Path);
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
    onToggleConditionNegation,
    onModeChange,
    onConnectorToggle,
}: {
    conditions: readonly QueryCondition[];
    onToggleConditionNegation: (conditionId: string) => void;
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
        setConditionReorderResolver,
    } = useDrag();
    const [conditionCenters, setConditionCenters] = useState(
        () => new Map<string, number>(),
    );
    const conditionCentersRef = useRef(conditionCenters);
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
    const updateConditionCenter = useCallback(
        (conditionId: string, centerY: number) => {
            if (conditionCentersRef.current.get(conditionId) === centerY) {
                return;
            }
            const next = new Map(conditionCentersRef.current);
            next.set(conditionId, centerY);
            conditionCentersRef.current = next;
            setConditionCenters(next);
        },
        [],
    );
    const recordConditionCenter = useCallback(
        (conditionId: string, centerY: number) => {
            if (conditionDrag) return;
            updateConditionCenter(conditionId, centerY);
        },
        [conditionDrag, updateConditionCenter],
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
                updateConditionCenter(conditionId, y + height / 2);
            });
        });
    }, [updateConditionCenter]);
    const resolveConditionReorderIndex = useCallback(
        (payload: Extract<DragPayload, { source: "condition" }>, y: number) =>
            getConditionReorderPosition(
                conditions,
                payload.condition.id,
                y,
                conditionCentersRef.current,
            )?.insertionIndex ?? null,
        [conditions],
    );
    useEffect(() => {
        setConditionReorderResolver(resolveConditionReorderIndex);
        return () => setConditionReorderResolver(null);
    }, [resolveConditionReorderIndex, setConditionReorderResolver]);
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
                <Text className="px-5 text-center text-sm text-muted-foreground">
                    {queryEndHovered
                        ? "Create a new tag group."
                        : "Drag a tag here to start a query."}
                </Text>
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
                                        onToggleConditionNegation={
                                            onToggleConditionNegation
                                        }
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
    onToggleConditionNegation,
    onModeChange,
    onCenterChange,
    onPrepareDrag,
    onRefChange,
}: {
    condition: QueryCondition;
    index: number;
    layoutCompensationY: number;
    onToggleConditionNegation: (conditionId: string) => void;
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
    const toggleNegation = useCallback(
        () => onToggleConditionNegation(condition.id),
        [condition.id, onToggleConditionNegation],
    );
    return (
        <DraggablePill
            payload={dragPayload}
            dragHandle={<ConditionDragHandle condition={condition} />}
            layoutCompensationY={layoutCompensationY}
            onContentTap={condition.kind === "tag" ? toggleNegation : undefined}
            onPrepareDrag={onPrepareDrag}
            verticalOnly
        >
            <View
                ref={setConditionRef}
                accessible={condition.kind === "tag"}
                accessibilityRole={
                    condition.kind === "tag" ? "button" : undefined
                }
                accessibilityLabel={
                    condition.kind === "tag"
                        ? `${condition.tag.name}, ${condition.negated ? "not applied" : "applied"}`
                        : undefined
                }
                accessibilityHint={
                    condition.kind === "tag"
                        ? "Toggles whether this tag must not be applied"
                        : undefined
                }
                onAccessibilityTap={
                    condition.kind === "tag" ? toggleNegation : undefined
                }
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
    const { dragState } = useDrag();
    const isGroupReordering =
        condition.kind === "group" &&
        dragState?.payload.source === "condition" &&
        dragState.payload.condition.id === condition.id;
    const gripColorProgress = useSharedValue(isGroupReordering ? 1 : 0);

    useEffect(() => {
        gripColorProgress.set(
            withTiming(isGroupReordering ? 1 : 0, {
                duration: 160,
                easing: Easing.out(Easing.cubic),
            }),
        );
    }, [gripColorProgress, isGroupReordering]);

    const gripPathProps = useAnimatedProps(() => ({
        fill: interpolateColor(
            gripColorProgress.get(),
            [0, 1],
            [theme.mutedForeground, theme.primary],
        ),
    }));

    return (
        <View
            className="h-12 w-12 items-center justify-center"
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Reorder ${label}`}
            accessibilityHint="Drag to move this condition"
        >
            <Svg
                width={22}
                height={22}
                viewBox="0 0 24 24"
                accessible={false}
                importantForAccessibility="no"
            >
                <AnimatedPath
                    animatedProps={gripPathProps}
                    d="M8.5 7a2 2 0 1 0 0-4a2 2 0 0 0 0 4m0 7a2 2 0 1 0 0-4a2 2 0 0 0 0 4m2 5a2 2 0 1 1-4 0a2 2 0 0 1 4 0m5-12a2 2 0 1 0 0-4a2 2 0 0 0 0 4m2 5a2 2 0 1 1-4 0a2 2 0 0 1 4 0m-2 9a2 2 0 1 0 0-4a2 2 0 0 0 0 4"
                />
            </Svg>
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
    onModeChange,
}: {
    condition: QueryCondition;
    onModeChange: (groupId: string, mode: QueryGroupMode) => void;
}) {
    const group = condition.kind === "group" ? condition : null;
    const members = group ? group.members : [condition as QueryTag];
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];
    const { conditionLayoutAnimationsSuppressed, dragState, hoveredTargetKey } =
        useDrag();
    const hovered = Boolean(
        dragState && hoveredTargetKey === `condition-${condition.id}`,
    );
    const contents = (
        <DropSlot
            targetKey={`condition-${condition.id}`}
            target={{ kind: "condition", conditionId: condition.id }}
            priority={30}
            className={cn(
                "pl-12 pr-3",
                group ? "pb-2.5 pt-2" : "min-h-12 flex-row items-center py-1.5",
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
                    "flex-row flex-wrap items-center gap-x-2 gap-y-0.5",
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
                            <Text
                                className="text-[10px] font-bold"
                                style={{ color: theme.mutedForeground }}
                            >
                                {groupMemberConnectorLabel(group.mode)}
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
                            />
                        </Animated.View>
                        {condition.kind === "tag" && condition.negated ? (
                            <Text className="text-[10px] font-bold text-muted-foreground">
                                NOT APPLIED
                            </Text>
                        ) : null}
                    </Animated.View>
                ))}
            </View>
        </DropSlot>
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
            {contents}
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
    const modeIndex = GROUP_MODES.indexOf(mode);
    const previewIndex = useSharedValue(modeIndex);
    const thumbX = useSharedValue(modeIndex * MODE_OPTION_STEP);
    const isSliding = useSharedValue(0);
    const slideCompleted = useSharedValue(0);

    useEffect(() => {
        if (isSliding.get()) return;
        previewIndex.set(modeIndex);
        thumbX.set(withTiming(modeIndex * MODE_OPTION_STEP, MODE_KNOB_EASING));
    }, [isSliding, modeIndex, previewIndex, thumbX]);

    const commitIndex = useCallback(
        (index: number) => onChange(GROUP_MODES[index]),
        [onChange],
    );
    const animateAndCommit = useCallback(
        (index: number) => {
            if (previewIndex.get() !== index) triggerModeHaptic();
            previewIndex.set(index);
            thumbX.set(withTiming(index * MODE_OPTION_STEP, MODE_KNOB_EASING));
            commitIndex(index);
        },
        [commitIndex, previewIndex, thumbX],
    );
    const gesture = useMemo(() => {
        const indexForTouch = (x: number) => {
            "worklet";
            return Math.max(
                0,
                Math.min(
                    GROUP_MODES.length - 1,
                    Math.round(
                        (x -
                            MODE_CONTROL_HORIZONTAL_PADDING -
                            MODE_OPTION_WIDTH / 2) /
                        MODE_OPTION_STEP,
                    ),
                ),
            );
        };
        const snapToTouch = (x: number) => {
            "worklet";
            const nextIndex = indexForTouch(x);
            if (previewIndex.get() === nextIndex) return;
            previewIndex.set(nextIndex);
            thumbX.set(
                withTiming(nextIndex * MODE_OPTION_STEP, MODE_KNOB_EASING),
            );
            runOnJS(triggerModeHaptic)();
        };
        const pan = Gesture.Pan()
            .activeOffsetX([-4, 4])
            .failOffsetY([-8, 8])
            .onStart((event) => {
                isSliding.set(1);
                slideCompleted.set(0);
                snapToTouch(event.x);
            })
            .onUpdate((event) => snapToTouch(event.x))
            .onEnd(() => {
                slideCompleted.set(1);
                runOnJS(commitIndex)(previewIndex.get());
            })
            .onFinalize(() => {
                if (isSliding.get() && !slideCompleted.get()) {
                    previewIndex.set(modeIndex);
                    thumbX.set(
                        withTiming(
                            modeIndex * MODE_OPTION_STEP,
                            MODE_KNOB_EASING,
                        ),
                    );
                }
                isSliding.set(0);
            });
        const tap = Gesture.Tap()
            .maxDistance(8)
            .onEnd((event, success) => {
                if (!success) return;
                const nextIndex = indexForTouch(event.x);
                if (previewIndex.get() !== nextIndex) {
                    runOnJS(triggerModeHaptic)();
                }
                previewIndex.set(nextIndex);
                thumbX.set(
                    withTiming(nextIndex * MODE_OPTION_STEP, MODE_KNOB_EASING),
                );
                runOnJS(commitIndex)(nextIndex);
            });
        return Gesture.Race(pan, tap);
    }, [
        commitIndex,
        isSliding,
        modeIndex,
        previewIndex,
        slideCompleted,
        thumbX,
    ]);
    const thumbStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: thumbX.get() }],
    }));

    return (
        <GestureDetector gesture={gesture}>
            <View
                className="self-start flex-row rounded-full bg-secondary"
                style={{
                    paddingHorizontal: MODE_CONTROL_HORIZONTAL_PADDING,
                    paddingVertical: MODE_CONTROL_VERTICAL_PADDING,
                    gap: MODE_OPTION_GAP,
                }}
                accessibilityRole="radiogroup"
            >
                <Animated.View
                    pointerEvents="none"
                    className="absolute rounded-full"
                    style={[
                        {
                            left:
                                MODE_CONTROL_HORIZONTAL_PADDING -
                                MODE_KNOB_OFFSET,
                            top: MODE_CONTROL_VERTICAL_PADDING,
                            bottom: MODE_CONTROL_VERTICAL_PADDING,
                            width: MODE_KNOB_WIDTH,
                            backgroundColor: theme.background,
                        },
                        thumbStyle,
                    ]}
                />
                {GROUP_MODES.map((option, index) => (
                    <ModeOption
                        key={option}
                        label={`HAVE ${option.toUpperCase()}`}
                        index={index}
                        mode={mode}
                        option={option}
                        thumbX={thumbX}
                        foreground={theme.foreground}
                        mutedForeground={theme.mutedForeground}
                        onAccessibilitySelect={() => animateAndCommit(index)}
                    />
                ))}
            </View>
        </GestureDetector>
    );
}

function triggerModeHaptic() {
    void Haptics.selectionAsync().catch(() => {
        // Haptics are best-effort and should never block mode selection.
    });
}

function ModeOption({
    label,
    index,
    mode,
    option,
    thumbX,
    foreground,
    mutedForeground,
    onAccessibilitySelect,
}: {
    label: string;
    index: number;
    mode: QueryGroupMode;
    option: QueryGroupMode;
    thumbX: SharedValue<number>;
    foreground: string;
    mutedForeground: string;
    onAccessibilitySelect: () => void;
}) {
    const textStyle = useAnimatedStyle(() => {
        const distance = Math.min(
            1,
            Math.abs(thumbX.get() / MODE_OPTION_STEP - index),
        );
        return {
            color: interpolateColor(
                distance,
                [0, 1],
                [foreground, mutedForeground],
            ),
        };
    });
    return (
        <View
            className="min-h-7 items-center justify-center"
            style={{ width: MODE_OPTION_WIDTH }}
            accessible
            accessibilityRole="radio"
            accessibilityState={{ checked: mode === option }}
            accessibilityLabel={label}
            onAccessibilityTap={onAccessibilitySelect}
        >
            <Animated.Text
                className="text-[10px] font-bold tracking-wider"
                style={textStyle}
            >
                {label}
            </Animated.Text>
        </View>
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
}: {
    queryTag: QueryTag;
    conditionId: string;
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
        <DraggablePill payload={dragPayload}>
            <QueryTagPill queryTag={queryTag} />
        </DraggablePill>
    );
}
