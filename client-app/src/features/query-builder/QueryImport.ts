/**
 * Turns a query in the wire format back into builder drafts, for a query
 * made outside the builder (the assistant's). The reverse of `queryToJSON`
 * (Simple) and `buildAdvancedQuery` (Advanced). Pure, with type-only imports
 * apart from the metadata palette and the outer connector helper, so it runs
 * under `node --test`.
 *
 * Every query fits Advanced. Simple holds a narrower shape, the one
 * `queryToJSON` writes:
 *
 * - the root is an `and` or `or` of conditions, or one condition on its own
 * - a condition is a tag or metadata filter, the same negated
 *   (`{ not: filter }`), or a group of plain filters: `or` (any), `and`
 *   (all), or `{ not: { or } }` (none)
 * - only `tag` and `metadata` fields; tag name, tag value and tag type
 *   filters are Advanced only
 *
 * `fits_simple` in `backend-api/src/services/assistant/builder.rs` checks the
 * same rules, and both are tested against `builder_fixtures.json` beside it.
 */

import type {
    FilterJSON,
    QueryJSON,
    QueryJSONNode,
} from "../../lib/query-json.ts";
import type { Tag } from "../../lib/types.ts";
import type {
    AdvancedFilterNode,
    AdvancedGroupNode,
    AdvancedNode,
    FilterField,
    GroupConjunction,
} from "../advanced-query-builder/types.ts";
import { metadataPaletteTag } from "./metadata-palette.ts";
import { withOuterConnector } from "./QueryConversion.ts";
import type {
    QueryCondition,
    QueryConnector,
    QueryGroupMode,
    QueryTag,
} from "./types.ts";

type SimpleFilter = FilterJSON & { field: "tag" | "metadata" };

let nextImportId = 0;
function importId(prefix: string): string {
    nextImportId += 1;
    return `imported-${prefix}-${nextImportId}`;
}

function simpleFilter(node: QueryJSONNode): SimpleFilter | null {
    if (!("filter" in node)) return null;
    const { filter } = node;
    return filter.field === "tag" || filter.field === "metadata"
        ? (filter as SimpleFilter)
        : null;
}

/** The plain filters of a group, or null when one of its children is not. */
function groupMembers(nodes: readonly QueryJSONNode[]): SimpleFilter[] | null {
    const members: SimpleFilter[] = [];
    for (const node of nodes) {
        const filter = simpleFilter(node);
        if (!filter) return null;
        members.push(filter);
    }
    return members;
}

type SimpleShape =
    | { kind: "filter"; filter: SimpleFilter; negated: boolean }
    | { kind: "group"; mode: QueryGroupMode; members: SimpleFilter[] };

/** One condition as Simple holds it, or null when Simple cannot. */
function conditionShape(node: QueryJSONNode): SimpleShape | null {
    if ("filter" in node) {
        const filter = simpleFilter(node);
        return filter ? { kind: "filter", filter, negated: false } : null;
    }
    if ("not" in node) {
        const negated = simpleFilter(node.not);
        if (negated) return { kind: "filter", filter: negated, negated: true };
        if ("or" in node.not) {
            const members = groupMembers(node.not.or);
            return members?.length
                ? { kind: "group", mode: "none", members }
                : null;
        }
        return null;
    }
    const children = "and" in node ? node.and : node.or;
    const members = groupMembers(children);
    return members?.length
        ? { kind: "group", mode: "and" in node ? "all" : "any", members }
        : null;
}

/** The conditions of a query and what joins them, or null when Simple cannot hold it. */
function simpleShape(
    query: QueryJSON,
): { connector: QueryConnector; conditions: SimpleShape[] } | null {
    const root = query.where;
    if ("and" in root || "or" in root) {
        const connector: QueryConnector = "and" in root ? "and" : "or";
        const children = "and" in root ? root.and : root.or;
        const conditions: SimpleShape[] = [];
        for (const child of children) {
            const shape = conditionShape(child);
            if (!shape) return null;
            conditions.push(shape);
        }
        return { connector, conditions };
    }
    const shape = conditionShape(root);
    return shape ? { connector: "and", conditions: [shape] } : null;
}

/** Simple can hold `query`. Every query fits Advanced. */
export function fitsSimple(query: QueryJSON): boolean {
    return simpleShape(query) !== null;
}

/** Where a query's tags are looked up, by id. */
export type ImportTags = {
    /** The user's own tags and the activity tags. */
    tags: ReadonlyMap<number, Tag>;
    /** Shared default tags, shown as suggested. */
    suggested?: ReadonlyMap<number, Tag>;
};

/** The palette tag a filter stands for, or null for a tag the user cannot see. */
function tagFor(
    filter: SimpleFilter,
    lookup: ImportTags,
): { tag: Tag; suggested: boolean } | null {
    if (filter.field === "metadata") {
        return { tag: metadataPaletteTag(filter.key), suggested: false };
    }
    const own = lookup.tags.get(filter.tag_id);
    if (own) return { tag: own, suggested: false };
    const suggested = lookup.suggested?.get(filter.tag_id);
    return suggested ? { tag: suggested, suggested: true } : null;
}

/**
 * A filter as a pill. A plain "is applied" (or, outside a group, "is not
 * applied") is a bare tag; anything else carries its operator as a
 * constraint, the way the constraint dialog saves it.
 */
function queryTag(
    filter: SimpleFilter,
    negated: boolean,
    inGroup: boolean,
    lookup: ImportTags,
): QueryTag | null {
    const found = tagFor(filter, lookup);
    if (!found) return null;
    const plainApplied =
        filter.field === "tag" &&
        filter.op === "is_applied" &&
        filter.value === undefined;
    const plainNotApplied =
        !inGroup &&
        !negated &&
        filter.field === "tag" &&
        filter.op === "is_not_applied" &&
        filter.value === undefined;
    const base = {
        kind: "tag" as const,
        id: importId("tag"),
        tag: found.tag,
        suggested: found.suggested,
        connector: "and" as const,
    };
    if (plainApplied) return { ...base, negated };
    if (plainNotApplied) return { ...base, negated: true };
    return {
        ...base,
        negated,
        constraint: {
            op: filter.op,
            ...(filter.value !== undefined ? { value: filter.value } : {}),
        },
    };
}

/**
 * Simple's conditions for `query`, or null when Simple cannot hold it or a
 * tag in it is not one the user can see.
 */
export function queryToSimple(
    query: QueryJSON,
    lookup: ImportTags,
): QueryCondition[] | null {
    const shape = simpleShape(query);
    if (!shape) return null;
    const conditions: QueryCondition[] = [];
    for (const condition of shape.conditions) {
        if (condition.kind === "filter") {
            const tag = queryTag(
                condition.filter,
                condition.negated,
                false,
                lookup,
            );
            if (!tag) return null;
            conditions.push({ ...tag, layoutId: importId("condition") });
            continue;
        }
        if (condition.members.length === 1) {
            // a group of one is its filter, negated for "none"
            const tag = queryTag(
                condition.members[0],
                condition.mode === "none",
                false,
                lookup,
            );
            if (!tag) return null;
            conditions.push({ ...tag, layoutId: importId("condition") });
            continue;
        }
        const members: QueryTag[] = [];
        for (const member of condition.members) {
            const tag = queryTag(member, false, true, lookup);
            if (!tag) return null;
            members.push(tag);
        }
        conditions.push({
            kind: "group",
            id: importId("group"),
            mode: condition.mode,
            connector: "and",
            layoutId: importId("condition"),
            members,
        });
    }
    return withOuterConnector(conditions, shape.connector);
}

function filterNode(filter: FilterJSON): AdvancedFilterNode {
    const field: FilterField =
        filter.field === "tag"
            ? { kind: "tag", tagId: filter.tag_id }
            : filter.field === "metadata"
              ? { kind: "metadata", key: filter.key }
              : { kind: filter.field };
    return {
        kind: "filter",
        id: importId("filter"),
        field,
        op: filter.op,
        value: filter.value ?? "",
    };
}

function groupNode(
    conjunction: GroupConjunction,
    children: readonly QueryJSONNode[],
): AdvancedGroupNode {
    return {
        kind: "group",
        id: importId("group"),
        conjunction,
        children: children.map(advancedNode),
    };
}

function advancedNode(node: QueryJSONNode): AdvancedNode {
    if ("filter" in node) return filterNode(node.filter);
    if ("and" in node) return groupNode("and", node.and);
    if ("or" in node) return groupNode("or", node.or);
    // none of the children, which a `not` of anything but an `or` is too
    return "or" in node.not
        ? groupNode("none", node.not.or)
        : groupNode("none", [node.not]);
}

/** Advanced's tree for `query`. Advanced holds any query. */
export function queryToAdvanced(query: QueryJSON): AdvancedGroupNode {
    const node = advancedNode(query.where);
    return node.kind === "group" ? node : groupNode("and", [query.where]);
}
