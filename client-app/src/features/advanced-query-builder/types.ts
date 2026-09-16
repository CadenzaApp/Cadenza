/////////////////////////
// Advanced query builder types
/////////////////////////

import type { TagType } from "@/lib/types";

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

export type FilterOp =
    // text, tag name, tag value
    | "is"
    | "is_not"
    | "starts_with"
    | "ends_with"
    | "contains"
    | "is_empty"
    // datetime and number
    | "is_not_empty"
    // datetime
    | "on"
    | "not_on"
    | "before"
    | "after"
    | "on_or_before"
    | "on_or_after"
    // number
    | "eq"
    | "ne"
    | "lt"
    | "le"
    | "gt"
    | "ge"
    // checkbox
    | "is_true"
    | "is_false"
    | "is_null"
    // basic
    | "is_applied"
    | "is_not_applied";

/** Which input a filter shows for its value. */
export type ValueKind = "none" | "text" | "number" | "date" | "tag_type";

export type AdvancedFilterNode = {
    kind: "filter";
    id: string;
    /** null until the user picks what to filter on */
    field: FilterField | null;
    /** null until a field is picked */
    op: FilterOp | null;
    /**
     * What the user entered. A `YYYY-MM-DD` day for dates, a tag type for
     * tag type filters, otherwise raw text.
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

/////////////////////////
// Wire format, see backend-api/src/routes/json/advanced_query.rs
/////////////////////////

export type AdvancedQueryJSON = {
    /** IANA time zone. Date filters compare calendar days in this zone. */
    timezone: string;
    where: AdvancedQueryJSONNode;
};

export type AdvancedQueryJSONNode =
    | { and: AdvancedQueryJSONNode[] }
    | { or: AdvancedQueryJSONNode[] }
    | { not: AdvancedQueryJSONNode }
    | { filter: AdvancedFilterJSON };

export type AdvancedFilterJSON =
    | { field: "tag"; tag_id: number; op: FilterOp; value?: string }
    | { field: "tag_name"; op: FilterOp; value?: string }
    | { field: "tag_value"; op: FilterOp; value?: string }
    | { field: "tag_type"; op: FilterOp; value: TagType };
