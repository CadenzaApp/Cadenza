import assert from "node:assert/strict";
import test from "node:test";

import {
    METADATA_FIELD_KINDS,
    OPERATORS_BY_FIELD,
    addChild,
    buildAdvancedQuery,
    connectorLabel,
    createFilter,
    createGroup,
    parseDateTimeValue,
    parseDateValue,
    removeNode,
    setConjunction,
    toDateTimeValue,
    toDateValue,
    updateFilter,
    withField,
    withOp,
    valueKindFor,
} from "./AdvancedQueryUtils.ts";

const tagTypes = new Map([
    [1, "basic"],
    [2, "text"],
    [3, "datetime"],
    [4, "number"],
    [5, "checkbox"],
    [6, "date"],
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
            field: { kind: "tag", tagId: 6 },
            op: "on_or_after",
            value: "1950-01-01",
        }),
        filter({
            field: { kind: "tag", tagId: 3 },
            op: "before",
            value: "2024-06-01T18:30:45.123Z",
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

    assert.deepEqual(buildAdvancedQuery(root, tagTypes), {
        ok: true,
        query: {
            where: {
                and: [
                    {
                        filter: {
                            field: "tag",
                            tag_id: 6,
                            op: "on_or_after",
                            value: "1950-01-01",
                        },
                    },
                    {
                        filter: {
                            field: "tag",
                            tag_id: 3,
                            op: "before",
                            value: "2024-06-01T18:30:00.000Z",
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
    const result = buildAdvancedQuery(root, tagTypes);
    assert.deepEqual(result, {
        ok: true,
        query: {
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
        buildAdvancedQuery(group("and", [group("or", [])]), tagTypes).ok,
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
            field: { kind: "tag", tagId: 6 },
            op: "on",
            value: "2001-02-30",
        }),
        filter({ field: { kind: "tag", tagId: 3 }, op: "on", value: "" }),
        filter({
            field: { kind: "tag", tagId: 3 },
            op: "on",
            value: "not a date",
        }),
        filter({ field: { kind: "tag_type" }, op: "is", value: "" }),
    ]) {
        assert.equal(
            buildAdvancedQuery(group("and", [bad]), tagTypes).ok,
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

    const day = {
        ...withField(createFilter(), { kind: "tag", tagId: 6 }, tagTypes),
        value: "2000-01-01",
    };
    assert.equal(day.op, "on");
    const moment = withField(day, { kind: "tag", tagId: 3 }, tagTypes);
    assert.equal(moment.op, "on");
    assert.equal(moment.value, "");
});

test("every tag type ends with is applied / is not applied", () => {
    for (const kind of [
        "basic",
        "text",
        "datetime",
        "date",
        "number",
        "checkbox",
    ] as const) {
        assert.deepEqual(OPERATORS_BY_FIELD[kind].slice(-2), [
            "is_applied",
            "is_not_applied",
        ]);
    }
    assert.equal(OPERATORS_BY_FIELD.tag_name.includes("is_applied"), false);

    const result = buildAdvancedQuery(
        group("and", [
            filter({
                field: { kind: "tag", tagId: 4 },
                op: "is_applied",
                value: "7",
            }),
        ]),
        tagTypes,
    );
    assert.deepEqual(result.ok && result.query.where, {
        and: [{ filter: { field: "tag", tag_id: 4, op: "is_applied" } }],
    });

    const moved = withField(
        {
            ...createFilter(),
            field: { kind: "tag", tagId: 2 },
            op: "is_applied",
        },
        { kind: "tag_name" },
        tagTypes,
    );
    assert.equal(moved.op, "is");
});

test("connector words", () => {
    assert.equal(connectorLabel("and", 0), "where");
    assert.equal(connectorLabel("and", 1), "and");
    assert.equal(connectorLabel("or", 2), "or");
    assert.equal(connectorLabel("none", 1), "or");
});

test("datetime values drop their seconds", () => {
    assert.equal(
        toDateTimeValue(new Date("2024-06-01T18:30:45.500Z")),
        "2024-06-01T18:30:00.000Z",
    );
    assert.equal(parseDateTimeValue(""), null);
    assert.equal(parseDateTimeValue("nope"), null);
});

test("date values round trip as local days", () => {
    assert.equal(toDateValue(new Date(1955, 5, 1, 23, 59)), "1955-06-01");
    assert.equal(toDateValue(parseDateValue("1960-12-31")!), "1960-12-31");
    assert.equal(parseDateValue("1960-13-01"), null);
    assert.equal(parseDateValue("1960-1-1"), null);
});

test("song info filters compile to metadata filters", () => {
    const result = buildAdvancedQuery(
        group("and", [
            filter({
                field: { kind: "metadata", key: "artist" },
                op: "starts_with",
                value: " P ",
            }),
            filter({
                field: { kind: "metadata", key: "duration" },
                op: "lt",
                value: "210000.0",
            }),
            filter({
                field: { kind: "metadata", key: "release_date" },
                op: "before",
                value: "2000-01-01",
            }),
            filter({
                field: { kind: "metadata", key: "explicit" },
                op: "is_true",
                value: "leftover",
            }),
            filter({ field: { kind: "tag", tagId: 1 }, op: "is_applied" }),
        ]),
        tagTypes,
    );

    assert.deepEqual(result.ok && result.query.where, {
        and: [
            {
                filter: {
                    field: "metadata",
                    key: "artist",
                    op: "starts_with",
                    value: "P",
                },
            },
            {
                filter: {
                    field: "metadata",
                    key: "duration",
                    op: "lt",
                    value: "210000",
                },
            },
            {
                filter: {
                    field: "metadata",
                    key: "release_date",
                    op: "before",
                    value: "2000-01-01",
                },
            },
            { filter: { field: "metadata", key: "explicit", op: "is_true" } },
            { filter: { field: "tag", tag_id: 1, op: "is_applied" } },
        ],
    });
});

test("song info fields offer their own operators and never is applied", () => {
    for (const kind of new Set(Object.values(METADATA_FIELD_KINDS))) {
        assert.equal(OPERATORS_BY_FIELD[kind].includes("is_applied"), false);
    }
    assert.deepEqual(OPERATORS_BY_FIELD.metadata_explicit, [
        "is_true",
        "is_false",
    ]);
    assert.equal(valueKindFor("metadata_number", "gt"), "number");
    assert.equal(valueKindFor("metadata_date", "on"), "date");
    assert.equal(valueKindFor("metadata_text", "contains"), "text");
    assert.equal(valueKindFor("metadata_date", "is_empty"), "none");
});

test("song info values are checked like tag values", () => {
    const build = (key: string, op: string, value: string) =>
        buildAdvancedQuery(
            group("and", [
                filter({ field: { kind: "metadata", key }, op, value }),
            ]),
            tagTypes,
        );

    assert.equal(build("duration", "gt", "long").ok, false);
    assert.equal(build("release_date", "on", "2000-13-01").ok, false);
    assert.equal(build("genre", "is", "  ").ok, false);
});

test("moving between a tag and a song info field keeps what still fits", () => {
    const textTag = {
        ...createFilter(),
        field: { kind: "tag", tagId: 2 } as const,
        op: "contains" as const,
        value: "live",
    };
    const toAlbum = withField(
        textTag,
        { kind: "metadata", key: "album" },
        tagTypes,
    );
    assert.equal(toAlbum.op, "contains");
    assert.equal(toAlbum.value, "live");

    const toExplicit = withField(
        toAlbum,
        { kind: "metadata", key: "explicit" },
        tagTypes,
    );
    assert.equal(toExplicit.op, "is_true");
    assert.equal(toExplicit.value, "");

    // a tag-only operator falls back to the field's first one
    const appliedTag = { ...textTag, op: "is_applied" as const, value: "" };
    assert.equal(
        withField(appliedTag, { kind: "metadata", key: "title" }, tagTypes).op,
        "is",
    );
});
