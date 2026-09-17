import type { Tag, TagMetadata } from "@/lib/types";

import type {
    QueryCondition,
    QueryConnector,
    QueryGroup,
    QueryGroupMode,
    QueryJSONNode,
    QueryTag,
} from "./types";

let nextQueryId = 0;

export function sortTagsByApplicationCount(
    tags: readonly Tag[],
    metadata?: Readonly<Record<number, TagMetadata>>,
): Tag[] {
    return [...tags].sort((left, right) => {
        const countDifference =
            (metadata?.[right.id]?.count ?? 0) -
            (metadata?.[left.id]?.count ?? 0);
        if (countDifference !== 0) return countDifference;
        const nameDifference = left.name.localeCompare(right.name);
        return nameDifference !== 0 ? nameDifference : left.id - right.id;
    });
}

export function makeQueryId(prefix: "tag" | "group" | "condition"): string {
    nextQueryId += 1;
    return `${prefix}-${Date.now().toString(36)}-${nextQueryId.toString(36)}`;
}

export function makeQueryTag(
    tag: Tag,
    connector: QueryConnector = "and",
): QueryTag {
    return {
        kind: "tag",
        id: makeQueryId("tag"),
        layoutId: makeQueryId("condition"),
        tag,
        negated: false,
        connector,
    };
}

export function appendTag(
    conditions: readonly QueryCondition[],
    tag: Tag,
): QueryCondition[] {
    return [
        ...conditions,
        makeQueryTag(tag, connectorForInsertion(conditions, conditions.length)),
    ];
}

export function insertTag(
    conditions: readonly QueryCondition[],
    tag: Tag,
    index: number,
): QueryCondition[] {
    const next = [...conditions];
    const insertionIndex = clampInsertionIndex(index, next.length);
    next.splice(
        insertionIndex,
        0,
        makeQueryTag(tag, connectorForInsertion(conditions, insertionIndex)),
    );
    return next;
}

export function addTagToCondition(
    conditions: readonly QueryCondition[],
    tag: Tag,
    conditionId: string,
): QueryCondition[] {
    return addQueryTagToCondition(conditions, makeQueryTag(tag), conditionId);
}

export function toggleConditionNegation(
    conditions: readonly QueryCondition[],
    conditionId: string,
): QueryCondition[] {
    return conditions.map((condition) =>
        condition.kind === "tag" && condition.id === conditionId
            ? { ...condition, negated: !condition.negated }
            : condition,
    );
}

export function setGroupMode(
    conditions: readonly QueryCondition[],
    groupId: string,
    mode: QueryGroupMode,
): QueryCondition[] {
    return conditions.map((condition) =>
        condition.kind === "group" && condition.id === groupId
            ? { ...condition, mode }
            : condition,
    );
}

export function toggleConditionConnector(
    conditions: readonly QueryCondition[],
    conditionId: string,
): QueryCondition[] {
    return conditions.map((condition, index) =>
        index > 0 && condition.id === conditionId
            ? {
                ...condition,
                connector: condition.connector === "and" ? "or" : "and",
            }
            : condition,
    );
}

export function conditionConnectorLabel(condition: QueryCondition): string {
    const connector = condition.connector.toUpperCase();
    const itemCount = condition.kind === "group" ? condition.members.length : 1;
    return itemCount === 1 ? `${connector} HAVE` : connector;
}

export function groupMemberConnectorLabel(mode: QueryGroupMode): string {
    if (mode === "any") return "OR";
    return mode === "none" ? "NOR" : "AND";
}

export function removeQueryTag(
    conditions: readonly QueryCondition[],
    queryTagId: string,
): QueryCondition[] {
    return normalizeFirstConnector(
        detachQueryTag(conditions, queryTagId).conditions,
    );
}

export function removeCondition(
    conditions: readonly QueryCondition[],
    conditionId: string,
): QueryCondition[] {
    const conditionIndex = conditions.findIndex(
        (condition) => condition.id === conditionId,
    );
    if (conditionIndex === -1) return [...conditions];
    return normalizeFirstConnector(
        removeConditionAtIndex([...conditions], conditionIndex),
    );
}

export function moveConditionToIndex(
    conditions: readonly QueryCondition[],
    conditionId: string,
    index: number,
): QueryCondition[] {
    const conditionIndex = conditions.findIndex(
        (condition) => condition.id === conditionId,
    );
    if (conditionIndex === -1) return [...conditions];

    const connectorSlots = conditions
        .slice(1)
        .map((condition) => condition.connector);
    const next = [...conditions];
    const [condition] = next.splice(conditionIndex, 1);
    const adjustedIndex = conditionIndex < index ? index - 1 : index;
    next.splice(clampInsertionIndex(adjustedIndex, next.length), 0, condition);
    return next.map((item, nextIndex) => ({
        ...item,
        connector: nextIndex === 0 ? "and" : connectorSlots[nextIndex - 1],
    }));
}

export function getConditionReorderPosition(
    conditions: readonly Pick<QueryCondition, "id">[],
    conditionId: string,
    draggedCenterY: number,
    conditionCenters: ReadonlyMap<string, number>,
): { finalIndex: number; insertionIndex: number } | null {
    const originIndex = conditions.findIndex(
        (condition) => condition.id === conditionId,
    );
    if (originIndex === -1) return null;

    let finalIndex = 0;
    for (const condition of conditions) {
        if (condition.id === conditionId) continue;
        const center = conditionCenters.get(condition.id);
        if (center == null) {
            return {
                finalIndex: Math.min(originIndex, conditions.length - 1),
                insertionIndex: originIndex,
            };
        }
        if (draggedCenterY > center) finalIndex += 1;
    }

    return {
        finalIndex,
        insertionIndex: finalIndex > originIndex ? finalIndex + 1 : finalIndex,
    };
}

export function moveQueryTagToIndex(
    conditions: readonly QueryCondition[],
    queryTagId: string,
    index: number,
): QueryCondition[] {
    const detached = detachQueryTag(conditions, queryTagId);
    if (!detached.queryTag) return [...conditions];

    const adjustedIndex =
        detached.removedTopLevelCondition && detached.conditionIndex < index
            ? index - 1
            : index;
    const next = [...detached.conditions];
    const insertionIndex = clampInsertionIndex(adjustedIndex, next.length);
    next.splice(insertionIndex, 0, {
        ...detached.queryTag,
        connector: connectorForInsertion(next, insertionIndex),
    });
    return normalizeFirstConnector(next);
}

export function moveQueryTagToCondition(
    conditions: readonly QueryCondition[],
    queryTagId: string,
    conditionId: string,
): QueryCondition[] {
    const origin = findConditionContainingTag(conditions, queryTagId);
    if (!origin || origin.id === conditionId) return [...conditions];
    const movingTag =
        origin.kind === "tag"
            ? origin
            : origin.members.find((member) => member.id === queryTagId);
    const target = conditions.find((condition) => condition.id === conditionId);
    if (movingTag && target && conditionContainsTag(target, movingTag.tag.id)) {
        return [...conditions];
    }

    const detached = detachQueryTag(conditions, queryTagId);
    if (!detached.queryTag) return [...conditions];
    if (
        !detached.conditions.some((condition) => condition.id === conditionId)
    ) {
        return [...conditions];
    }
    return normalizeFirstConnector(
        addQueryTagToCondition(
            detached.conditions,
            detached.queryTag,
            conditionId,
        ),
    );
}

export function queryToJSON(
    conditions: readonly QueryCondition[],
): QueryJSONNode | null {
    if (conditions.length === 0) return null;
    if (conditions.length === 1) {
        return { and: [conditionToJSON(conditions[0])] };
    }

    return conditions
        .slice(1)
        .reduce(
            (expression, condition) =>
                joinJSONNodes(
                    expression,
                    conditionToJSON(condition),
                    condition.connector,
                ),
            conditionToJSON(conditions[0]),
        );
}

export function usedTagIds(
    conditions: readonly QueryCondition[],
): ReadonlySet<number> {
    const used = new Set<number>();
    for (const condition of conditions) {
        if (condition.kind === "tag") used.add(condition.tag.id);
        else condition.members.forEach((member) => used.add(member.tag.id));
    }
    return used;
}

export function queryHeading(conditions: readonly QueryCondition[]): string {
    return conditions[0]?.kind === "group"
        ? "Find me all songs that:"
        : "Find me all songs that have:";
}

function addQueryTagToCondition(
    conditions: readonly QueryCondition[],
    queryTag: QueryTag,
    conditionId: string,
): QueryCondition[] {
    return conditions.map((condition) => {
        if (condition.id !== conditionId) return condition;
        if (conditionContainsTag(condition, queryTag.tag.id)) return condition;
        if (condition.kind === "group") {
            return {
                ...condition,
                members: [...condition.members, asGroupMember(queryTag)],
            };
        }
        return {
            kind: "group",
            id: makeQueryId("group"),
            mode: condition.negated ? "none" : "any",
            connector: condition.connector,
            rememberedNextConnector: condition.rememberedNextConnector,
            layoutId: condition.layoutId ?? makeQueryId("condition"),
            members: [asGroupMember(condition), asGroupMember(queryTag)],
        } satisfies QueryGroup;
    });
}

function detachQueryTag(
    conditions: readonly QueryCondition[],
    queryTagId: string,
): {
    conditions: QueryCondition[];
    queryTag: QueryTag | null;
    conditionIndex: number;
    removedTopLevelCondition: boolean;
} {
    const conditionIndex = conditions.findIndex((condition) =>
        condition.kind === "tag"
            ? condition.id === queryTagId
            : condition.members.some((member) => member.id === queryTagId),
    );
    if (conditionIndex === -1) {
        return {
            conditions: [...conditions],
            queryTag: null,
            conditionIndex: -1,
            removedTopLevelCondition: false,
        };
    }

    const condition = conditions[conditionIndex];
    const next = [...conditions];
    if (condition.kind === "tag") {
        return {
            conditions: removeConditionAtIndex(next, conditionIndex),
            queryTag: condition,
            conditionIndex,
            removedTopLevelCondition: true,
        };
    }

    const queryTag =
        condition.members.find((member) => member.id === queryTagId) ?? null;
    const remaining = condition.members.filter(
        (member) => member.id !== queryTagId,
    );
    if (remaining.length === 0) {
        const withoutCondition = removeConditionAtIndex(next, conditionIndex);
        next.splice(0, next.length, ...withoutCondition);
    } else if (remaining.length === 1) {
        next[conditionIndex] = asTopLevelTag(
            remaining[0],
            condition.connector,
            condition.rememberedNextConnector,
            condition.layoutId ?? condition.id,
            condition.mode === "none",
        );
    } else next[conditionIndex] = { ...condition, members: remaining };

    return {
        conditions: next,
        queryTag,
        conditionIndex,
        removedTopLevelCondition: remaining.length === 0,
    };
}

function findConditionContainingTag(
    conditions: readonly QueryCondition[],
    queryTagId: string,
): QueryCondition | undefined {
    return conditions.find((condition) =>
        condition.kind === "tag"
            ? condition.id === queryTagId
            : condition.members.some((member) => member.id === queryTagId),
    );
}

function conditionContainsTag(
    condition: QueryCondition,
    tagId: number,
): boolean {
    return condition.kind === "tag"
        ? condition.tag.id === tagId
        : condition.members.some((member) => member.tag.id === tagId);
}

function conditionToJSON(condition: QueryCondition): QueryJSONNode {
    if (condition.kind === "tag") return queryTagToJSON(condition);
    const children = condition.members.map((member) => member.tag.id);
    if (condition.mode === "none") return { not: { or: children } };
    return condition.mode === "any" ? { or: children } : { and: children };
}

function queryTagToJSON(queryTag: QueryTag): QueryJSONNode {
    return queryTag.negated ? { not: queryTag.tag.id } : queryTag.tag.id;
}

function joinJSONNodes(
    left: QueryJSONNode,
    right: QueryJSONNode,
    connector: QueryConnector,
): QueryJSONNode {
    if (connector === "and" && typeof left === "object" && "and" in left) {
        return { and: [...left.and, right] };
    }
    if (connector === "or" && typeof left === "object" && "or" in left) {
        return { or: [...left.or, right] };
    }
    return connector === "and" ? { and: [left, right] } : { or: [left, right] };
}

function normalizeFirstConnector(
    conditions: QueryCondition[],
): QueryCondition[] {
    if (conditions.length === 0 || conditions[0].connector === "and") {
        return conditions;
    }
    return [{ ...conditions[0], connector: "and" }, ...conditions.slice(1)];
}

function removeConditionAtIndex(
    conditions: QueryCondition[],
    index: number,
): QueryCondition[] {
    const next = [...conditions];
    const [removed] = next.splice(index, 1);
    if (removed && index > 0) {
        const previous = next[index - 1];
        next[index - 1] = {
            ...previous,
            rememberedNextConnector: removed.connector,
        };
    }
    return next;
}

function asGroupMember(queryTag: QueryTag): QueryTag {
    const member = {
        ...queryTag,
        negated: false,
        connector: "and" as const,
    };
    delete member.rememberedNextConnector;
    delete member.layoutId;
    return member;
}

function asTopLevelTag(
    queryTag: QueryTag,
    connector: QueryConnector,
    rememberedNextConnector?: QueryConnector,
    layoutId?: string,
    negated = false,
): QueryTag {
    const topLevelTag = { ...queryTag, negated, connector };
    delete topLevelTag.rememberedNextConnector;
    delete topLevelTag.layoutId;
    if (rememberedNextConnector) {
        topLevelTag.rememberedNextConnector = rememberedNextConnector;
    }
    if (layoutId) topLevelTag.layoutId = layoutId;
    return topLevelTag;
}

function connectorForInsertion(
    conditions: readonly QueryCondition[],
    index: number,
): QueryConnector {
    if (index <= 0) return "and";
    const previous = conditions[index - 1];
    return (
        previous.rememberedNextConnector ??
        conditions[index]?.connector ??
        "and"
    );
}

function clampInsertionIndex(index: number, length: number): number {
    return Math.max(0, Math.min(Math.trunc(index), length));
}
