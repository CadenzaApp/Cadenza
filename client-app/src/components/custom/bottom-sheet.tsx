import { useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, useWindowDimensions, View } from "react-native";
import {
    Gesture,
    GestureDetector,
    GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { Text } from "@/components/ui/text";

const OPEN_MS = 280;
const CLOSE_MS = 220;
const EASING = Easing.out(Easing.cubic);
/** A drag down past this, or a flick, closes it. */
const DISMISS_DRAG = 120;
const DISMISS_VELOCITY = 900;

/**
 * A sheet drawn by the app, full width and flush with the bottom of the
 * screen, `heightFraction` of it tall, over a dimmed backdrop. For a short
 * list over another sheet, like a live session's Requests over the player:
 * iOS draws a native sheet shorter than the screen as an inset card with gaps
 * down the sides and along the bottom, and this has none. Closes with the X,
 * a tap on the backdrop, or a drag down on its top bar. `children` lays out
 * in the space under the title and owns its own scrolling.
 */
export function BottomSheet({
    visible,
    onClose,
    title,
    heightFraction = 0.55,
    children,
}: {
    visible: boolean;
    onClose: () => void;
    title: string;
    heightFraction?: number;
    children: ReactNode;
}) {
    const { height: screenHeight } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const sheetHeight = Math.round(screenHeight * heightFraction);
    // stays mounted while it slides away
    const [mounted, setMounted] = useState(visible);
    const offset = useSharedValue(sheetHeight);

    // set while rendering, so it is there to slide in on the same frame
    if (visible && !mounted) setMounted(true);

    useEffect(() => {
        if (visible) {
            offset.set(withTiming(0, { duration: OPEN_MS, easing: EASING }));
        } else {
            offset.set(
                withTiming(
                    sheetHeight,
                    { duration: CLOSE_MS, easing: EASING },
                    (finished) => {
                        if (finished) runOnJS(setMounted)(false);
                    },
                ),
            );
        }
    }, [offset, sheetHeight, visible]);

    const drag = Gesture.Pan()
        .activeOffsetY(8)
        .onUpdate((event) => {
            offset.set(Math.max(0, event.translationY));
        })
        .onEnd((event) => {
            if (
                event.translationY > DISMISS_DRAG ||
                event.velocityY > DISMISS_VELOCITY
            ) {
                runOnJS(onClose)();
            } else {
                offset.set(
                    withTiming(0, { duration: CLOSE_MS, easing: EASING }),
                );
            }
        });

    const sheetStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: offset.get() }],
    }));
    const backdropStyle = useAnimatedStyle(() => ({
        opacity: 1 - offset.get() / sheetHeight,
    }));

    return (
        <Modal
            visible={mounted}
            transparent
            animationType="none"
            statusBarTranslucent
            navigationBarTranslucent
            onRequestClose={onClose}
        >
            {/* a modal is its own window, so gestures need their own root */}
            <GestureHandlerRootView className="flex-1">
                <Animated.View
                    className="absolute bottom-0 left-0 right-0 top-0 bg-black/40"
                    style={backdropStyle}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Close ${title}`}
                        className="flex-1"
                        onPress={onClose}
                    />
                </Animated.View>
                <Animated.View
                    className="absolute bottom-0 left-0 right-0 overflow-hidden rounded-t-[28px] bg-card"
                    style={[{ height: sheetHeight }, sheetStyle]}
                >
                    <GestureDetector gesture={drag}>
                        <View className="px-5 pt-2">
                            <View className="h-1.5 w-10 self-center rounded-full bg-muted-foreground" />
                            <View className="h-12 justify-center">
                                <Text className="pr-10 text-lg font-semibold text-foreground">
                                    {title}
                                </Text>
                                <DialogCloseButton
                                    onPress={onClose}
                                    accessibilityLabel={`Close ${title}`}
                                />
                            </View>
                        </View>
                    </GestureDetector>
                    <View
                        className="flex-1"
                        style={{ paddingBottom: insets.bottom }}
                    >
                        {children}
                    </View>
                </Animated.View>
            </GestureHandlerRootView>
        </Modal>
    );
}
