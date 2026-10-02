import assert from "node:assert/strict";
import test from "node:test";

import { queryTagIds, type QueryJSON } from "./query-json.ts";

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
