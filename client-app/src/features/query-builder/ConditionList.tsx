import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { createContext, useContext, useEffect, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
    Easing,
    FadeIn,
    FadeOut,
    ReduceMotion,
    interpolateColor,
    useAnimatedProps,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type AnimatedRef,
    type SharedValue,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import {
    GroupModeControl,
    QuerySegmentedControl,
    VennDiagram,
} from "./GroupModeControl";
import { MeasuredReorderList, useReorderHandle } from "./MeasuredReorderList";

import { TagPill } from "@/components/custom/tag-pill";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";
import type { Tag } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDrag, useDragCommands, useDropHover } from "./DragContext";
import { DraggablePill } from "./DraggablePill";
import { DropSlot } from "./DropSlot";
import { QueryTagPill } from "./QueryTagPill";
import type {
    DragPayload,
    QueryCondition,
    QueryGroupMode,
    QueryTag,
} from "./types";

const REORDER_DURATION = 320;
const CONNECTOR_REVEAL_DURATION = 220;
const SOFT_EASING = Easing.bezier(0.22, 0.8, 0.3, 1);
const CONNECTOR_HEIGHT = 32;
const AnimatedPath = Animated.createAnimatedComponent(Path);

export const EditorActionsContext = createContext({
    showVennDiagrams: true,
    toggleOuterConnector: () => {},
    removeGroup: (_id: string) => {},
    removeQueryTag: (_id: string) => {},
    editQueryTag: (_tag: QueryTag) => {},
    pendingTag: null as { tag: Tag; suggested: boolean } | null,
    placeTagInCondition: (_id: string) => {},
    placeTagInNewCondition: () => {},
});
const useEditorActions = () => useContext(EditorActionsContext);

export function ConditionList({
    conditions,
    onToggleConditionNegation,
    onModeChange,
    scrollRef,
    scrollOffset,
    viewportTopInset,
    viewportBottomInset,
    bottomClearance,
}: {
    scrollRef: AnimatedRef<Animated.ScrollView>;
    scrollOffset: SharedValue<number>;
    viewportTopInset: number;
    viewportBottomInset: SharedValue<number>;
    bottomClearance: number;
    conditions: readonly QueryCondition[];
    onToggleConditionNegation: (conditionId: string) => void;
    onModeChange: (groupId: string, mode: QueryGroupMode) => void;
}) {
    const { beginDrag, moveDrag, finishDrag, cancelDrag } = useDragCommands();
    const { dragState } = useDrag();
    const conditionDrag =
        dragState?.payload.source === "condition" ? dragState.payload : null;
    const { pendingTag, placeTagInNewCondition } = useEditorActions();
    const endHovered = useDropHover("query-end");
    const workspaceHovered = useDropHover("workspace-end");
    const queryEndHovered = endHovered || workspaceHovered;
    const previewColor = dragState ? dragTagColor(dragState.payload) : null;
    const payloadFor = (
        condition: QueryCondition,
    ): Extract<DragPayload, { source: "condition" }> => ({
        source: "condition",
        condition,
    });
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
                    <View className="-mt-7">
                        <MeasuredReorderList
                            data={conditions}
                            keyFor={(condition) =>
                                condition.layoutId ?? condition.id
                            }
                            scrollRef={scrollRef}
                            scrollOffset={scrollOffset}
                            viewportTopInset={viewportTopInset}
                            viewportBottomInset={viewportBottomInset}
                            bottomClearance={bottomClearance}
                            onStart={(condition, index, x, y) => {
                                void Haptics.impactAsync(
                                    Haptics.ImpactFeedbackStyle.Light,
                                ).catch(() => {});
                                void beginDrag(payloadFor(condition), x, y);
                            }}
                            onMove={moveDrag}
                            onDrop={(condition, from, to, x, y) =>
                                finishDrag(
                                    payloadFor(condition),
                                    x,
                                    y,
                                    to > from ? to + 1 : to,
                                )
                            }
                            onCancel={cancelDrag}
                            renderItem={(condition, index) => (
                                <>
                                    <InsertionSlot
                                        index={index}
                                        condition={condition}
                                        visible={index > 0}
                                    />
                                    <DraggableCondition
                                        condition={condition}
                                        onToggleConditionNegation={
                                            onToggleConditionNegation
                                        }
                                        onModeChange={onModeChange}
                                    />
                                </>
                            )}
                        />
                    </View>
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

function DraggableCondition({
    condition,
    onToggleConditionNegation,
    onModeChange,
}: {
    condition: QueryCondition;
    onToggleConditionNegation: (id: string) => void;
    onModeChange: (id: string, mode: QueryGroupMode) => void;
}) {
    const gesture = useReorderHandle();
    return (
        <View>
            <ConditionCard
                condition={condition}
                onModeChange={onModeChange}
                onToggleConditionNegation={onToggleConditionNegation}
            />
            {gesture ? (
                <GestureDetector gesture={gesture}>
                    <View className="absolute left-0 top-2 z-10">
                        <ConditionDragHandle condition={condition} />
                    </View>
                </GestureDetector>
            ) : null}
        </View>
    );
}

function ConditionDragHandle({ condition }: { condition: QueryCondition }) {
    const { colors: theme } = useAppTheme();
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

function ConditionCard({
    condition,
    onModeChange,
    onToggleConditionNegation,
}: {
    condition: QueryCondition;
    onModeChange: (id: string, mode: QueryGroupMode) => void;
    onToggleConditionNegation: (id: string) => void;
}) {
    const group = condition.kind === "group" ? condition : null;
    const members =
        condition.kind === "group" ? condition.members : [condition];
    const { colors: theme } = useAppTheme();
    const editor = useEditorActions();
    const { dragState } = useDrag();
    const hovered = useDropHover(`condition-${condition.id}`);
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
                            <DraggableQueryTag
                                queryTag={queryTag}
                                conditionId={condition.id}
                            />
                        </Animated.View>
                    ))}
                    {editor.pendingTag &&
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
                        disabled={!!dragState || !!editor.pendingTag}
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
                    style={[
                        StyleSheet.absoluteFill,
                        { borderRadius: 11, overflow: "hidden" },
                    ]}
                />
            </View>
            <DropSlot
                targetKey={`condition-${condition.id}`}
                target={{ kind: "condition", conditionId: condition.id }}
                priority={30}
            >
                {body}
            </DropSlot>
        </View>
    );
}

function InsertionSlot({
    index,
    condition,
    visible = true,
}: {
    index: number;
    condition: QueryCondition;
    visible?: boolean;
}) {
    const { toggleOuterConnector, pendingTag } = useEditorActions();
    const { dragState } = useDrag();
    const hovered = useDropHover(`insert-${index}`);
    const conditionDrag =
        dragState?.payload.source === "condition" ? dragState.payload : null;
    const previewVisible = Boolean(hovered && !conditionDrag);
    const previewColor = dragState ? dragTagColor(dragState.payload) : null;
    const previewLabel = "CREATE A NEW TAG GROUP";
    const connectorVisible = visible && !previewVisible;
    const connectorProgress = useSharedValue(connectorVisible ? 1 : 0);
    useEffect(() => {
        connectorProgress.set(
            withTiming(connectorVisible ? 1 : 0, {
                duration: CONNECTOR_REVEAL_DURATION,
                easing: SOFT_EASING,
            }),
        );
    }, [connectorProgress, connectorVisible]);
    const connectorStyle = useAnimatedStyle(() => ({
        opacity: connectorProgress.get(),
        transform: [{ scaleX: connectorProgress.get() }],
    }));
    return (
        // A fixed slot travels with each card. Only its contents animate;
        // hiding the first connector never changes the measured row height.
        <View
            className="relative shrink-0"
            style={{ height: CONNECTOR_HEIGHT }}
        >
            <DropSlot
                targetKey={`insert-${index}`}
                target={{ kind: "insert", index }}
                priority={20}
                className="absolute inset-0 justify-center"
            >
                {previewVisible && previewColor ? (
                    <NewGroupInsertionPreview
                        color={previewColor}
                        label={previewLabel}
                    />
                ) : (
                    <Pressable
                        className="h-full w-full justify-center"
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
                            className="w-full flex-row items-center"
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
        </View>
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
                className="py-[4px]"
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
