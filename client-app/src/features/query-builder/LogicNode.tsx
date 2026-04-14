import React, { useEffect } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { QueryNode, PaletteItem, SlotAddress } from "./types";
import { TagPill } from "@/components/custom/tag-pill";
import { DropSlot } from "./DropSlot";
import { useDrag } from "./DragContext";


export const OPERATOR_COLORS = {
  AND: { bg: "#1a3c61", border: "#2E6EAD", text: "#5BB8FF" },
  OR:  { bg: "#39215e", border: "#6E3AAD", text: "#a96ef1" },
  NOT: { bg: "#491717", border: "#c44242", text: "#f78282" },
} as const;

/**
 * A single slot within a LogicNodeBox.
 * Can be empty, or filled with tag/nested logic box
 *
 * Empty looks like a dashed DropSlot showing "drop"
 * 
 * @param node     - The current occupant of this slot, or null if empty.
 * @param slotKey  - Passed through to DropSlot for hit testing and highlight.
 * @param onDrop   - Forwarded to nested LogicNodeBox if the slot holds one.
 * @param onRemove - Called with the occupant's id when its x is tapped.
 */
function SlotCell({
  node,
  slotKey,
  onDrop,
  onRemove,
}: {
  node: QueryNode | null;
  slotKey: string;
  onDrop: (item: PaletteItem, address: SlotAddress) => void;
  onRemove: (id: string) => void;
}) {
  // empty
  if (!node) {
    return (
      <DropSlot slotKey={slotKey}>
        <Text style={styles.emptySlotText}>Drop</Text>
      </DropSlot>
    );
  }

  // tag
  if (node.kind === "tag") {
    return (
      <DropSlot slotKey={slotKey} style={styles.filledSlot}>
        <TagPill tag={node.tag} height={12} onRemove={() => onRemove(node.id)} />
      </DropSlot>
    );
  }

  // logic node
  return (
    <DropSlot slotKey={`${node.id}:append`} naked>
      <LogicNodeBox node={node} onDrop={onDrop} onRemove={onRemove} />
    </DropSlot>
  );
}

/**
 * Renders a recursive AND / OR / NOT logic box
 *
 * @param node     - The logic node to render. Must be kind "logic".
 * @param onDrop   - Called when a palette item is dropped onto a child slot.
 * @param onRemove - Called with a node id when the x button is tapped.
 * @param style    - Optional style overrides for the outer box, used by
 *                   QueryBuilder to set alignSelf on the root node.
 */
export function LogicNodeBox({ node, onDrop, onRemove, style }: {
  node: Extract<QueryNode, { kind: "logic" }>,
  onDrop: (item: PaletteItem, address: SlotAddress) => void,
  onRemove: (id: string) => void,
  style?: ViewStyle, 
}) {
  const { registerNodeOperator, unregisterNodeOperator } = useDrag();
  const { bg, border, text } = OPERATOR_COLORS[node.operator];
  const { id, operator, children } = node;

  // Register this node's operator so DropSlot can detect redundant drops
  useEffect(() => {
    registerNodeOperator(id, operator);
    return () => unregisterNodeOperator(id);
  }, [id, operator]);

  /** x button shared by all three operator boxes */
  const removeButton = (
    <View style={styles.logicRemoveBtn}>
      <Pressable
        onPress={() => onRemove(id)}
        hitSlop={8}
        style={({ pressed }) => pressed && { opacity: 0.4 }}
      >
        <Text style={styles.logicRemoveText}>x</Text>
      </Pressable>
    </View>
  );

  // NOT
  if (operator === "NOT") {
    return (
      <View style={[styles.boxRow, { backgroundColor: bg, borderColor: border }, style]}>
        {removeButton}
        <Text style={[styles.label, { color: text }]}>NOT</Text>
        <SlotCell
          node={children[0] ?? null}
          slotKey={`${id}:0`}
          onDrop={onDrop}
          onRemove={onRemove}
        />
      </View>
    );
  }

  // AND
  if (operator === "AND") {
    return (
      <View style={[styles.boxCol, { backgroundColor: bg, borderColor: border }, style]}>
        {removeButton}
        {children.map((child, i) => (
          <React.Fragment key={i}>
            <SlotCell
              node={child}
              slotKey={`${id}:${i}`}
              onDrop={onDrop}
              onRemove={onRemove}
            />
            {/* Label between slots only, not after the last one */}
            {i < children.length - 1 && (
              <Text style={[styles.label, { color: text }]}>AND</Text>
            )}
          </React.Fragment>
        ))}
      </View>
    );
  }

  // OR
  return (
    <View style={[styles.boxRow, { backgroundColor: bg, borderColor: border }, style]}>
      {removeButton}
      {children.map((child, i) => (
        <React.Fragment key={i}>
          <SlotCell
            node={child}
            slotKey={`${id}:${i}`}
            onDrop={onDrop}
            onRemove={onRemove}
          />
          {/* Label between slots only, not after the last one */}
          {i < children.length - 1 && (
            <Text style={[styles.label, { color: text }]}>OR</Text>
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  boxCol: {
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 6,
    alignSelf: "flex-start",
  },
  boxRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 6,
    alignSelf: "flex-start",
    flexWrap: "wrap",
  },
  logicRemoveBtn: {
    position: "absolute",
    top: 3,
    right: 6,
    zIndex: 10,
  },
  logicRemoveText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 15,
    lineHeight: 15,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginHorizontal: 2,
  },
  emptySlotText: {
    fontSize: 10,
    color: "rgba(255,255,255,0.25)",
    letterSpacing: 1,
  },
  filledSlot: {
    borderWidth: 0,
    backgroundColor: "transparent",
    minWidth: 0,
    minHeight: 0,
    padding: 2,
  },
  tagSlotContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  removeText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    lineHeight: 14,
  },
});