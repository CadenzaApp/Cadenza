import { useEffect } from "react";
import Animated, {
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useDrag } from "./DragContext";
import { PaletteTagPill, QueryTagPill } from "./QueryTagPill";

export function DragGhost() {
    const { dragState, dragX, dragY, rootOffset, grabOffset } = useDrag();
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
    const tagPositionStyle = useAnimatedStyle(() => ({
        left: dragX.get() - rootOffset.x - grabOffset.x,
        top: dragY.get() - rootOffset.y - grabOffset.y,
    }));
    if (!dragState) return null;
    if (dragState.payload.source === "condition") return null;

    return (
        <Animated.View
            pointerEvents="none"
            className="absolute z-50 flex-row items-center"
            style={tagPositionStyle}
        >
            <Animated.View
                style={pickupStyle}
                className={
                    dragState.payload.source === "palette"
                        ? "px-1 py-1"
                        : "py-1"
                }
            >
                {dragState.payload.source === "query" ? (
                    <QueryTagPill
                        queryTag={dragState.payload.queryTag}
                        height={14}
                    />
                ) : (
                    <PaletteTagPill
                        tag={dragState.payload.tag}
                        suggested={dragState.payload.suggested}
                    />
                )}
            </Animated.View>
        </Animated.View>
    );
}
