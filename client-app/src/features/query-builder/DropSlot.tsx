import { useEffect, useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { cn } from "@/lib/utils";
import { useDragCommands, useDropHover } from "./DragContext";
import { useDropViewport } from "./DropViewport";
import { measureDropRect } from "./drag-utils";
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
    const { registerDropZone, unregisterDropZone } = useDragCommands();
    const hovered = useDropHover(targetKey);
    const viewport = useDropViewport();
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
            viewport,
            measure: () => measureDropRect(ref.current),
        });
        return () => unregisterDropZone(targetKey);
    }, [
        priority,
        viewport,
        registerDropZone,
        targetConditionId,
        targetIndex,
        targetKey,
        targetKind,
        unregisterDropZone,
    ]);

    return (
        <View
            ref={ref}
            collapsable={false}
            className={cn(className, hovered && hoveredClassName)}
            style={style}
        >
            {children}
        </View>
    );
}
