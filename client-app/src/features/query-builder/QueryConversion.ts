import type {
    AdvancedFilterNode,
    AdvancedGroupNode,
    AdvancedNode,
} from "../advanced-query-builder/types";
import type { QueryCondition, QueryConnector, QueryTag } from "./types";
import { isMetadataPaletteTag } from "./metadata-palette.ts";

/** The simple editor has one outer operator. Reordering never changes meaning. */
export function withOuterConnector(
    conditions: readonly QueryCondition[],
    connector: QueryConnector,
): QueryCondition[] {
    return conditions.map((condition, index) => {
        const desired = index === 0 ? "and" : connector;
        return condition.connector === desired &&
            condition.rememberedNextConnector === connector
            ? condition
            : {
                  ...condition,
                  connector: desired,
                  rememberedNextConnector: connector,
              };
    });
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
