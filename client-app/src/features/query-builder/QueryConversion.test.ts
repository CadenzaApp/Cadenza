import assert from "node:assert/strict";
import test from "node:test";
import {
    advancedUsesTags,
    simpleToAdvanced,
    withOuterConnector,
} from "./QueryConversion.ts";
import { buildAdvancedQuery } from "../advanced-query-builder/AdvancedQueryUtils.ts";
import { queryToJSON, moveConditionToIndex } from "./QueryUtils.ts";
import type { QueryCondition, QueryTag } from "./types.ts";
import type { QueryJSONNode } from "../../lib/query-json.ts";
import { metadataPaletteTag } from "./metadata-palette.ts";

const tags = [1, 2, 3].map((id) => ({
    id,
    name: `Tag ${id}`,
    color: "#123456",
    type: "basic" as const,
}));
const tagTypes = new Map(tags.map((tag) => [tag.id, tag.type]));
test("metadata filters survive seeding Advanced from Simple", () => {
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
        test(`${connector}/${mode}: seeding Advanced preserves every match and suggested reference`, () => {
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
test("number constraints and negation survive seeding Advanced", () => {
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
});

test("an empty Simple draft seeds an empty Advanced draft", () => {
    assert.deepEqual(simpleToAdvanced([]).children, []);
});
