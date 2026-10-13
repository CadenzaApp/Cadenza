import { Portal } from "@rn-primitives/portal";
import { Fragment, useEffect } from "react";
import { Platform, View } from "react-native";
import Animated, {
    useReducedMotion,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { FullWindowOverlay } from "react-native-screens";

import { TagPill } from "@/components/custom/tag-pill";
import { ConditionCard, ConditionDragHandle } from "./ConditionList";
import { DragContext, useDrag } from "./DragContext";
import { EditorActionsContext, useEditorActions } from "./EditorActions";
import { QueryTagPill } from "./QueryTagPill";
import type { QueryCondition } from "./types";

const WindowOverlay = Platform.OS === "ios" ? FullWindowOverlay : Fragment;

export function DragGhost() {
    const drag = useDrag();
    const editor = useEditorActions();
    const { dragState, dragX, dragY, rootOffset } = drag;
    const reducedMotion = useReducedMotion();
    const pickup = useSharedValue(0);
    const tagDragId =
        dragState && dragState.payload.source !== "condition" ? true : null;
    useEffect(() => {
        pickup.set(0);
        if (tagDragId !== null)
            pickup.set(withTiming(1, { duration: reducedMotion ? 0 : 140 }));
    }, [tagDragId, pickup, reducedMotion]);
    const pickupStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: 1 + pickup.get() * (reducedMotion ? 0 : 0.06) },
            { translateY: -pickup.get() * (reducedMotion ? 0 : 6) },
        ],
    }));
    const conditionDrag =
        dragState?.payload.source === "condition" ? dragState.payload : null;
    const condition = conditionDrag?.condition;
    const conditionHeight = conditionDrag?.height ?? 0;
    const conditionPositionStyle = useAnimatedStyle(() => ({
        top: dragY.get() - conditionHeight / 2,
    }));
    const tagPositionStyle = useAnimatedStyle(() => ({
        left: dragX.get() - rootOffset.x - 45,
        top: dragY.get() - rootOffset.y - 22,
    }));
    if (condition) {
        return (
            <Portal name="query-condition-drag">
                <DragContext.Provider value={drag}>
                    <EditorActionsContext.Provider value={editor}>
                        <WindowOverlay>
                            <Animated.View
                                pointerEvents="none"
                                accessibilityElementsHidden
                                importantForAccessibility="no-hide-descendants"
                                className="absolute right-[18px] left-[18px] z-50"
                                style={[
                                    { height: conditionHeight },
                                    conditionPositionStyle,
                                ]}
                            >
                                <ConditionGhostCard condition={condition} />
                            </Animated.View>
                        </WindowOverlay>
                    </EditorActionsContext.Provider>
                </DragContext.Provider>
            </Portal>
        );
    }
    if (!dragState) return null;
    if (dragState.payload.source === "condition") return null;

    const tag =
        dragState.payload.source === "palette"
            ? dragState.payload.tag
            : dragState.payload.queryTag.tag;
    return (
        <Animated.View
            pointerEvents="none"
            className="absolute z-50 flex-row items-center"
            style={tagPositionStyle}
        >
            <Animated.View style={pickupStyle}>
                {dragState.payload.source === "query" ? (
                    <QueryTagPill
                        queryTag={dragState.payload.queryTag}
                        height={14}
                    />
                ) : (
                    // A suggested tag looks the same in flight as it does in the
                    // palette it left and the query it is heading for.
                    <TagPill
                        tag={tag}
                        height={14}
                        suggested={dragState.payload.suggested}
                        leadingIconName={
                            dragState.payload.suggested ? "sparkles" : undefined
                        }
                    />
                )}
            </Animated.View>
        </Animated.View>
    );
}

function ConditionGhostCard({ condition }: { condition: QueryCondition }) {
    return (
        <View>
            <ConditionCard
                condition={condition}
                onModeChange={() => {}}
                onToggleConditionNegation={() => {}}
                ghost
            />
            <View className="absolute left-0 top-2">
                <ConditionDragHandle condition={condition} />
            </View>
        </View>
    );
}
