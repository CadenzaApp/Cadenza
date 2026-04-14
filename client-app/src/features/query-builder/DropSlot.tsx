import React, { useRef } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import { useDrag } from "./DragContext";

type Props = {
  slotKey: string;
  style?: ViewStyle;
  children?: React.ReactNode;
  naked?: boolean;
};


/**
 * A drop target that highlights when a dragged item hovers over it.
 *
 * @param slotKey - Unique identifier for this slot. Format is either "root",
 *                  "{nodeId}:{index}" for a specific child slot, or
 *                  "{nodeId}:append" for the box-level drop target.
 * @param naked   - If true, renders as an invisible wrapper around a LogicNodeBox
 *                  rather than a visible dashed slot. Shows a glow ring on hover
 *                  instead of the standard slot highlight.
 * @param style   - Optional style overrides applied before hover states, so
 *                  hover styles always win.
 */
export function DropSlot({ slotKey, style, children, naked = false }: Props) {
  // open drag context
  const { dragState, hoveredKey, registerDropZone, unregisterDropZone, getNodeOperator } = useDrag();
  const ref = useRef<View>(null);

  // create the drop area (DOMRECT), make it known globally 
  React.useEffect(() => {
    registerDropZone(slotKey, () =>
      new Promise((resolve) => {
        ref.current?.measureInWindow((x, y, width, height) => {
          resolve({ x, y, width, height } as DOMRect);
        });
      })
    );
    return () => unregisterDropZone(slotKey);
  }, [slotKey]);

  // Redundancy check, make sure you can't drag a logic operator on itself
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
        !naked && isDragActive && !isHovered && styles.slotDimmed,
        !naked && isHovered && styles.slotHovered,
        naked && isHovered && styles.nakedHovered,
      ]}
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
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  slotDimmed: {
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  slotHovered: {
    borderStyle: "solid",
    borderColor: "#5BB8FF",
    backgroundColor: "rgba(91,184,255,0.18)",
  },
  nakedBase: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "transparent",
    borderStyle: "solid",
  },
  nakedHovered: {
    borderColor: "#5BB8FF",
    backgroundColor: "rgba(91,184,255,0.10)",
  },
});
