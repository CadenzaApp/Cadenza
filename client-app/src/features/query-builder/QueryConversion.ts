import type { Tag } from "@/lib/types";
import {
    OPERATORS_BY_FIELD,
    filterValue,
    METADATA_FIELD_KINDS,
} from "../advanced-query-builder/AdvancedQueryUtils.ts";
import type {
    AdvancedFilterNode,
    AdvancedGroupNode,
    AdvancedNode,
} from "../advanced-query-builder/types";
import type { QueryCondition, QueryConnector, QueryTag } from "./types";
import {
    isMetadataPaletteTag,
    metadataPaletteTag,
} from "./metadata-palette.ts";

/** The simple editor has one outer operator. Reordering never changes meaning. */
export function withOuterConnector(
    conditions: readonly QueryCondition[],
    connector: QueryConnector,
): QueryCondition[] {
    return conditions.map((condition, index) => ({
        ...condition,
        connector: index === 0 ? "and" : connector,
        rememberedNextConnector: connector,
    }));
}

/** Preserve even legacy mixed connectors by explicitly nesting their left fold. */
export function simpleToAdvanced(
    conditions: readonly QueryCondition[],
): AdvancedGroupNode {
    const filter = (tag: QueryTag): AdvancedFilterNode => ({
        kind: "filter",
        id: `filter-${tag.id}`,
        field: isMetadataPaletteTag(tag.tag)
            ? { kind: "metadata", key: tag.tag.metadataKey }
            : { kind: "tag", tagId: tag.tag.id },
        op:
            tag.constraint?.op ??
            (tag.negated ? "is_not_applied" : "is_applied"),
        value: tag.constraint?.value ?? "",
    });
    const nodes: AdvancedNode[] = conditions.map((condition) =>
        condition.kind === "tag"
            ? condition.constraint && condition.negated
                ? {
                      kind: "group",
                      id: `negated-${condition.id}`,
                      conjunction: "none",
                      children: [filter(condition)],
                  }
                : filter(condition)
            : {
                  kind: "group",
                  id: `group-${condition.id}`,
                  conjunction:
                      condition.mode === "any"
                          ? "or"
                          : condition.mode === "all"
                            ? "and"
                            : "none",
                  children: condition.members.map(filter),
              },
    );
    if (!nodes.length)
        return {
            kind: "group",
            id: "converted-root",
            conjunction: "and",
            children: [],
        };
    let root: AdvancedGroupNode = {
        kind: "group",
        id: "converted-root-0",
        conjunction: conditions[1]?.connector ?? "and",
        children: [nodes[0]],
    };
    for (let index = 1; index < nodes.length; index++) {
        const conjunction = conditions[index].connector;
        root =
            root.conjunction === conjunction
                ? { ...root, children: [...root.children, nodes[index]] }
                : {
                      kind: "group",
                      id: `converted-root-${index}`,
                      conjunction,
                      children: [root, nodes[index]],
                  };
    }
    return root;
}

export type SimpleConversion = {
    conditions: QueryCondition[];
    connector: QueryConnector;
};

/** Return null rather than dropping unsupported fields or nested logic. */
export function advancedToSimple(
    root: AdvancedGroupNode,
    tags: readonly Tag[],
    suggestedIds: ReadonlySet<number>,
): SimpleConversion | null {
    if (root.conjunction === "none") return null;
    const byId = new Map(tags.map((tag) => [tag.id, tag]));
    const asTag = (node: AdvancedNode): QueryTag | null => {
        if (node.kind !== "filter" || !node.field || !node.op) return null;
        if (node.field.kind !== "tag" && node.field.kind !== "metadata")
            return null;
        const tag =
            node.field.kind === "metadata"
                ? metadataPaletteTag(node.field.key)
                : byId.get(node.field.tagId);
        if (!tag) return null;
        const fieldKind = isMetadataPaletteTag(tag)
            ? METADATA_FIELD_KINDS[tag.metadataKey]
            : tag.type;
        if (!OPERATORS_BY_FIELD[fieldKind].includes(node.op)) return null;
        let value: string | undefined;
        try {
            value = filterValue(fieldKind, node.op, node.value);
        } catch {
            return null;
        }
        return tag
            ? {
                  kind: "tag",
                  id: `simple-${node.id}`,
                  tag,
                  negated: tag.type === "basic" && node.op === "is_not_applied",
                  constraint:
                      tag.type === "basic" ? undefined : { op: node.op, value },
                  suggested:
                      !isMetadataPaletteTag(tag) && suggestedIds.has(tag.id),
                  connector: root.conjunction as QueryConnector,
              }
            : null;
    };
    const conditions: QueryCondition[] = [];
    for (const node of root.children) {
        if (node.kind === "filter") {
            const tag = asTag(node);
            if (!tag) return null;
            conditions.push(tag);
        } else {
            if (!node.children.length) continue;
            if (node.conjunction === "none" && node.children.length === 1) {
                const single = asTag(node.children[0]);
                if (!single) return null;
                conditions.push({ ...single, negated: !single.negated });
                continue;
            }
            const members = node.children.map(asTag);
            if (members.some((tag) => !tag || tag.negated)) return null;
            const positive = members as QueryTag[];
            if (
                new Set(positive.map((tag) => tag.tag.id)).size !==
                positive.length
            )
                return null;
            if (positive.length === 1)
                conditions.push({
                    ...positive[0],
                    negated: node.conjunction === "none",
                });
            else
                conditions.push({
                    kind: "group",
                    id: `simple-${node.id}`,
                    mode:
                        node.conjunction === "and"
                            ? "all"
                            : node.conjunction === "or"
                              ? "any"
                              : "none",
                    members: positive,
                    connector: root.conjunction,
                });
        }
    }
    return {
        conditions: withOuterConnector(conditions, root.conjunction),
        connector: root.conjunction,
    };
}

export function advancedUsesTags(
    root: AdvancedGroupNode,
    ids: ReadonlySet<number>,
): boolean {
    return root.children.some((node) =>
        node.kind === "group"
            ? advancedUsesTags(node, ids)
            : node.field?.kind === "tag" && ids.has(node.field.tagId),
    );
}
