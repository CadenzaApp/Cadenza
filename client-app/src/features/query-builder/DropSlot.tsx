import { useEffect, useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { cn } from "@/lib/utils";
import { useDrag } from "./DragContext";
import type { DropTarget } from "./types";

export function DropSlot({
    targetKey,
    target,
    priority = 10,
    className,
    hoveredClassName,
    style,
    children,
}: {
    targetKey: string;
    target: DropTarget;
    priority?: number;
    className?: string;
    hoveredClassName?: string;
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
}) {
    const ref = useRef<View>(null);
    const {
        dragState,
        hoveredTargetKey,
        registerDropZone,
        unregisterDropZone,
    } = useDrag();
    const targetKind = target.kind;
    const targetConditionId =
        target.kind === "condition" ? target.conditionId : undefined;
    const targetIndex = target.kind === "insert" ? target.index : undefined;
    useEffect(() => {
        const registeredTarget: DropTarget =
            targetKind === "condition"
                ? { kind: "condition", conditionId: targetConditionId! }
                : targetKind === "insert"
                  ? { kind: "insert", index: targetIndex! }
                  : { kind: targetKind };
        registerDropZone(targetKey, {
            target: registeredTarget,
            priority,
            measure: () =>
                new Promise((resolve) => {
                    if (!ref.current) {
                        resolve(null);
                        return;
                    }
                    ref.current.measureInWindow((x, y, width, height) =>
                        resolve({ x, y, width, height }),
                    );
                }),
        });
        return () => unregisterDropZone(targetKey);
    }, [
        priority,
        registerDropZone,
        targetConditionId,
        targetIndex,
        targetKey,
        targetKind,
        unregisterDropZone,
    ]);

    const hovered = dragState && hoveredTargetKey === targetKey;
    return (
        <View
            ref={ref}
            className={cn(className, hovered && hoveredClassName)}
            style={style}
        >
            {children}
        </View>
    );
}
