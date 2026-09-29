import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useTheme } from "expo-router/react-navigation";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    Easing,
    FadeInDown,
    FadeOutDown,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from "react-native-reanimated";

import { ModalPopup } from "@/components/custom/modal-popup";
import {
    BulkTagSelectorPopup,
    type BulkTagMode,
} from "@/components/custom/tag-selector/bulk-popup";
import { Button } from "@/components/ui/button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { usePlaybackCommands } from "@/lib/playback";
import { classifyError } from "@/lib/app-error";
import type { AppliedTag, Tag, TagMetadata } from "@/lib/types";

import { MusicListActionButton } from "./music-list-action-button";
import type {
    MusicListMultiSelectConfig,
    MusicListSelectionAction,
    MusicListSelectionActionDefinition,
} from "./types";

type MusicListSelectionToolbarProps = {
    tracks: readonly MusicItem[];
    config: MusicListMultiSelectConfig;
    bottom: number;
    onClear: () => void;
    onHeightChange: (height: number) => void;
    userTags: readonly Tag[];
    userTagsMeta?: Readonly<Record<number, TagMetadata>>;
    tagsBySong: Readonly<Record<string, AppliedTag[]>>;
    defaultTagsBySong: Readonly<Record<string, Tag[]>>;
    tagsLoading: boolean;
};

const SWIPE_DISMISS_DISTANCE = 80;
const SWIPE_DISMISS_VELOCITY = 700;
const DEFAULT_ACTIONS: readonly MusicListSelectionActionDefinition[] = [
    { kind: "apply-tags" },
    { kind: "remove-tags" },
    { kind: "add-to-queue" },
];

type ResolvedSelectionAction = MusicListSelectionAction & {
    tagAction?: {
        mode: BulkTagMode;
        excludedTagIds?: readonly number[];
    };
};

export function MusicListSelectionToolbar({
    tracks,
    config,
    bottom,
    onClear,
    onHeightChange,
    userTags,
    userTagsMeta,
    tagsBySong,
    defaultTagsBySong,
    tagsLoading,
}: MusicListSelectionToolbarProps) {
    const [moreOpen, setMoreOpen] = useState(false);
    const [tagAction, setTagAction] = useState<
        ResolvedSelectionAction["tagAction"] | null
    >(null);
    const [pendingActionId, setPendingActionId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const { colors } = useTheme();
    const { addToQueue } = usePlaybackCommands();
    const translateX = useSharedValue(0);
    const swipeStyle = useAnimatedStyle(() => {
        const offset = translateX.get();
        return {
            transform: [{ translateX: offset }],
            opacity: Math.max(0.35, 1 - Math.abs(offset) / 300),
        };
    });
    const dismissSelection = useCallback(() => onClear(), [onClear]);
    const swipeGesture = useMemo(
        () =>
            Gesture.Pan()
                .activeOffsetX([-16, 16])
                .failOffsetY([-12, 12])
                .onUpdate((event) => {
                    translateX.set(event.translationX);
                })
                .onEnd((event) => {
                    const shouldDismiss =
                        Math.abs(event.translationX) >=
                            SWIPE_DISMISS_DISTANCE ||
                        Math.abs(event.velocityX) >= SWIPE_DISMISS_VELOCITY;
                    if (shouldDismiss) {
                        const direction =
                            event.translationX === 0
                                ? Math.sign(event.velocityX)
                                : Math.sign(event.translationX);
                        translateX.set(
                            withTiming(direction * 500, { duration: 140 }, () =>
                                runOnJS(dismissSelection)(),
                            ),
                        );
                    } else {
                        translateX.set(
                            withSpring(0, {
                                damping: 18,
                                stiffness: 220,
                            }),
                        );
                    }
                }),
        [dismissSelection, translateX],
    );
    const actions = useMemo<ResolvedSelectionAction[]>(
        () =>
            (config.actions ?? DEFAULT_ACTIONS).map((definition) => {
                switch (definition.kind) {
                    case "add-to-queue":
                        return {
                            id: "music-list:add-to-queue",
                            label: definition.label ?? "Add to queue",
                            icon: "list-outline",
                            onPress: addToQueue,
                        };
                    case "apply-tags":
                        return {
                            id: "music-list:apply-tags",
                            label: definition.label ?? "Apply tags",
                            icon: "pricetags",
                            onPress: () => undefined,
                            tagAction: {
                                mode: "apply",
                                excludedTagIds: definition.excludedTagIds,
                            },
                        };
                    case "remove-tags":
                        return {
                            id: "music-list:remove-tags",
                            label: definition.label ?? "Remove tags",
                            icon: "pricetags-outline",
                            onPress: () => undefined,
                            tagAction: { mode: "remove" },
                        };
                    case "custom":
                        return definition.action;
                }
            }),
        [addToQueue, config.actions],
    );
    const overflowActions = actions.length > 3 ? actions.slice(2) : [];
    const visibleActions =
        overflowActions.length > 0
            ? [
                  ...actions.slice(0, 2),
                  {
                      id: "music-list:more",
                      label: "More",
                      icon: "ellipsis-horizontal" as const,
                      onPress: () => setMoreOpen(true),
                  },
              ]
            : actions;

    function runAction(action: ResolvedSelectionAction) {
        if (pendingActionId) return;
        setActionError(null);
        setPendingActionId(action.id);
        void Promise.resolve(action.onPress(tracks))
            .then(() => {
                setPendingActionId(null);
                onClear();
            })
            .catch((error) => {
                setPendingActionId(null);
                console.error(
                    `Music list selection action failed: ${action.id}`,
                    error,
                );
                setActionError(classifyError(error).detail);
            });
    }

    function handleAction(action: ResolvedSelectionAction) {
        if (action.tagAction) {
            setMoreOpen(false);
            setTagAction(action.tagAction);
            return;
        }
        runAction(action);
    }

    function handleLayout(event: LayoutChangeEvent) {
        onHeightChange(event.nativeEvent.layout.height);
    }

    return (
        <Animated.View
            className="absolute left-4 right-4 z-20"
            style={{ bottom }}
            entering={FadeInDown.duration(220).easing(Easing.out(Easing.cubic))}
            exiting={FadeOutDown.duration(160).easing(Easing.in(Easing.cubic))}
        >
            <GestureDetector gesture={swipeGesture}>
                <Animated.View
                    className="gap-1 overflow-hidden rounded-xl border border-border p-2 shadow-lg shadow-black/10"
                    style={swipeStyle}
                    onLayout={handleLayout}
                >
                    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                        <GlassSurface style={StyleSheet.absoluteFill} />
                    </View>
                    <View className="relative min-h-7 justify-center">
                        <Text className="px-8 text-center text-sm font-bold text-popover-foreground">
                            {tracks.length} selected
                        </Text>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="absolute right-0 h-7 w-7 rounded-full"
                            onPress={onClear}
                            accessibilityLabel="Clear track selection"
                        >
                            <Ionicons
                                name="close"
                                size={18}
                                color={colors.text}
                            />
                        </Button>
                    </View>
                    {actions.length ? (
                        <View className="flex-row items-stretch">
                            {visibleActions.map((action, index) => (
                                <View
                                    key={action.id}
                                    className="min-w-0 flex-1 flex-row items-stretch"
                                >
                                    {index > 0 ? (
                                        <View
                                            className="my-1 bg-border"
                                            style={{
                                                width: StyleSheet.hairlineWidth,
                                            }}
                                        />
                                    ) : null}
                                    <MusicListActionButton
                                        action={action}
                                        target={tracks}
                                        toolbar
                                        busy={pendingActionId === action.id}
                                        disabled={pendingActionId != null}
                                        onPress={() => {
                                            if (
                                                overflowActions.length > 0 &&
                                                index === 2
                                            ) {
                                                setMoreOpen(true);
                                            } else {
                                                handleAction(action);
                                            }
                                        }}
                                    />
                                </View>
                            ))}
                        </View>
                    ) : null}
                    {actionError ? (
                        <Text className="px-2 pb-1 text-sm text-destructive">
                            {actionError}
                        </Text>
                    ) : null}

                    <ModalPopup
                        visible={moreOpen}
                        onClose={() => setMoreOpen(false)}
                        title="More actions"
                    >
                        {overflowActions.map((action) => (
                            <MusicListActionButton
                                key={action.id}
                                action={action}
                                target={tracks}
                                onPress={() => {
                                    setMoreOpen(false);
                                    handleAction(action);
                                }}
                                busy={pendingActionId === action.id}
                                disabled={pendingActionId != null}
                            />
                        ))}
                    </ModalPopup>

                    {tagAction ? (
                        <BulkTagSelectorPopup
                            mode={tagAction.mode}
                            tracks={tracks}
                            userTags={userTags}
                            userTagsMeta={userTagsMeta}
                            tagsBySong={tagsBySong}
                            defaultTagsBySong={defaultTagsBySong}
                            loading={tagsLoading}
                            excludedTagIds={tagAction.excludedTagIds}
                            onCancel={() => setTagAction(null)}
                            onComplete={() => {
                                setTagAction(null);
                                onClear();
                            }}
                        />
                    ) : null}
                </Animated.View>
            </GestureDetector>
        </Animated.View>
    );
}
