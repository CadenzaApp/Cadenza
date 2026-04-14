import React, { useCallback, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { QueryNode, PaletteItem, SlotAddress } from "./types";
import { Tag } from "@/types/tag-types"
import { TagPill } from "@/components/custom/tag-pill";
import { insertAtSlot, removeNode, findNodeById } from "./QueryUtils";
import { DragProvider } from "./DragContext";
import { DragGhost } from "./DragGhost";
import { PaletteSection } from "./PaletteSection";
import { LogicNodeBox } from "./LogicNode";
import { DropSlot } from "./DropSlot";

const LOGIC_ITEMS: PaletteItem[] = [
  { kind: "logic", operator: "AND" },
  { kind: "logic", operator: "OR" },
  { kind: "logic", operator: "NOT" },
];




/**
 * Drag-and-drop query builder
 *
 * Maintains the query tree as a single piece of state.
 *
 * The tree is immutable. Every drop and removal produces a new tree via
 * QueryUtils, which React uses to re-render the workspace.
 *
 * @param tags      - The available tags to display in the palette.
 * @param onChange  - Called with the new query tree root after every change,
 *                    or null if the workspace is cleared. Use this to read
 *                    the current query for filtering or persistence.
 */

export function QueryBuilder({ tags, onChange }: {  
  tags: Tag[],
  onChange?: (root: QueryNode | null) => void,
}) {
  const [root, setRoot] = useState<QueryNode | null>(null);

  const tagPaletteItems: PaletteItem[] = tags.map((t) => ({ kind: "tag", tag: t }));

  const handleDrop = useCallback(
    (item: PaletteItem, address: SlotAddress) => {
      setRoot((prev) => {
        // prevent redundant drops (same operator on itself)
        if(item.kind === "logic" && address.nodeId !== "root") {
          const targetNode = findNodeById(prev, address.nodeId);
          if(targetNode?.kind === "logic" && targetNode.operator === item.operator) {
            return prev;
          }
        }
        const next = insertAtSlot(prev, address, item);
        onChange?.(next);
        return next;
      });
    },
    [onChange]
  );

  const handleRemove = useCallback(
    (id: string) => {
      setRoot((prev) => {
        const next = removeNode(prev, id);
        onChange?.(next);
        return next;
      });
    },
    [onChange]
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <DragProvider>
        <View style={styles.container}>
          {/* Palette */}
          <View style={styles.palette}>
            <PaletteSection
              title="Tags"
              items={tagPaletteItems}
              onDrop={handleDrop}
            />
            <PaletteSection
              title="Logic"
              items={LOGIC_ITEMS}
              onDrop={handleDrop}
              defaultOpen
            />
          </View>

          {/* Workspace */}
          <ScrollView
            style={styles.workspace}
            contentContainerStyle={styles.workspaceContent}
          >
              {root === null ? (
                <DropSlot slotKey="root" style={styles.rootSlot}>
                  <Text style={styles.workspaceHint}>
                    Drag a tag or logic operator here
                  </Text>
                </DropSlot>
              ) : root.kind === "tag" ? (
                // Root is a tag
                <DropSlot slotKey="root" style={styles.rootSlotFilled}>
                  <TagPill tag={root.tag} height={15} onRemove={() => handleRemove(root.id)} />
                </DropSlot>
              ) : (
                // Root is a logic node 
                <DropSlot slotKey={`${root.id}:append`} naked>
                  <LogicNodeBox
                    node={root}
                    onDrop={handleDrop}
                    onRemove={handleRemove}
                  />
                </DropSlot>
              )}
          </ScrollView>

        </View>

        {/* Ghost renders above everything */}
        <DragGhost/>
      </DragProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0E0E12",
  },
  container: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  palette: {
    gap: 0,
  },
  workspace: {
    flex: 1,
  },
  workspaceContent: {
    paddingVertical: 16,
    flexGrow: 1,
    alignItems: "flex-start",
  },
  rootSlot: {
    width: "100%",
    minHeight: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  rootSlotFilled: {
    borderWidth: 0,
    backgroundColor: "transparent",
    minWidth: 0,
    minHeight: 0,
    padding: 10,
    alignSelf: "flex-start",
  },
  workspaceHint: {
    color: "rgba(255,255,255,0.2)",
    fontSize: 13,
    textAlign: "center",
  },
});