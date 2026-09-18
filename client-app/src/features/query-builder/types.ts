import type { Tag } from "@/lib/types";

export type QueryTag = {
    kind: "tag";
    id: string;
    tag: Tag;
    negated: boolean;
    /**
     * Came from the palette's suggested-tag section, so it is a shared default
     * tag rather than one of the user's own. It only matches while the results
     * request carries `consider_default_tags`.
     */
    suggested: boolean;
    connector: QueryConnector;
    rememberedNextConnector?: QueryConnector;
    layoutId?: string;
};

export type QueryGroupMode = "any" | "all" | "none";
export type QueryConnector = "and" | "or";

export type QueryGroup = {
    kind: "group";
    id: string;
    mode: QueryGroupMode;
    members: QueryTag[];
    connector: QueryConnector;
    rememberedNextConnector?: QueryConnector;
    layoutId?: string;
};

export type QueryCondition = QueryTag | QueryGroup;

export type QueryTagOrigin = {
    conditionId: string;
};

export type DragPayload =
    | { source: "palette"; tag: Tag; suggested: boolean }
    | { source: "query"; queryTag: QueryTag; origin: QueryTagOrigin }
    | {
          source: "condition";
          condition: QueryCondition;
          originIndex: number;
          height: number;
      };

export type DropTarget =
    | { kind: "insert"; index: number }
    | { kind: "condition"; conditionId: string }
    | { kind: "query-end" }
    | { kind: "delete" };

export type DragState = {
    payload: DragPayload;
    x: number;
    y: number;
    releasing?: boolean;
} | null;
