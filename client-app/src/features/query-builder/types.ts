import { Tag } from "@/types/tag-types";

/////////////////////////
// Query builder types
/////////////////////////

export type QueryNodeTag = {
  kind: "tag";
  id: string;
  tag: Tag;
};

export type LogicOperator = "AND" | "OR" | "NOT";

export type QueryNodeLogic = {
  kind: "logic";
  id: string;
  operator: LogicOperator;
  // NOT can only have one child max: children[0]
  // AND, OR have any amount of children
  children: (QueryNode | null)[];
};

export type QueryNode = QueryNodeTag | QueryNodeLogic;

/////////////////////////
// Dragging types
/////////////////////////

export type PaletteItemTag = {
  kind: "tag";
  tag: Tag;
};

export type PaletteItemLogic = {
  kind: "logic";
  operator: LogicOperator;
};

export type PaletteItem = PaletteItemTag | PaletteItemLogic;

// Which slot in the tree to fill 
// index means replace/fill children[index]
// index "append" means push a new child onto AND/OR at a new index
export type SlotAddress =
  | { nodeId: "root" }                  
  | { nodeId: string; index: number }
  | { nodeId: string; index: "append" };
