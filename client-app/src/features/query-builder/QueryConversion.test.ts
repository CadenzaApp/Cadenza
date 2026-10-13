import assert from "node:assert/strict";
import test from "node:test";
import {
    advancedToSimple,
    advancedUsesTags,
    simpleToAdvanced,
    withOuterConnector,
} from "./QueryConversion.ts";
import { buildAdvancedQuery } from "../advanced-query-builder/AdvancedQueryUtils.ts";
import { queryToJSON, moveConditionToIndex } from "./QueryUtils.ts";
import type { QueryCondition, QueryTag } from "./types.ts";
import type { QueryJSONNode } from "../../lib/query-json.ts";
import type { AdvancedGroupNode } from "../advanced-query-builder/types.ts";
import { metadataPaletteTag } from "./metadata-palette.ts";

const tags = [1, 2, 3].map((id) => ({
    id,
    name: `Tag ${id}`,
    color: "#123456",
    type: "basic" as const,
}));
const tagTypes = new Map(tags.map((tag) => [tag.id, tag.type]));
test("metadata filters survive switching between simple and advanced builders", () => {
    const conditions: QueryCondition[] = [
        {
            kind: "tag",
            id: "metadata-title",
            tag: metadataPaletteTag("title"),
            negated: false,
            suggested: false,
            constraint: { op: "contains", value: "wheee" },
            connector: "and",
        },
    ];
    const advanced = simpleToAdvanced(conditions);
    assert.deepEqual(
        advanced.children[0].kind === "filter"
            ? advanced.children[0].field
            : null,
        {
            kind: "metadata",
            key: "title",
        },
    );
    const built = buildAdvancedQuery(advanced, tagTypes);
    assert.ok(built.ok);
    assert.deepEqual(queryToJSON(conditions), built.query);
    const restored = advancedToSimple(advanced, tags, new Set());
    assert.ok(restored);
    assert.deepEqual(queryToJSON(restored.conditions), queryToJSON(conditions));
});
const leaf = (index: number, negated = false): QueryTag => ({
    kind: "tag",
    id: String(index),
    tag: tags[index - 1],
    negated,
    suggested: index === 2,
    connector: "and",
});
function matches(node: QueryJSONNode, applied: Set<number>): boolean {
    if ("and" in node)
        return node.and.every((child) => matches(child, applied));
    if ("or" in node) return node.or.some((child) => matches(child, applied));
    if ("not" in node) return !matches(node.not, applied);
    assert.equal(node.filter.field, "tag");
    if (node.filter.field !== "tag") throw new Error("Expected tag filter");
    return node.filter.op === "is_not_applied"
        ? !applied.has(node.filter.tag_id!)
        : applied.has(node.filter.tag_id!);
}
function equivalent(a: QueryJSONNode, b: QueryJSONNode) {
    for (let mask = 0; mask < 8; mask++) {
        const applied = new Set(
            tags.filter((_, index) => mask & (1 << index)).map((tag) => tag.id),
        );
        assert.equal(
            matches(a, applied),
            matches(b, applied),
            `truth table row ${mask}`,
        );
    }
}
for (const connector of ["and", "or"] as const) {
    for (const mode of ["any", "all", "none"] as const) {
        test(`${connector}/${mode}: editor round trip preserves every match and suggested identity`, () => {
            const conditions = withOuterConnector(
                [
                    {
                        kind: "group",
                        id: "g",
                        mode,
                        members: [leaf(1), leaf(2)],
                        connector: "and",
                    },
                    leaf(3, true),
                ],
                connector,
            );
            const advanced = simpleToAdvanced(conditions);
            const built = buildAdvancedQuery(advanced, tagTypes);
            assert.ok(built.ok);
            equivalent(queryToJSON(conditions)!.where, built.query.where);
            const simple = advancedToSimple(advanced, tags, new Set([2]));
            assert.ok(simple);
            equivalent(
                queryToJSON(conditions)!.where,
                queryToJSON(simple.conditions)!.where,
            );
            assert.equal(simple.connector, connector);
            const group = simple.conditions[0];
            assert.ok(group.kind === "group");
            assert.equal(group.members[1].suggested, true);
            assert.equal(advancedUsesTags(advanced, new Set([2])), true);
        });
    }
}
test("legacy mixed connectors are nested, never silently reinterpreted", () => {
    const conditions: QueryCondition[] = [
        leaf(1),
        { ...leaf(2), connector: "or" },
        leaf(3),
    ];
    const root = simpleToAdvanced(conditions);
    const built = buildAdvancedQuery(root, tagTypes);
    assert.ok(built.ok);
    equivalent(queryToJSON(conditions)!.where, built.query.where);
    const simple = advancedToSimple(root, tags, new Set());
    assert.ok(simple);
    equivalent(
        queryToJSON(conditions)!.where,
        queryToJSON(simple.conditions)!.where,
    );
});
test("a uniform outer rule is invariant under reorder", () => {
    for (const connector of ["and", "or"] as const) {
        const conditions = withOuterConnector(
            [leaf(1), leaf(2), leaf(3, true)],
            connector,
        );
        const reordered = withOuterConnector(
            moveConditionToIndex(conditions, "3", 0),
            connector,
        );
        equivalent(
            queryToJSON(conditions)!.where,
            queryToJSON(reordered)!.where,
        );
    }
});
test("unsupported value filters, unavailable tags, and negative group members cannot lose meaning on conversion", () => {
    const root = simpleToAdvanced([leaf(1)]);
    const filter = root.children[0];
    assert.ok(filter.kind === "filter");
    assert.equal(
        advancedToSimple(
            { ...root, children: [{ ...filter, op: "eq", value: "8" }] },
            tags,
            new Set(),
        ),
        null,
    );
    assert.equal(advancedToSimple(root, [], new Set()), null);
    const nested: AdvancedGroupNode = {
        kind: "group",
        id: "nested",
        conjunction: "or",
        children: [{ ...filter, op: "is_not_applied" }, filter],
    };
    assert.equal(
        advancedToSimple({ ...root, children: [nested] }, tags, new Set()),
        null,
    );
});
test("number constraints survive Simple compilation and an Advanced round trip", () => {
    const numberTag = {
        id: 4,
        name: "Rating",
        color: "#123456",
        type: "number" as const,
    };
    const tagged: QueryTag = {
        ...leaf(1),
        id: "rating",
        tag: numberTag,
        constraint: { op: "lt", value: "5" },
    };
    const conditions: QueryCondition[] = [tagged];
    const expected = queryToJSON(conditions);
    assert.deepEqual(expected, {
        where: {
            and: [
                { filter: { field: "tag", tag_id: 4, op: "lt", value: "5" } },
            ],
        },
    });
    const advanced = simpleToAdvanced(conditions);
    const built = buildAdvancedQuery(advanced, new Map([[4, "number"]]));
    assert.ok(built.ok);
    assert.deepEqual(built.query, expected);
    const converted = advancedToSimple(advanced, [numberTag], new Set());
    assert.ok(converted);
    assert.deepEqual(queryToJSON(converted.conditions), expected);
    assert.deepEqual(
        converted.conditions[0].kind === "tag"
            ? converted.conditions[0].constraint
            : undefined,
        tagged.constraint,
    );

    const excluded: QueryCondition[] = [{ ...tagged, negated: true }];
    const excludedAdvanced = simpleToAdvanced(excluded);
    const excludedBuilt = buildAdvancedQuery(
        excludedAdvanced,
        new Map([[4, "number"]]),
    );
    assert.ok(excludedBuilt.ok);
    assert.deepEqual(excludedBuilt.query, {
        where: {
            and: [
                {
                    not: {
                        or: [
                            {
                                filter: {
                                    field: "tag",
                                    tag_id: 4,
                                    op: "lt",
                                    value: "5",
                                },
                            },
                        ],
                    },
                },
            ],
        },
    });
    const excludedSimple = advancedToSimple(
        excludedAdvanced,
        [numberTag],
        new Set(),
    );
    assert.ok(excludedSimple);
    assert.deepEqual(
        queryToJSON(excludedSimple.conditions),
        queryToJSON(excluded),
    );
});
test("empty editors convert without inventing filters", () => {
    assert.deepEqual(advancedToSimple(simpleToAdvanced([]), tags, new Set()), {
        conditions: [],
        connector: "and",
    });
});
