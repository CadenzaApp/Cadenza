/**
 * Pure helpers for the advanced query builder: operator tables, immutable tree
 * operations, and compiling the tree to the wire format. Type-only imports, so
 * it can be unit tested with `node --test`.
 */

import type { TagType } from "@/lib/types";
import type {
    AdvancedFilterJSON,
    AdvancedFilterNode,
    AdvancedGroupNode,
    AdvancedNode,
    AdvancedQueryJSON,
    AdvancedQueryJSONNode,
    FieldKind,
    FilterField,
    FilterOp,
    GroupConjunction,
    ValueKind,
} from "./types";

/////////////////////////
// Operators
/////////////////////////

const MOMENT_OPS: FilterOp[] = [
    "on",
    "not_on",
    "before",
    "after",
    "on_or_before",
    "on_or_after",
    "is_empty",
    "is_not_empty",
];

const TEXT_OPS: FilterOp[] = [
    "is",
    "is_not",
    "starts_with",
    "ends_with",
    "is_empty",
    "contains",
];

/**
 * Offered last on every tag, whatever its type. Unlike `is_empty` or
 * `is_null`, these tell a tag applied without a value apart from a tag that
 * is not on the song at all.
 */
const APPLIED_OPS: FilterOp[] = ["is_applied", "is_not_applied"];

/** The operators offered for each kind of field, in menu order. */
export const OPERATORS_BY_FIELD: Record<FieldKind, FilterOp[]> = {
    text: [...TEXT_OPS, ...APPLIED_OPS],
    tag_name: TEXT_OPS,
    tag_value: TEXT_OPS,
    datetime: [...MOMENT_OPS, ...APPLIED_OPS],
    date: [...MOMENT_OPS, ...APPLIED_OPS],
    number: [
        "eq",
        "ne",
        "lt",
        "le",
        "gt",
        "ge",
        "is_empty",
        "is_not_empty",
        ...APPLIED_OPS,
    ],
    checkbox: ["is_true", "is_false", "is_null", ...APPLIED_OPS],
    basic: APPLIED_OPS,
    tag_type: ["is", "is_not"],
};

export const OPERATOR_LABELS: Record<FilterOp, string> = {
    is: "is",
    is_not: "is not",
    starts_with: "starts with",
    ends_with: "ends with",
    contains: "contains",
    is_empty: "is empty",
    is_not_empty: "is not empty",
    on: "on",
    not_on: "not on",
    before: "before",
    after: "after",
    on_or_before: "on or before",
    on_or_after: "on or after",
    eq: "=",
    ne: "≠",
    lt: "<",
    le: "≤",
    gt: ">",
    ge: "≥",
    is_true: "is true",
    is_false: "is false",
    is_null: "is null",
    is_applied: "is applied",
    is_not_applied: "is not applied",
};

const VALUELESS_OPS = new Set<FilterOp>([
    "is_empty",
    "is_not_empty",
    "is_true",
    "is_false",
    "is_null",
    "is_applied",
    "is_not_applied",
]);

/** Which value input an operator needs on a field of the given kind. */
export function valueKindFor(fieldKind: FieldKind, op: FilterOp): ValueKind {
    if (VALUELESS_OPS.has(op)) return "none";
    switch (fieldKind) {
        case "number":
            return "number";
        case "datetime":
            return "datetime";
        case "date":
            return "date";
        case "tag_type":
            return "tag_type";
        default:
            return "text";
    }
}

/**
 * The field kind of a filter, or null when nothing is picked yet or the
 * picked tag no longer exists.
 */
export function fieldKindOf(
    field: FilterField | null,
    tagTypes: ReadonlyMap<number, TagType>,
): FieldKind | null {
    if (!field) return null;
    if (field.kind === "tag") return tagTypes.get(field.tagId) ?? null;
    return field.kind;
}

/////////////////////////
// Groups
/////////////////////////

export const CONJUNCTIONS: GroupConjunction[] = ["and", "or", "none"];

export const CONJUNCTION_LABELS: Record<GroupConjunction, string> = {
    and: "All of the following are true",
    or: "Any of the following are true",
    none: "None of the following are true",
};

/**
 * The word in front of a filter line: "where" on the first line, then the
 * word that joins it to the lines above. A "none" group reads as "or", since
 * it is "none of (a or b)".
 */
export function connectorLabel(
    conjunction: GroupConjunction,
    index: number,
): string {
    if (index === 0) return "where";
    return conjunction === "and" ? "and" : "or";
}

/////////////////////////
// Tree operations. Every one returns a new tree; nothing mutates.
/////////////////////////

let nextNodeId = 0;
function newNodeId(): string {
    nextNodeId += 1;
    return `adv-${nextNodeId}`;
}

export function createFilter(): AdvancedFilterNode {
    return {
        kind: "filter",
        id: newNodeId(),
        field: null,
        op: null,
        value: "",
    };
}

/** A new group starts with one empty filter, ready to fill in. */
export function createGroup(
    conjunction: GroupConjunction = "and",
): AdvancedGroupNode {
    return {
        kind: "group",
        id: newNodeId(),
        conjunction,
        children: [createFilter()],
    };
}

/** Replaces the node with the given id by `update(node)`. */
function mapNode(
    node: AdvancedNode,
    id: string,
    update: (node: AdvancedNode) => AdvancedNode,
): AdvancedNode {
    if (node.id === id) return update(node);
    if (node.kind === "filter") return node;

    let changed = false;
    const children = node.children.map((child) => {
        const next = mapNode(child, id, update);
        if (next !== child) changed = true;
        return next;
    });
    return changed ? { ...node, children } : node;
}

function mapGroup(
    root: AdvancedGroupNode,
    groupId: string,
    update: (group: AdvancedGroupNode) => AdvancedGroupNode,
): AdvancedGroupNode {
    return mapNode(root, groupId, (node) =>
        node.kind === "group" ? update(node) : node,
    ) as AdvancedGroupNode;
}

export function addChild(
    root: AdvancedGroupNode,
    groupId: string,
    child: AdvancedNode,
): AdvancedGroupNode {
    return mapGroup(root, groupId, (group) => ({
        ...group,
        children: [...group.children, child],
    }));
}

export function setConjunction(
    root: AdvancedGroupNode,
    groupId: string,
    conjunction: GroupConjunction,
): AdvancedGroupNode {
    return mapGroup(root, groupId, (group) => ({ ...group, conjunction }));
}

/** Removes a filter or group. The root itself cannot be removed. */
export function removeNode(
    root: AdvancedGroupNode,
    id: string,
): AdvancedGroupNode {
    if (root.id === id) return root;

    function without(group: AdvancedGroupNode): AdvancedGroupNode {
        const children = group.children
            .filter((child) => child.id !== id)
            .map((child) => (child.kind === "group" ? without(child) : child));
        return { ...group, children };
    }
    return without(root);
}

export function updateFilter(
    root: AdvancedGroupNode,
    filterId: string,
    update: (filter: AdvancedFilterNode) => AdvancedFilterNode,
): AdvancedGroupNode {
    return mapNode(root, filterId, (node) =>
        node.kind === "filter" ? update(node) : node,
    ) as AdvancedGroupNode;
}

/**
 * Points a filter at a new field. The operator is kept when the new field
 * offers it, otherwise it falls back to the field's first operator. The value
 * is kept only when the kind of input stays the same.
 */
export function withField(
    filter: AdvancedFilterNode,
    field: FilterField,
    tagTypes: ReadonlyMap<number, TagType>,
): AdvancedFilterNode {
    const oldKind = fieldKindOf(filter.field, tagTypes);
    const newKind = fieldKindOf(field, tagTypes);
    if (!newKind) return { ...filter, field, op: null, value: "" };

    const ops = OPERATORS_BY_FIELD[newKind];
    const op = filter.op && ops.includes(filter.op) ? filter.op : ops[0];
    const keepValue =
        oldKind != null &&
        filter.op != null &&
        valueKindFor(oldKind, filter.op) === valueKindFor(newKind, op);

    return { ...filter, field, op, value: keepValue ? filter.value : "" };
}

/** Changes a filter's operator, clearing the value if the input changes. */
export function withOp(
    filter: AdvancedFilterNode,
    op: FilterOp,
    tagTypes: ReadonlyMap<number, TagType>,
): AdvancedFilterNode {
    const kind = fieldKindOf(filter.field, tagTypes);
    if (!kind) return filter;

    const keepValue =
        filter.op != null &&
        valueKindFor(kind, filter.op) === valueKindFor(kind, op);
    return { ...filter, op, value: keepValue ? filter.value : "" };
}

export function countFilters(node: AdvancedNode): number {
    if (node.kind === "filter") return 1;
    return node.children.reduce((sum, child) => sum + countFilters(child), 0);
}

/////////////////////////
// Dates
/////////////////////////

const DATE_VALUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The local calendar day of `date`, as `YYYY-MM-DD`. Same as
 * `@/lib/tag-values::toDateOnly`, kept here so this file stays import-free.
 */
export function toDateValue(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Midnight local time on a `YYYY-MM-DD` day, or null if it is not one. */
export function parseDateValue(value: string): Date | null {
    const match = DATE_VALUE_PATTERN.exec(value);
    if (!match) return null;

    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(year, month - 1, day);
    const isSameDay =
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day;
    return isSameDay ? date : null;
}

/**
 * `date` with its seconds dropped, as an ISO timestamp. Datetime filters
 * compare to the minute, so this is the most precision worth sending.
 */
export function toDateTimeValue(date: Date): string {
    const minute = new Date(date);
    minute.setSeconds(0, 0);
    return minute.toISOString();
}

/** A datetime filter value as a `Date`, or null if it does not parse. */
export function parseDateTimeValue(value: string): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/////////////////////////
// Compiling for the wire
/////////////////////////

export type BuildAdvancedQueryResult =
    | { ok: true; query: AdvancedQueryJSON }
    | { ok: false; error: string };

class BuildError extends Error {}

/**
 * Compiles the builder tree into `AdvancedQueryJSON`. Groups with no filters
 * in them are dropped, so an empty group never changes the result. Returns an
 * error message instead when a filter is unfinished or invalid, or when there
 * are no filters at all.
 */
export function buildAdvancedQuery(
    root: AdvancedGroupNode,
    tagTypes: ReadonlyMap<number, TagType>,
): BuildAdvancedQueryResult {
    try {
        const where = groupToJSON(root, tagTypes);
        if (!where) return { ok: false, error: "Add at least one filter." };
        return { ok: true, query: { where } };
    } catch (err) {
        if (err instanceof BuildError) return { ok: false, error: err.message };
        throw err;
    }
}

function groupToJSON(
    group: AdvancedGroupNode,
    tagTypes: ReadonlyMap<number, TagType>,
): AdvancedQueryJSONNode | null {
    const children: AdvancedQueryJSONNode[] = [];
    for (const child of group.children) {
        const json =
            child.kind === "group"
                ? groupToJSON(child, tagTypes)
                : { filter: filterToJSON(child, tagTypes) };
        if (json) children.push(json);
    }

    if (children.length === 0) return null;

    switch (group.conjunction) {
        case "and":
            return { and: children };
        case "or":
            return { or: children };
        case "none":
            return { not: { or: children } };
    }
}

function filterToJSON(
    filter: AdvancedFilterNode,
    tagTypes: ReadonlyMap<number, TagType>,
): AdvancedFilterJSON {
    const { field, op } = filter;
    if (!field) throw new BuildError("Pick a tag for every filter.");

    const kind = fieldKindOf(field, tagTypes);
    if (!kind)
        throw new BuildError("A filter uses a tag that no longer exists.");
    if (!op) throw new BuildError("Pick an operator for every filter.");

    const value = filterValue(kind, op, filter.value);

    switch (field.kind) {
        case "tag":
            return withValue({ field: "tag", tag_id: field.tagId, op }, value);
        case "tag_name":
            return withValue({ field: "tag_name", op }, value);
        case "tag_value":
            return withValue({ field: "tag_value", op }, value);
        case "tag_type":
            return { field: "tag_type", op, value: value as TagType };
    }
}

function withValue<T extends object>(
    filter: T,
    value: string | undefined,
): T & { value?: string } {
    return value === undefined ? filter : { ...filter, value };
}

/** The value to send, or undefined for operators that take none. */
function filterValue(
    kind: FieldKind,
    op: FilterOp,
    raw: string,
): string | undefined {
    const value = raw.trim();

    switch (valueKindFor(kind, op)) {
        case "none":
            return undefined;
        case "text":
            if (!value)
                throw new BuildError("Fill in a value for every filter.");
            return value;
        case "number":
            if (!value || !Number.isFinite(Number(value))) {
                throw new BuildError(
                    value
                        ? `"${value}" is not a number.`
                        : "Fill in a value for every filter.",
                );
            }
            return String(Number(value));
        case "date":
            if (!parseDateValue(value)) {
                throw new BuildError("Pick a date for every date filter.");
            }
            return value;
        case "datetime": {
            const date = parseDateTimeValue(value);
            if (!date) {
                throw new BuildError(
                    "Pick a date and time for every date & time filter.",
                );
            }
            return toDateTimeValue(date);
        }
        case "tag_type":
            if (!value) throw new BuildError("Pick a tag type.");
            return value;
    }
}
