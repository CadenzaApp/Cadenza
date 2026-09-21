/////////////////////////
// The tag query wire format, sent as the `query` field of POST /queries/results.
// Mirrors backend-api/src/routes/json/query.rs.
//
// Both builders compile to this shape: the drag and drop builder in
// `@/features/query-builder` only emits "is_applied" and "is_not_applied" tag
// filters, and the advanced builder in `@/features/advanced-query-builder` uses
// the rest.
/////////////////////////

import type { TagType } from "@/lib/types";

/** Every filter operator, across all field and tag types. */
export type FilterOp =
    // text, tag name, tag value
    | "is"
    | "is_not"
    | "starts_with"
    | "ends_with"
    | "contains"
    | "is_empty"
    // datetime, date and number
    | "is_not_empty"
    // datetime and date
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
    // every tag type
    | "is_applied"
    | "is_not_applied";

export type QueryJSON = {
    where: QueryJSONNode;
};

export type QueryJSONNode =
    | { and: QueryJSONNode[] }
    | { or: QueryJSONNode[] }
    | { not: QueryJSONNode }
    | { filter: FilterJSON };

export type FilterJSON =
    | { field: "tag"; tag_id: number; op: FilterOp; value?: string }
    | { field: "tag_name"; op: FilterOp; value?: string }
    | { field: "tag_value"; op: FilterOp; value?: string }
    | { field: "tag_type"; op: FilterOp; value: TagType };
