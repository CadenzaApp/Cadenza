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

/** Names of tags a query requires to be present, in query traversal order. */
export function positiveQueryTagNames(
    query: QueryJSON,
    tags: readonly { id: number; name: string }[],
): string[] {
    const tagIds = new Set<number>();
    collectPositiveTagIds(query.where, false, tagIds);

    const namesById = new Map(tags.map((tag) => [tag.id, tag.name]));
    const names: string[] = [];
    const seenNames = new Set<string>();
    for (const tagId of tagIds) {
        const name = namesById.get(tagId);
        if (name === undefined) continue;
        const normalized = name.trim().replace(/\s+/g, " ").toLowerCase();
        if (!normalized || seenNames.has(normalized)) continue;
        seenNames.add(normalized);
        names.push(name);
    }
    return names;
}

/**
 * The id of every tag a filter in `query` names, whatever its operator and
 * whether or not it is negated, in query traversal order.
 */
export function queryTagIds(query: QueryJSON): number[] {
    const ids = new Set<number>();
    const visit = (node: QueryJSONNode) => {
        if ("and" in node) node.and.forEach(visit);
        else if ("or" in node) node.or.forEach(visit);
        else if ("not" in node) visit(node.not);
        else if (node.filter.field === "tag") ids.add(node.filter.tag_id);
    };
    visit(query.where);
    return [...ids];
}

/** Adds the id of every tag `node` asks for to `out`. */
function collectPositiveTagIds(
    node: QueryJSONNode,
    negated: boolean,
    out: Set<number>,
) {
    if ("and" in node) {
        for (const child of node.and)
            collectPositiveTagIds(child, negated, out);
    } else if ("or" in node) {
        for (const child of node.or) collectPositiveTagIds(child, negated, out);
    } else if ("not" in node) {
        collectPositiveTagIds(node.not, !negated, out);
    } else if (node.filter.field === "tag") {
        const excludes = node.filter.op === "is_not_applied";
        if (negated === excludes) out.add(node.filter.tag_id);
    }
}
