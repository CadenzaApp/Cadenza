import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import {
    GroupModeControl,
    QuerySegmentedControl,
    VennDiagram,
} from "./GroupModeControl";
import { useEditorActions } from "./EditorActions";
import Animated, {
    Easing,
    FadeIn,
    FadeInDown,
    FadeOut,
    FadeOutUp,
    ReduceMotion,
    interpolateColor,
    useAnimatedStyle,
    useAnimatedProps,
    useSharedValue,
    withDelay,
    withTiming,
    type LayoutAnimationFunction,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { GlassSurface } from "@/components/ui/glass-surface";
import { TagPill } from "@/components/custom/tag-pill";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useColorScheme } from "nativewind";
import { DraggablePill } from "./DraggablePill";
import { useDrag } from "./DragContext";
import { DropSlot } from "./DropSlot";
import { QueryTagPill } from "./QueryTagPill";
import {
    getConditionReorderPosition,
    getConditionReorderShift,
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
const CONNECTOR_HEIGHT = 32;
const AnimatedPath = Animated.createAnimatedComponent(Path);

export function ConditionList({
    conditions,
    onToggleConditionNegation,
    onModeChange,
}: {
    conditions: readonly QueryCondition[];
    onToggleConditionNegation: (conditionId: string) => void;
    onModeChange: (groupId: string, mode: QueryGroupMode) => void;
}) {
    const {
        conditionLayoutAnimationsSuppressed,
        dragState,
        hoveredTargetKey,
        setConditionReorderIndex,
        setConditionReorderResolver,
    } = useDrag();
    const [conditionCenters, setConditionCenters] = useState(
        () => new Map<string, number>(),
    );
    const conditionCentersRef = useRef(conditionCenters);
    const conditionRefs = useRef(new Map<string, View>());
    const [rowHeights, setRowHeights] = useState(
        () => new Map<string, number>(),
    );
    const conditionDrag =
        dragState?.payload.source === "condition" ? dragState.payload : null;
    const { pendingTag, placeTagInNewCondition } = useEditorActions();
    const queryEndHovered =
        hoveredTargetKey === "query-end" ||
        hoveredTargetKey === "workspace-end";
    const previewColor = dragState ? dragTagColor(dragState.payload) : null;

    const recordConditionCenter = useCallback(
        (id: string, centerY: number) => {
            if (
                conditionCentersRef.current.get(id) === centerY ||
                conditionDrag
            )
                return;
            const next = new Map(conditionCentersRef.current);
            next.set(id, centerY);
            conditionCentersRef.current = next;
            setConditionCenters(next);
        },
        [conditionDrag],
    );
    const registerConditionRef = useCallback(
        (id: string, view: View | null) => {
            if (view) conditionRefs.current.set(id, view);
            else conditionRefs.current.delete(id);
        },
        [],
    );
    const refreshConditionCenters = useCallback(() => {
        conditionRefs.current.forEach((view, id) => {
            view.measureInWindow((_x, y, _width, height) => {
                if (height > 0) {
                    const next = new Map(conditionCentersRef.current);
                    next.set(id, y + height / 2);
                    conditionCentersRef.current = next;
                    setConditionCenters(next);
                }
            });
        });
    }, []);
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

    const reorderPosition = conditionDrag
        ? getConditionReorderPosition(
              conditions,
              conditionDrag.condition.id,
              dragState!.y,
              conditionCenters,
          )
        : null;
    useEffect(() => {
        setConditionReorderIndex(reorderPosition?.insertionIndex ?? null);
    }, [reorderPosition?.insertionIndex, setConditionReorderIndex]);
    const draggedRowHeight = conditionDrag
        ? (rowHeights.get(conditionDrag.condition.id) ??
          conditionDrag.height +
              (conditionDrag.originIndex === 0 ? 4 : CONNECTOR_HEIGHT))
        : 0;

    return (
        <DropSlot
            targetKey="query-end"
            target={{ kind: "query-end" }}
            className={cn(
                "rounded-xl",
                conditions.length > 0 && "pb-1",
                conditions.length === 0 && "items-center justify-center",
            )}
            style={{ flexGrow: conditions.length === 0 ? 1 : 0 }}
        >
            {conditions.length === 0 ? (
                <Text className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Drag a tag here to start.
                </Text>
            ) : (
                <>
                    {conditions.map((condition, index) => (
                        <ReorderRow
                            key={`condition-${condition.layoutId ?? condition.id}`}
                            shift={getConditionReorderShift(
                                index,
                                conditionDrag?.originIndex ?? null,
                                reorderPosition?.finalIndex ?? null,
                                draggedRowHeight,
                            )}
                            hide={conditionDrag?.condition.id === condition.id}
                            animateLayout={!conditionDrag}
                            layoutAnimationsSuppressed={
                                conditionLayoutAnimationsSuppressed
                            }
                            onHeight={(height) => {
                                if (rowHeights.get(condition.id) === height)
                                    return;
                                setRowHeights((current) => {
                                    const next = new Map(current);
                                    next.set(condition.id, height);
                                    return next;
                                });
                            }}
                        >
                            <InsertionSlot
                                index={index}
                                condition={condition}
                                settleImmediately
                                visible={index > 0}
                                expanded={index === 0}
                            />
                            <DraggableCondition
                                condition={condition}
                                index={index}
                                onToggleConditionNegation={
                                    onToggleConditionNegation
                                }
                                onModeChange={onModeChange}
                                onCenterChange={recordConditionCenter}
                                onPrepareDrag={refreshConditionCenters}
                                onRefChange={registerConditionRef}
                            />
                        </ReorderRow>
                    ))}
                    {pendingTag && !dragState ? (
                        <View className="mt-3 self-start">
                            <TagPlacementOutline
                                tag={pendingTag.tag}
                                onPress={placeTagInNewCondition}
                                accessibilityLabel={`Add ${pendingTag.tag.name} as a new tag group`}
                            />
                        </View>
                    ) : null}
                    {queryEndHovered && !conditionDrag && previewColor ? (
                        <NewGroupInsertionPreview
                            color={previewColor}
                            label="CREATE A NEW TAG GROUP"
                        />
                    ) : null}
                </>
            )}
        </DropSlot>
    );
}

function ReorderRow({
    children,
    shift,
    hide,
    animateLayout,
    layoutAnimationsSuppressed,
    onHeight,
}: {
    children: ReactNode;
    shift: number;
    hide: boolean;
    animateLayout: boolean;
    layoutAnimationsSuppressed: boolean;
    onHeight: (height: number) => void;
}) {
    const shiftY = useSharedValue(0);
    useEffect(() => {
        shiftY.set(
            withTiming(shift, {
                duration: REORDER_DURATION,
                easing: SOFT_EASING,
            }),
        );
    }, [shift, shiftY]);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: shiftY.get() }],
    }));
    return (
        <Animated.View
            collapsable={false}
            onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
            entering={FadeInDown.duration(200).reduceMotion(
                ReduceMotion.System,
            )}
            exiting={FadeOutUp.duration(160).reduceMotion(ReduceMotion.System)}
            layout={
                animateLayout
                    ? layoutAnimationsSuppressed
                        ? POSITION_ONLY_LAYOUT_TRANSITION
                        : CONDITION_LAYOUT_TRANSITION
                    : undefined
            }
            style={[animatedStyle, { zIndex: hide ? 2 : 0 }]}
        >
            <View style={{ opacity: hide ? 0 : 1 }}>{children}</View>
        </Animated.View>
    );
}

function DraggableCondition({
    condition,
    index,
    onToggleConditionNegation,
    onModeChange,
    onCenterChange,
    onPrepareDrag,
    onRefChange,
}: {
    condition: QueryCondition;
    index: number;
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
    return (
        <DraggablePill
            payload={dragPayload}
            dragHandle={<ConditionDragHandle condition={condition} />}
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
                    onModeChange={onModeChange}
                    onToggleConditionNegation={onToggleConditionNegation}
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
            className="h-8 w-8 items-center justify-center"
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Reorder ${label}`}
            accessibilityHint="Drag to move this condition"
        >
            <Svg
                width={17}
                height={17}
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

const SINGLE_OPTIONS = [
    { value: "include", label: "have" },
    { value: "exclude", label: "don't have" },
] as const;

export function ConditionCard({
    condition,
    onModeChange,
    onToggleConditionNegation,
    ghost = false,
}: {
    condition: QueryCondition;
    onModeChange: (id: string, mode: QueryGroupMode) => void;
    onToggleConditionNegation: (id: string) => void;
    ghost?: boolean;
}) {
    const group = condition.kind === "group" ? condition : null;
    const members =
        condition.kind === "group" ? condition.members : [condition];
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];
    const editor = useEditorActions();
    const { dragState, hoveredTargetKey } = useDrag();
    const hovered = Boolean(
        !ghost && dragState && hoveredTargetKey === `condition-${condition.id}`,
    );
    const body = (
        <View className="gap-2.5 px-3 py-2">
            <View className="flex-row items-center gap-1 pl-6">
                <View
                    className="min-w-0 flex-1"
                    pointerEvents={editor.pendingTag ? "none" : "auto"}
                >
                    {group ? (
                        <GroupModeControl
                            mode={group.mode}
                            onChange={(mode) => onModeChange(group.id, mode)}
                        />
                    ) : (
                        <View className="flex-row flex-wrap items-center gap-1">
                            <QuerySegmentedControl
                                value={
                                    condition.kind === "tag" &&
                                    condition.negated
                                        ? "exclude"
                                        : "include"
                                }
                                options={SINGLE_OPTIONS}
                                segmentWidths={[52, 82]}
                                label="Tag requirement"
                                onChange={(value) => {
                                    if (
                                        condition.kind === "tag" &&
                                        condition.negated !==
                                            (value === "exclude")
                                    )
                                        onToggleConditionNegation(condition.id);
                                }}
                            />
                            <Text className="text-sm font-bold text-foreground">
                                the tag:
                            </Text>
                        </View>
                    )}
                </View>
                <Pressable
                    className="h-7 w-7 items-center justify-center"
                    disabled={!!editor.pendingTag}
                    hitSlop={4}
                    onPress={() => editor.removeGroup(condition.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Delete tag group"
                >
                    <Ionicons
                        name="trash-outline"
                        size={17}
                        color={theme.destructive}
                    />
                </Pressable>
            </View>
            <View className="relative">
                <View
                    className={
                        editor.showVennDiagrams
                            ? "min-h-8 flex-row flex-wrap items-center gap-x-1.5 gap-y-0.5 pr-10"
                            : "min-h-8 flex-row flex-wrap items-center gap-x-1.5 gap-y-0.5"
                    }
                >
                    {members.map((queryTag, index) => (
                        <Animated.View
                            key={queryTag.id}
                            className="flex-row items-center gap-1.5"
                            entering={FadeIn.duration(160).reduceMotion(
                                ReduceMotion.System,
                            )}
                            exiting={FadeOut.duration(130).reduceMotion(
                                ReduceMotion.System,
                            )}
                        >
                            {group && index > 0 ? (
                                <Text className="text-sm font-normal text-muted-foreground">
                                    {group.mode === "all"
                                        ? "and"
                                        : group.mode === "none"
                                          ? "nor"
                                          : "or"}
                                </Text>
                            ) : null}
                            {ghost ? (
                                <QueryTagPill queryTag={queryTag} />
                            ) : (
                                <DraggableQueryTag
                                    queryTag={queryTag}
                                    conditionId={condition.id}
                                />
                            )}
                        </Animated.View>
                    ))}
                    {editor.pendingTag &&
                    !ghost &&
                    !dragState &&
                    !members.some(
                        (member) => member.tag.id === editor.pendingTag?.tag.id,
                    ) ? (
                        <TagPlacementOutline
                            tag={editor.pendingTag.tag}
                            onPress={() =>
                                editor.placeTagInCondition(condition.id)
                            }
                            accessibilityLabel={`Add ${editor.pendingTag.tag.name} to this tag group`}
                        />
                    ) : null}
                </View>
                {editor.showVennDiagrams ? (
                    <Pressable
                        className="absolute bottom-1 right-0"
                        disabled={ghost || !!dragState || !!editor.pendingTag}
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityLabel={
                            group
                                ? `Have ${group.mode} tags. Change matching mode`
                                : condition.kind === "tag" && condition.negated
                                  ? "Don't have tag. Change to have"
                                  : "Have tag. Change to don't have"
                        }
                        onPress={() => {
                            void Haptics.selectionAsync().catch(() => {});
                            if (group) {
                                onModeChange(
                                    group.id,
                                    group.mode === "all"
                                        ? "any"
                                        : group.mode === "any"
                                          ? "none"
                                          : "all",
                                );
                            } else {
                                onToggleConditionNegation(condition.id);
                            }
                        }}
                    >
                        <VennDiagram
                            single={!group}
                            mode={
                                group
                                    ? group.mode
                                    : condition.kind === "tag" &&
                                        condition.negated
                                      ? "none"
                                      : "any"
                            }
                        />
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
    return (
        <View
            className="overflow-hidden rounded-xl border"
            style={{
                borderColor: hovered ? theme.primary : theme.border,
            }}
        >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface
                    variant="regular"
                    style={StyleSheet.absoluteFill}
                />
            </View>
            {ghost ? (
                body
            ) : (
                <DropSlot
                    targetKey={`condition-${condition.id}`}
                    target={{ kind: "condition", conditionId: condition.id }}
                    priority={30}
                >
                    {body}
                </DropSlot>
            )}
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
}: {
    index: number;
    condition: QueryCondition;
    settleImmediately?: boolean;
    collapse?: boolean;
    deferReveal?: boolean;
    hidden?: boolean;
    visible?: boolean;
    expanded?: boolean;
}) {
    const { toggleOuterConnector, pendingTag } = useEditorActions();
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
              ? 4
              : 4;
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
                        className="flex-1 flex-row items-center"
                        disabled={
                            !connectorVisible || !!dragState || !!pendingTag
                        }
                        onPress={toggleOuterConnector}
                        accessibilityRole="button"
                        accessibilityLabel={
                            condition.connector === "and"
                                ? "Match any group"
                                : "Match all groups"
                        }
                    >
                        <Animated.View
                            className="flex-1 flex-row items-center"
                            style={connectorStyle}
                        >
                            <View className="h-px flex-1 bg-border" />
                            <View className="mx-2 rounded-full border border-border bg-secondary px-3 py-0.5">
                                <Text className="text-[10px] font-bold text-secondary-foreground">
                                    {condition.connector === "and"
                                        ? "AND"
                                        : "OR"}
                                </Text>
                            </View>
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
                <View className="px-3">
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
    const { removeQueryTag, editQueryTag, pendingTag } = useEditorActions();
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
            <Pressable
                disabled={!!pendingTag}
                onPress={() =>
                    queryTag.tag.type === "basic"
                        ? removeQueryTag(queryTag.id)
                        : editQueryTag(queryTag)
                }
                accessibilityRole="button"
                accessibilityLabel={`${queryTag.tag.type === "basic" ? "Remove" : "Edit"} ${queryTag.tag.name} in query`}
            >
                <QueryTagPill queryTag={queryTag} />
            </Pressable>
        </DraggablePill>
    );
}

function TagPlacementOutline({
    tag,
    onPress,
    accessibilityLabel,
}: {
    tag: QueryTag["tag"];
    onPress: () => void;
    accessibilityLabel: string;
}) {
    return (
        <Pressable
            onPress={onPress}
            onTouchEnd={(event) => event.stopPropagation()}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            className="min-h-8 self-start rounded-full border border-dashed"
            style={{ borderColor: tag.color }}
        >
            <View pointerEvents="none" style={{ opacity: 0 }}>
                <TagPill tag={tag} height={14} />
            </View>
        </Pressable>
    );
}
