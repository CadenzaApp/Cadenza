import React, { useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { PaletteItem, SlotAddress, LogicOperator } from "./types";
import { TagPill } from "@/components/custom/tag-pill";
import { DraggablePill } from "./DraggablePill";
import { OPERATOR_COLORS } from "./LogicNode";

/*
if (Platform.OS === "android") {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}
*/

// Operators to take from the palette
function OperatorTile({ operator }: { operator: LogicOperator }) {
  const { bg, border, text } = OPERATOR_COLORS[operator];
  return (
    <View style={[styles.opTile, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.opText, { color: text }]}>{operator}</Text>
    </View>
  );
}

/** A collapsible dropdown menu with items you can drag  */
export function PaletteSection({ title, items, onDrop, defaultOpen = false }: {  
  title: string,
  items: PaletteItem[],
  onDrop: (item: PaletteItem, address: SlotAddress) => void,
  defaultOpen?: boolean, 
}) {
  const [open, setOpen] = useState(defaultOpen);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  };

  return (
    <View style={styles.section}>
      <Pressable onPress={toggle} style={({ pressed }) => pressed && { opacity: 0.7 }}>
        <View style={styles.header}>
          <Text style={styles.headerText}>{title}</Text>
          <Text style={styles.chevron}>{open ? "▲" : "▼"}</Text>
        </View>
      </Pressable>

      {open && (
        <View style={styles.itemsRow}>
          {items.map((item, i) => (
            <DraggablePill key={i} item={item} onDrop={onDrop}>
              {item.kind === "logic" ? (
                <OperatorTile operator={item.operator} />
              ) : (
                <TagPill tag={item.tag} height={12} />
              )}
            </DraggablePill>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerText: {
    color: "rgba(255,255,255,0.7)",
    fontWeight: "600",
    fontSize: 13,
    letterSpacing: 0.5,
  },
  chevron: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
  },
  itemsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  opTile: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  opText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
});
