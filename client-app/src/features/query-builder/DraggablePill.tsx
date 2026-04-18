import React, { useCallback } from "react";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    runOnJS, // see note above Gesture.Pan()
    withSpring,
} from "react-native-reanimated";
import { PaletteItem, SlotAddress } from "./types";
import { useDrag } from "./DragContext";

/**
 * Wraps a palette item in a pan gesture, making it draggable onto drop slots.
 *
 * @param item     - The palette item being dragged (tag or logic operator).
 * @param onDrop   - Called with the item and resolved address when dropped on a valid slot.
 * @param children - The visual element to render and hide during dragging.
 */
export function DraggablePill({
    item,
    onDrop,
    children,
}: {
    item: PaletteItem;
    onDrop: (item: PaletteItem, address: SlotAddress) => void;
    children: React.ReactNode;
}) {
    const { setDragState, setHoveredKey, cacheAllRects, findZoneAt } =
        useDrag();

    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const isDragging = useSharedValue(false);
    const scale = useSharedValue(1);
    const opacity = useSharedValue(1);

    const startAbsX = useSharedValue(0);
    const startAbsY = useSharedValue(0);

    // Called from onStart, kick off async rect caching and show the ghost
    const beginDrag = useCallback(
        async (x: number, y: number) => {
            setDragState({ item, x, y });
            await cacheAllRects();
            setHoveredKey(findZoneAt(x, y));
        },
        [item, setDragState, setHoveredKey, cacheAllRects, findZoneAt],
    );

    // Called from onChange, sync hover update using cached rects
    const moveDrag = useCallback(
        (x: number, y: number) => {
            setDragState({ item, x, y });
            setHoveredKey(findZoneAt(x, y));
        },
        [item, setDragState, setHoveredKey, findZoneAt],
    );

    // Called from onEnd, resolve drop target and deliver the item.
    const endDrag = useCallback(
        (x: number, y: number) => {
            const key = findZoneAt(x, y);
            if (key) {
                let address: SlotAddress;
                if (key === "root") {
                    address = { nodeId: "root" };
                } else {
                    const colonIdx = key.lastIndexOf(":");
                    const nodeId = key.slice(0, colonIdx);
                    const indexStr = key.slice(colonIdx + 1);
                    address =
                        indexStr === "append"
                            ? { nodeId, index: "append" }
                            : { nodeId, index: parseInt(indexStr, 10) };
                }
                onDrop(item, address);
            }
        },
        [item, onDrop, findZoneAt],
    );

    // Called from onFinalize, always clean up drag state.
    const cancelDrag = useCallback(() => {
        setDragState(null);
        setHoveredKey(null);
    }, [setDragState, setHoveredKey]);

    /*  Lifecycle:
     *  onBegin:    finger touches down. record starting position only
     *  onStart:    gesture activates (finger moved past threshold). hide the original item and spawn the ghost
     *  onChange:   update ghost position and hover highlight
     *  onEnd:      gesture finished while active so perform the drop
     *  onFinalize: always fires. restore visual state and clear drag context */

    // Gesture, somewhat boilerplate. Note runOnJS is deprecated and is essentially the same as
    // scheduleOnRN which it recommends, can't get that version to work though...

    const pan = Gesture.Pan()
        .onBegin((e) => {
            "worklet";
            // Record start position; don't touch opacity or drag state yet.
            // For a tap, this is the only handler that fires — the item must
            // remain visible, so we do nothing visual here.
            startAbsX.value = e.absoluteX;
            startAbsY.value = e.absoluteY;
        })
        .onStart(() => {
            "worklet";
            // Gesture activated (finger moved past threshold) mean this is a real drag.
            isDragging.value = true;
            // Hide the original so only the floating DragGhost is visible.
            opacity.value = 0;
            runOnJS(beginDrag)(startAbsX.value, startAbsY.value);
        })
        .onChange((e) => {
            "worklet";
            if (!isDragging.value) return;

            translateX.value = e.translationX;
            translateY.value = e.translationY;

            runOnJS(moveDrag)(
                startAbsX.value + e.translationX,
                startAbsY.value + e.translationY,
            );
        })
        .onEnd((e) => {
            "worklet";
            // Gesture finished while active — resolve and deliver the drop.
            runOnJS(endDrag)(
                startAbsX.value + e.translationX,
                startAbsY.value + e.translationY,
            );
        })
        .onFinalize(() => {
            "worklet";
            // Always fires — restore visual state and clear drag context whether
            // this was a completed drag, a cancelled drag, or a simple tap.
            isDragging.value = false;
            translateX.value = withSpring(0);
            translateY.value = withSpring(0);
            scale.value = withSpring(1);
            opacity.value = withSpring(1);
            runOnJS(cancelDrag)();
        });

    const animStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value },
        ],
    }));

    return (
        <GestureDetector gesture={pan}>
            <Animated.View style={[styles.wrapper, animStyle]}>
                {children}
            </Animated.View>
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        alignSelf: "flex-start",
    },
});
