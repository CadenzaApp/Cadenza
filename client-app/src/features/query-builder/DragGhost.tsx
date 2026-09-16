import Ionicons from "@expo/vector-icons/Ionicons";
import { Portal } from "@rn-primitives/portal";
import { Fragment, useEffect } from "react";
import { Platform, View } from "react-native";
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { FullWindowOverlay } from "react-native-screens";

import { TagPill } from "@/components/custom/tag-pill";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "nativewind";
import { useDrag } from "./DragContext";
import { QueryTagPill } from "./QueryTagPill";
import type { QueryCondition } from "./types";

const RELEASE_DURATION = 320;
const RELEASE_EASING = Easing.bezier(0.22, 0.8, 0.3, 1);
const WindowOverlay = Platform.OS === "ios" ? FullWindowOverlay : Fragment;
const noop = () => {};

export function DragGhost() {
    const {
        dragState,
        rootOffset,
        conditionRelease,
        completeConditionRelease,
    } = useDrag();
    const releaseTop = useSharedValue(0);
    const releaseStyle = useAnimatedStyle(() => ({ top: releaseTop.get() }));
    useEffect(() => {
        if (!conditionRelease) return;
        if (conditionRelease.targetCenterY == null) {
            releaseTop.set(
                conditionRelease.startCenterY - conditionRelease.height / 2,
            );
            return;
        }
        releaseTop.set(
            withTiming(
                conditionRelease.targetCenterY - conditionRelease.height / 2,
                { duration: RELEASE_DURATION, easing: RELEASE_EASING },
                (finished) => {
                    if (finished) runOnJS(completeConditionRelease)();
                },
            ),
        );
    }, [completeConditionRelease, conditionRelease, releaseTop]);

    if (conditionRelease) {
        return (
            <Portal name="query-condition-release">
                <WindowOverlay>
                    <Animated.View
                        pointerEvents="none"
                        className="absolute left-4 right-4 z-50"
                        style={[
                            { height: conditionRelease.height },
                            releaseStyle,
                            conditionRelease.targetCenterY == null
                                ? {
                                      top:
                                          conditionRelease.startCenterY -
                                          conditionRelease.height / 2,
                                  }
                                : undefined,
                        ]}
                    >
                        <ConditionGhostCard
                            condition={conditionRelease.condition}
                        />
                    </Animated.View>
                </WindowOverlay>
            </Portal>
        );
    }
    if (!dragState) return null;

    if (dragState.payload.source === "condition") return null;

    const tag =
        dragState.payload.source === "palette"
            ? dragState.payload.tag
            : dragState.payload.queryTag.tag;
    const negated =
        dragState.payload.source === "query" &&
        dragState.payload.queryTag.negated;

    return (
        <View
            pointerEvents="none"
            className="absolute z-50 flex-row items-center rounded-full bg-background p-1"
            style={{
                left: dragState.x - rootOffset.x - 45,
                top: dragState.y - rootOffset.y - 22,
                transform: [{ scale: 1.06 }],
            }}
        >
            <TagPill
                tag={tag}
                height={10}
                outlined={negated}
                strikethrough={negated}
                leadingIcon={
                    tag.type === "basic" && negated ? (
                        <Ionicons
                            name="close-circle"
                            size={10}
                            color={tag.color}
                        />
                    ) : undefined
                }
            />
        </View>
    );
}

function ConditionGhostCard({ condition }: { condition: QueryCondition }) {
    const group = condition.kind === "group" ? condition : null;
    const members =
        condition.kind === "group" ? condition.members : [condition];
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];

    return (
        <View className="overflow-hidden rounded-xl border border-border bg-background">
            <View
                className={
                    group
                        ? "px-3 pb-2.5 pt-2"
                        : "min-h-12 flex-row items-center px-3 py-1.5"
                }
            >
                {group ? (
                    <View className="self-start flex-row rounded-full bg-secondary p-0.5">
                        {(["any", "all"] as const).map((option) => {
                            const selected = group.mode === option;
                            return (
                                <View
                                    key={option}
                                    className="min-h-7 justify-center rounded-full px-3"
                                    style={
                                        selected
                                            ? {
                                                  backgroundColor:
                                                      theme.background,
                                              }
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
                                        {option === "any"
                                            ? "HAVE ANY"
                                            : "HAVE ALL"}
                                    </Text>
                                </View>
                            );
                        })}
                    </View>
                ) : null}
                <View
                    className={`flex-row flex-wrap items-center gap-2 ${group ? "mt-2" : ""}`}
                >
                    {members.map((queryTag, index) => (
                        <View
                            key={queryTag.id}
                            className="flex-row items-center gap-2"
                        >
                            {group && index > 0 ? (
                                <Text className="text-[10px] font-bold text-muted-foreground">
                                    {group.mode === "any" ? "OR" : "AND"}
                                </Text>
                            ) : null}
                            <QueryTagPill queryTag={queryTag} onToggle={noop} />
                        </View>
                    ))}
                </View>
            </View>
        </View>
    );
}
