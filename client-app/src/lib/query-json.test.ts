import assert from "node:assert/strict";
import test from "node:test";

import { describeQuery, queryTagIds, type QueryJSON } from "./query-json.ts";

test("queryTagIds names every tag filter, negated or not, once, in order", () => {
    const query: QueryJSON = {
        where: {
            and: [
                { filter: { field: "tag", tag_id: 7, op: "lt", value: "2" } },
                {
                    not: {
                        or: [
                            {
                                filter: {
                                    field: "tag",
                                    tag_id: 3,
                                    op: "is_applied",
                                },
                            },
                            {
                                filter: {
                                    field: "tag_name",
                                    op: "contains",
                                    value: "live",
                                },
                            },
                        ],
                    },
                },
                { filter: { field: "tag", tag_id: 7, op: "gt", value: "0" } },
            ],
        },
    };

    assert.deepEqual(queryTagIds(query), [7, 3]);
});

test("queryTagIds is empty for a query with no tag filters", () => {
    assert.deepEqual(queryTagIds({ where: { and: [] } }), []);
});

const NAMES = [
    { id: 1, name: "Chill" },
    { id: 2, name: "Sad" },
    { id: 3, name: "Loud" },
    { id: 4, name: "Rating" },
];

test("describeQuery reads a flat and as names", () => {
    const query: QueryJSON = {
        where: {
            and: [
                { filter: { field: "tag", tag_id: 1, op: "is_applied" } },
                { filter: { field: "tag", tag_id: 2, op: "is_not_applied" } },
            ],
        },
    };
    assert.equal(describeQuery(query, NAMES), "Chill and not Sad");
});

test("describeQuery brackets a nested group and unwraps a group of one", () => {
    const query: QueryJSON = {
        where: {
            and: [
                {
                    and: [
                        {
                            filter: {
                                field: "tag",
                                tag_id: 1,
                                op: "is_applied",
                            },
                        },
                    ],
                },
                {
                    not: {
                        or: [
                            {
                                filter: {
                                    field: "tag",
                                    tag_id: 2,
                                    op: "is_applied",
                                },
                            },
                            {
                                filter: {
                                    field: "tag",
                                    tag_id: 3,
                                    op: "is_applied",
                                },
                            },
                        ],
                    },
                },
            ],
        },
    };
    assert.equal(describeQuery(query, NAMES), "Chill and not (Sad or Loud)");
});

test("describeQuery spells out operators and values", () => {
    const query: QueryJSON = {
        where: {
            or: [
                { filter: { field: "tag", tag_id: 4, op: "ge", value: "4" } },
                {
                    filter: {
                        field: "tag_name",
                        op: "contains",
                        value: "live",
                    },
                },
            ],
        },
    };
    assert.equal(
        describeQuery(query, NAMES),
        "Rating >= 4 or tag name contains live",
    );
});

test("describeQuery names an unknown tag without its id", () => {
    const query: QueryJSON = {
        where: { filter: { field: "tag", tag_id: 99, op: "is_applied" } },
    };
    assert.equal(describeQuery(query, NAMES), "a tag");
});

test("describeQuery reads metadata filters by their label", () => {
    const query: QueryJSON = {
        where: {
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
                        key: "explicit",
                        op: "is_true",
                    },
                },
                { filter: { field: "tag", tag_id: 1, op: "is_applied" } },
            ],
        },
    };
    assert.equal(
        describeQuery(query, NAMES),
        "artist starts with P and explicit is checked and Chill",
    );
    assert.deepEqual(queryTagIds(query), [1]);
});
