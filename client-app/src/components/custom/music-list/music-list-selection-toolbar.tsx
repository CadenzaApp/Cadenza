import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import { useState } from "react";
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

import { Button } from "@/components/ui/button";
import { ModalPopup } from "@/components/custom/modal-popup";
import { Text } from "@/components/ui/text";
import { usePlayback } from "@/lib/playback";

import { MusicListActionButton } from "./music-list-action-button";
import type {
    MusicListMultiSelectConfig,
    MusicListSelectionAction,
} from "./types";

type MusicListSelectionToolbarProps = {
    tracks: readonly MusicItem[];
    config: MusicListMultiSelectConfig;
    bottom: number;
    onClear: () => void;
    onHeightChange: (height: number) => void;
};

const SWIPE_DISMISS_DISTANCE = 80;
const SWIPE_DISMISS_VELOCITY = 700;

export function MusicListSelectionToolbar({
    tracks,
    config,
    bottom,
    onClear,
    onHeightChange,
}: MusicListSelectionToolbarProps) {
    const [moreOpen, setMoreOpen] = useState(false);
    const { colors } = useTheme();
    const { addToQueue } = usePlayback();
    const translateX = useSharedValue(0);
    const swipeStyle = useAnimatedStyle(() => {
        const offset = translateX.get();
        return {
            transform: [{ translateX: offset }],
            opacity: Math.max(0.35, 1 - Math.abs(offset) / 300),
        };
    });
    const dismissSelection = () => {
        onClear();
    };
    const swipeGesture = Gesture.Pan()
        .activeOffsetX([-16, 16])
        .failOffsetY([-12, 12])
        .onUpdate((event) => {
            translateX.set(event.translationX);
        })
        .onEnd((event) => {
            const shouldDismiss =
                Math.abs(event.translationX) >= SWIPE_DISMISS_DISTANCE ||
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
        });
    const queueAction: MusicListSelectionAction = {
        id: "add-to-queue",
        label: "Add to queue",
        icon: "list-outline",
        onPress: addToQueue,
    };
    const actions = [
        ...(config.includeAddToQueue === false ? [] : [queueAction]),
        ...(config.actions ?? []),
    ];
    const overflowActions = actions.length > 3 ? actions.slice(2) : [];
    const visibleActions =
        overflowActions.length > 0
            ? [
                  ...actions.slice(0, 2),
                  {
                      id: "more",
                      label: "More",
                      icon: "ellipsis-horizontal" as const,
                      onPress: () => setMoreOpen(true),
                  },
              ]
            : actions;

    function runAction(action: MusicListSelectionAction) {
        void Promise.resolve(action.onPress(tracks))
            .then(onClear)
            .catch((error) => {
                console.error(
                    `Music list selection action failed: ${action.id}`,
                    error,
                );
            });
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
                    className="gap-1 rounded-xl border border-border bg-popover p-2 shadow-lg shadow-black/10"
                    style={swipeStyle}
                    onLayout={handleLayout}
                >
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
                                        onPress={() => {
                                            if (
                                                overflowActions.length > 0 &&
                                                index === 2
                                            ) {
                                                setMoreOpen(true);
                                            } else {
                                                runAction(action);
                                            }
                                        }}
                                    />
                                </View>
                            ))}
                        </View>
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
                                    runAction(action);
                                }}
                            />
                        ))}
                    </ModalPopup>
                </Animated.View>
            </GestureDetector>
        </Animated.View>
    );
}
