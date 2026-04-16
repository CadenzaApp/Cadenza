import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { View } from "react-native";
import { PaletteItem } from "./types";

////////////////////////////////////////////////////////////////////////////////////
// Note: A lot of this file is boilerplate that react requires
// for sharing state among components without passing them down through props
////////////////////////////////////////////////////////////////////////////////////

type DragState = {
  item: PaletteItem;
  x: number;
  y: number;
} | null;

type RootOffset = { x: number; y: number };

type DragContextValue = {
  dragState: DragState;
  setDragState: (state: DragState) => void;
  hoveredKey: string | null;
  setHoveredKey: (key: string | null) => void;
  rootOffset: RootOffset;
  /** Registered drop zones: slotKey to async measure fn */
  registerDropZone: (key: string, measure: () => Promise<DOMRect | null>) => void;
  unregisterDropZone: (key: string) => void;
  cacheAllRects: () => Promise<void>;
  findZoneAt: (x: number, y: number) => string | null;
  /**
   * Operator registry: LogicNodeBox components register their nodeId to operator
   * mapping on mount so DropSlot can determine whether a drag is redundant
   * (e.g. AND dragged into AND) without any prop drilling.
   */
  registerNodeOperator: (nodeId: string, operator: string) => void;
  unregisterNodeOperator: (nodeId: string) => void;
  getNodeOperator: (nodeId: string) => string | undefined;
};

const DragContext = createContext<DragContextValue | null>(null);

export function DragProvider({ children }: { children: React.ReactNode }) {
  const [dragState, setDragState] = useState<DragState>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [rootOffset, setRootOffset] = useState<RootOffset>({ x: 0, y: 0 });

  const containerRef = useRef<View>(null);
  const dropZones = useRef<Map<string, () => Promise<DOMRect | null>>>(new Map());
  const cachedRects = useRef<Map<string, DOMRect>>(new Map());
  // nodeId to operator string ("AND" "OR" "NOT")
  const nodeOperators = useRef<Map<string, string>>(new Map());

  const handleContainerLayout = useCallback(() => {
    containerRef.current?.measureInWindow((x, y) => {
      setRootOffset({ x, y });
    });
  }, []);

  const registerDropZone = (key: string, measure: () => Promise<DOMRect | null>) => {
    dropZones.current.set(key, measure);
  };
  const unregisterDropZone = (key: string) => {
    dropZones.current.delete(key);
    cachedRects.current.delete(key);
  };

  const cacheAllRects = async () => {
    const results = new Map<string, DOMRect>();
    await Promise.all(
      Array.from(dropZones.current.entries()).map(async ([key, measure]) => {
        try {
          const rect = await measure();
          if (rect) results.set(key, rect);
        } catch (_) {}
      })
    );
    cachedRects.current = results;
  };

  const findZoneAt = (x: number, y: number): string | null => {
    let bestKey: string | null = null;
    let bestArea = Infinity;
    for (const [key, rect] of cachedRects.current.entries()) {
      if (
        x >= rect.x && x <= rect.x + rect.width &&
        y >= rect.y && y <= rect.y + rect.height
      ) {
        const area = rect.width * rect.height;
        if (area < bestArea) {
          bestArea = area;
          bestKey = key;
        }
      }
    }
    return bestKey;
  };

  const registerNodeOperator = (nodeId: string, operator: string) => {
    nodeOperators.current.set(nodeId, operator);
  };
  const unregisterNodeOperator = (nodeId: string) => {
    nodeOperators.current.delete(nodeId);
  };
  const getNodeOperator = (nodeId: string) => nodeOperators.current.get(nodeId);

  return (
    <DragContext.Provider
      value={{
        dragState,
        setDragState,
        hoveredKey,
        setHoveredKey,
        rootOffset,
        registerDropZone,
        unregisterDropZone,
        cacheAllRects,
        findZoneAt,
        registerNodeOperator,
        unregisterNodeOperator,
        getNodeOperator,
      }}
    >
      <View ref={containerRef} style={{ flex: 1 }} onLayout={handleContainerLayout}>
        {children}
      </View>
    </DragContext.Provider>
  );
}

export function useDrag() {
  const ctx = useContext(DragContext);
  if (!ctx) throw new Error("useDrag must be used within DragProvider");
  return ctx;
}
