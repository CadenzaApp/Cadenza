import assert from "node:assert/strict";
import test from "node:test";

import {
    addChild,
    buildAdvancedQuery,
    connectorLabel,
    createFilter,
    createGroup,
    parseDateValue,
    removeNode,
    setConjunction,
    toDateValue,
    updateFilter,
    withField,
    withOp,
} from "./AdvancedQueryUtils.ts";

const tagTypes = new Map([
    [1, "basic"],
    [2, "text"],
    [3, "datetime"],
    [4, "number"],
    [5, "checkbox"],
] as const);

function filter(fields: object) {
    return { ...createFilter(), ...fields };
}

function group(conjunction: "and" | "or" | "none", children: any[]) {
    return { ...createGroup(conjunction), children };
}

test("groups compile to and / or / not-or", () => {
    const root = group("and", [
        filter({
            field: { kind: "tag", tagId: 3 },
            op: "on_or_after",
            value: "1950-01-01",
        }),
        group("none", [
            filter({
                field: { kind: "tag_name" },
                op: "contains",
                value: " live ",
            }),
            filter({
                field: { kind: "tag_type" },
                op: "is",
                value: "checkbox",
            }),
        ]),
        group("or", [
            filter({ field: { kind: "tag", tagId: 1 }, op: "is_applied" }),
        ]),
    ]);

    assert.deepEqual(buildAdvancedQuery(root, tagTypes, "America/Denver"), {
        ok: true,
        query: {
            timezone: "America/Denver",
            where: {
                and: [
                    {
                        filter: {
                            field: "tag",
                            tag_id: 3,
                            op: "on_or_after",
                            value: "1950-01-01",
                        },
                    },
                    {
                        not: {
                            or: [
                                {
                                    filter: {
                                        field: "tag_name",
                                        op: "contains",
                                        value: "live",
                                    },
                                },
                                {
                                    filter: {
                                        field: "tag_type",
                                        op: "is",
                                        value: "checkbox",
                                    },
                                },
                            ],
                        },
                    },
                    {
                        or: [
                            {
                                filter: {
                                    field: "tag",
                                    tag_id: 1,
                                    op: "is_applied",
                                },
                            },
                        ],
                    },
                ],
            },
        },
    });
});

test("empty groups are dropped, and an empty query is an error", () => {
    const root = group("and", [
        group("or", []),
        filter({ field: { kind: "tag", tagId: 4 }, op: "gt", value: "02.50" }),
    ]);
    const result = buildAdvancedQuery(root, tagTypes, "UTC");
    assert.deepEqual(result, {
        ok: true,
        query: {
            timezone: "UTC",
            where: {
                and: [
                    {
                        filter: {
                            field: "tag",
                            tag_id: 4,
                            op: "gt",
                            value: "2.5",
                        },
                    },
                ],
            },
        },
    });

    assert.equal(
        buildAdvancedQuery(group("and", [group("or", [])]), tagTypes, "UTC").ok,
        false,
    );
});

test("unfinished or invalid filters are errors", () => {
    for (const bad of [
        filter({}),
        filter({ field: { kind: "tag", tagId: 99 }, op: "is_applied" }),
        filter({
            field: { kind: "tag", tagId: 2 },
            op: "contains",
            value: "  ",
        }),
        filter({ field: { kind: "tag", tagId: 4 }, op: "eq", value: "three" }),
        filter({
            field: { kind: "tag", tagId: 3 },
            op: "on",
            value: "2001-02-30",
        }),
        filter({ field: { kind: "tag_type" }, op: "is", value: "" }),
    ]) {
        assert.equal(
            buildAdvancedQuery(group("and", [bad]), tagTypes, "UTC").ok,
            false,
        );
    }
});

test("valueless operators send no value", () => {
    const result = buildAdvancedQuery(
        group("and", [
            filter({
                field: { kind: "tag", tagId: 5 },
                op: "is_null",
                value: "leftover",
            }),
        ]),
        tagTypes,
        "UTC",
    );
    assert.deepEqual(result.ok && result.query.where, {
        and: [{ filter: { field: "tag", tag_id: 5, op: "is_null" } }],
    });
});

test("tree operations are immutable", () => {
    const root = createGroup();
    const [first] = root.children;
    const nested = createGroup();

    const added = addChild(root, root.id, nested);
    assert.equal(root.children.length, 1);
    assert.equal(added.children.length, 2);

    const switched = setConjunction(added, nested.id, "none");
    assert.equal((switched.children[1] as any).conjunction, "none");
    assert.equal((added.children[1] as any).conjunction, "and");

    const edited = updateFilter(switched, first.id, (f) => ({
        ...f,
        value: "x",
    }));
    assert.equal((edited.children[0] as any).value, "x");
    assert.equal(edited.children[1], switched.children[1]);

    const removed = removeNode(edited, nested.children[0].id);
    assert.equal((removed.children[1] as any).children.length, 0);
    assert.equal(removeNode(removed, removed.id), removed);
});

test("changing the field keeps what still fits", () => {
    const text = withField(createFilter(), { kind: "tag", tagId: 2 }, tagTypes);
    assert.equal(text.op, "is");

    const typed = { ...withOp(text, "contains", tagTypes), value: "rock" };
    const byName = withField(typed, { kind: "tag_name" }, tagTypes);
    assert.equal(byName.op, "contains");
    assert.equal(byName.value, "rock");

    const byNumber = withField(byName, { kind: "tag", tagId: 4 }, tagTypes);
    assert.equal(byNumber.op, "eq");
    assert.equal(byNumber.value, "");

    const empty = withOp({ ...byNumber, value: "3" }, "is_empty", tagTypes);
    assert.equal(empty.value, "");
});

test("connector words", () => {
    assert.equal(connectorLabel("and", 0), "where");
    assert.equal(connectorLabel("and", 1), "and");
    assert.equal(connectorLabel("or", 2), "or");
    assert.equal(connectorLabel("none", 1), "or");
});

test("date values round trip as local days", () => {
    assert.equal(toDateValue(new Date(1955, 5, 1, 23, 59)), "1955-06-01");
    assert.equal(toDateValue(parseDateValue("1960-12-31")!), "1960-12-31");
    assert.equal(parseDateValue("1960-13-01"), null);
    assert.equal(parseDateValue("1960-1-1"), null);
});
