import React, { useRef } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import { useDrag } from "./DragContext";
import { cn } from "@/lib/utils";

type Props = {
    slotKey: string;
    style?: ViewStyle;
    children?: React.ReactNode;
    naked?: boolean;
};

export function DropSlot({ slotKey, style, children, naked = false }: Props) {
    const {
        dragState,
        hoveredKey,
        registerDropZone,
        unregisterDropZone,
        getNodeOperator,
    } = useDrag();
    const ref = useRef<View>(null);

    React.useEffect(() => {
        registerDropZone(
            slotKey,
            () =>
                new Promise((resolve) => {
                    ref.current?.measureInWindow((x, y, width, height) => {
                        resolve({ x, y, width, height } as DOMRect);
                    });
                }),
        );
        return () => unregisterDropZone(slotKey);
    }, [slotKey]);

    const isDisabled = (() => {
        if (!dragState || dragState.item.kind !== "logic") return false;
        if (slotKey === "root") return false;
        const colonIdx = slotKey.lastIndexOf(":");
        const parentNodeId = slotKey.slice(0, colonIdx);
        const parentOperator = getNodeOperator(parentNodeId);
        return parentOperator === dragState.item.operator;
    })();

    const isDragActive = !!dragState && !isDisabled;
    const isHovered = isDragActive && hoveredKey === slotKey;

    return (
        <View
            ref={ref}
            style={[
                naked ? styles.nakedBase : styles.slot,
                style,
                !naked && isHovered && styles.slotHovered,
            ]}
            className={cn(
                !naked && "border-input bg-card",
                !naked && isDragActive && !isHovered && "bg-card",
                !naked && isHovered && "border-input",
                naked && isHovered && "border-input",
            )}
        >
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    slot: {
        minWidth: 52,
        minHeight: 40,
        borderRadius: 8,
        borderWidth: 1.5,
        borderStyle: "dashed",
        alignItems: "center",
        justifyContent: "center",
    },

    slotHovered: {
        borderStyle: "solid",
    },

    nakedBase: {
        borderRadius: 12,
        borderWidth: 2,
        borderColor: "transparent",
        borderStyle: "solid",
    },
});
