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

/**
 * Which piece of a song's Apple Music metadata a `metadata` filter looks at.
 * Text operators for title, artist, album, and genre (any one of the song's
 * genres), date operators for the release date, number operators in
 * milliseconds for the duration, `is_true` / `is_false` for explicit, and
 * number operators without the empty ones for total plays, every user's counted
 * plays of the song.
 */
export type MetadataKey =
    | "title"
    | "artist"
    | "album"
    | "genre"
    | "release_date"
    | "duration"
    | "explicit"
    | "total_plays";

export type FilterJSON =
    | { field: "tag"; tag_id: number; op: FilterOp; value?: string }
    | { field: "tag_name"; op: FilterOp; value?: string }
    | { field: "tag_value"; op: FilterOp; value?: string }
    | { field: "tag_type"; op: FilterOp; value: TagType }
    | { field: "metadata"; key: MetadataKey; op: FilterOp; value?: string };

/**
 * How a metadata key reads: in a query's name, in the builder, and on the
 * song's Metadata Tags pills.
 */
export const METADATA_KEY_LABELS: Record<MetadataKey, string> = {
    title: "Title",
    artist: "Artist",
    album: "Album",
    genre: "Genre",
    release_date: "Release date",
    duration: "Duration (ms)",
    explicit: "Explicit",
    total_plays: "Total Plays",
};

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

/** How an operator reads inside a query's name. */
const OP_TEXT: Record<FilterOp, string> = {
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
    ne: "!=",
    lt: "<",
    le: "<=",
    gt: ">",
    ge: ">=",
    is_true: "is checked",
    is_false: "is unchecked",
    is_null: "is unset",
    is_applied: "is applied",
    is_not_applied: "is not applied",
};

/**
 * A query as one line a person can read, like `Chill and not (Sad or Loud)`.
 *
 * `tags` names the tag filters. A tag missing from it reads as `a tag`, rather
 * than leaking an id. A group of one is drawn as its child, and a nested group
 * of more than one gets parentheses.
 */
export function describeQuery(
    query: QueryJSON,
    tags: readonly { id: number; name: string }[],
): string {
    const namesById = new Map(tags.map((tag) => [tag.id, tag.name]));

    const filterText = (filter: FilterJSON): string => {
        const subject =
            filter.field === "tag"
                ? (namesById.get(filter.tag_id) ?? "a tag")
                : filter.field === "metadata"
                  ? METADATA_KEY_LABELS[filter.key].toLowerCase()
                  : filter.field === "tag_name"
                    ? "tag name"
                    : filter.field === "tag_value"
                      ? "tag value"
                      : "tag type";
        if (filter.field === "tag" && filter.op === "is_applied")
            return subject;
        if (filter.field === "tag" && filter.op === "is_not_applied") {
            return `not ${subject}`;
        }
        const value = filter.value ? ` ${filter.value}` : "";
        return `${subject} ${OP_TEXT[filter.op]}${value}`;
    };

    const visit = (node: QueryJSONNode, nested: boolean): string => {
        if ("filter" in node) return filterText(node.filter);
        if ("not" in node) return `not ${visit(node.not, true)}`;
        const [joiner, children] =
            "and" in node ? [" and ", node.and] : [" or ", node.or];
        if (children.length === 1) return visit(children[0], nested);
        const text = children.map((child) => visit(child, true)).join(joiner);
        return nested ? `(${text})` : text;
    };

    return visit(query.where, false);
}
