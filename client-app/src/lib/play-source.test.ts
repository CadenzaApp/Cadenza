import assert from "node:assert/strict";
import test from "node:test";

import { decodeQuerySource, encodeQuerySource } from "./play-source.ts";
import type { QueryJSON } from "./query-json.ts";

const QUERY: QueryJSON = {
    where: {
        and: [
            { filter: { field: "tag", tag_id: 1, op: "is_applied" } },
            { filter: { field: "tag", tag_id: 2, op: "is_not_applied" } },
        ],
    },
};

test("a query source round trips", () => {
    for (const suggested of [true, false]) {
        const id = encodeQuerySource({ query: QUERY, suggested });
        assert.deepEqual(decodeQuerySource(id), { query: QUERY, suggested });
    }
});

test("the same query encodes the same way, so it ranks as one row", () => {
    assert.equal(
        encodeQuerySource({ query: QUERY, suggested: false }),
        encodeQuerySource({
            query: JSON.parse(JSON.stringify(QUERY)),
            suggested: false,
        }),
    );
});

test("anything that is not a query source decodes to null", () => {
    for (const id of ["", "p.abc", "null", "{}", '{"query":1}', "[1]"]) {
        assert.equal(decodeQuerySource(id), null, id);
    }
});
