/////////////////////////
// Advanced query builder types
/////////////////////////

import type { FilterOp } from "@/lib/query-json";
import type { TagType } from "@/lib/types";

export type { FilterOp };

/**
 * How a group combines its children. "none" means none of the children may
 * match, and is sent as `{ not: { or: [...] } }`.
 */
export type GroupConjunction = "and" | "or" | "none";

/** What a filter line looks at. */
export type FilterField =
    | { kind: "tag"; tagId: number }
    | { kind: "tag_name" }
    | { kind: "tag_value" }
    | { kind: "tag_type" };

/**
 * Decides which operators a filter offers: the tag's type for a "tag" field,
 * otherwise the field itself.
 */
export type FieldKind = TagType | "tag_name" | "tag_value" | "tag_type";

/** Which input a filter shows for its value. */
export type ValueKind =
    | "none"
    | "text"
    | "number"
    | "date"
    | "datetime"
    | "tag_type";

export type AdvancedFilterNode = {
    kind: "filter";
    id: string;
    /** null until the user picks what to filter on */
    field: FilterField | null;
    /** null until a field is picked */
    op: FilterOp | null;
    /**
     * What the user entered. A `YYYY-MM-DD` day for date tags, an ISO
     * timestamp for datetime tags, a tag type for tag type filters, otherwise
     * raw text.
     */
    value: string;
};

export type AdvancedGroupNode = {
    kind: "group";
    id: string;
    conjunction: GroupConjunction;
    children: AdvancedNode[];
};

export type AdvancedNode = AdvancedFilterNode | AdvancedGroupNode;
