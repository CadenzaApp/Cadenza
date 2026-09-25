import assert from "node:assert/strict";
import test from "node:test";

import type { FilterOp, QueryJSON, QueryJSONNode } from "./query-json.ts";
import {
    DEFAULT_TAG_PLAY_SCORE_DELTA,
    LOCAL_TAG_PLAY_SCORE_DELTA,
    QUERY_TAG_SCORE_DELTA,
    TAG_SCORE_NAME_LIMIT,
    playTagScoreDeltas,
    queryTagScoreDeltas,
} from "./tag-score-deltas.ts";

test("a local tag gets the local delta and a default tag the default delta", () => {
    assert.deepEqual(
        playTagScoreDeltas(
            [{ name: "pop" }, { name: "Road Trip" }],
            [{ name: "upbeat" }],
        ),
        {
            pop: LOCAL_TAG_PLAY_SCORE_DELTA,
            "Road Trip": LOCAL_TAG_PLAY_SCORE_DELTA,
            upbeat: DEFAULT_TAG_PLAY_SCORE_DELTA,
        },
    );
});

test("a song with no tags scores nothing", () => {
    assert.deepEqual(playTagScoreDeltas([], []), {});
});

test("two tags of one name add up", () => {
    assert.deepEqual(
        playTagScoreDeltas([{ name: "pop" }, { name: "pop" }], []),
        { pop: LOCAL_TAG_PLAY_SCORE_DELTA * 2 },
    );
});

test("a default tag that is also a local tag counts as local only", () => {
    assert.deepEqual(
        playTagScoreDeltas(
            [{ name: "Road  Trip" }],
            [{ name: "road trip" }, { name: "upbeat" }],
        ),
        {
            "Road  Trip": LOCAL_TAG_PLAY_SCORE_DELTA,
            upbeat: DEFAULT_TAG_PLAY_SCORE_DELTA,
        },
    );
});

test("a blank name is left out, since the backend rejects it", () => {
    assert.deepEqual(
        playTagScoreDeltas(
            [{ name: "  " }, { name: "" }, { name: "pop" }],
            [{ name: " " }],
        ),
        { pop: LOCAL_TAG_PLAY_SCORE_DELTA },
    );
});

test("names an object already answers for are still counted", () => {
    assert.deepEqual(
        playTagScoreDeltas([{ name: "constructor" }], [{ name: "toString" }]),
        {
            constructor: LOCAL_TAG_PLAY_SCORE_DELTA,
            toString: DEFAULT_TAG_PLAY_SCORE_DELTA,
        },
    );
});

test("names past the request limit are dropped, not sent", () => {
    const tags = Array.from(
        { length: TAG_SCORE_NAME_LIMIT + 10 },
        (_, index) => ({ name: `tag ${index}` }),
    );
    const deltas = playTagScoreDeltas([...tags, { name: "tag 0" }], []);

    assert.equal(Object.keys(deltas).length, TAG_SCORE_NAME_LIMIT);
    // a name already in the body keeps counting after the limit is reached
    assert.equal(deltas["tag 0"], LOCAL_TAG_PLAY_SCORE_DELTA * 2);
    assert.equal(deltas[`tag ${TAG_SCORE_NAME_LIMIT}`], undefined);
});

test("local tags take the request limit ahead of default tags", () => {
    const local = Array.from({ length: TAG_SCORE_NAME_LIMIT }, (_, index) => ({
        name: `local ${index}`,
    }));
    const deltas = playTagScoreDeltas(local, [{ name: "default" }]);

    assert.equal(Object.keys(deltas).length, TAG_SCORE_NAME_LIMIT);
    assert.equal(deltas.default, undefined);
});

const QUERY_TAGS = [
    { id: 1, name: "pop" },
    { id: 2, name: "rock" },
    { id: 3, name: "jazz" },
];

function applied(tagId: number, op: FilterOp = "is_applied"): QueryJSONNode {
    return { filter: { field: "tag", tag_id: tagId, op } };
}

test("every tag a query asks for gets the query delta", () => {
    const query: QueryJSON = {
        where: { and: [applied(1), { or: [applied(2), applied(3, "gt")] }] },
    };

    assert.deepEqual(queryTagScoreDeltas(query, QUERY_TAGS), {
        pop: QUERY_TAG_SCORE_DELTA,
        rock: QUERY_TAG_SCORE_DELTA,
        jazz: QUERY_TAG_SCORE_DELTA,
    });
});

test("a tag in a not group or marked not applied scores nothing", () => {
    const query: QueryJSON = {
        where: {
            and: [
                applied(1),
                { not: { or: [applied(2)] } },
                applied(3, "is_not_applied"),
            ],
        },
    };

    assert.deepEqual(queryTagScoreDeltas(query, QUERY_TAGS), {
        pop: QUERY_TAG_SCORE_DELTA,
    });
});

test("two negatives make a positive use", () => {
    const query: QueryJSON = {
        where: {
            and: [
                { not: { not: applied(1) } },
                { not: applied(2, "is_not_applied") },
            ],
        },
    };

    assert.deepEqual(queryTagScoreDeltas(query, QUERY_TAGS), {
        pop: QUERY_TAG_SCORE_DELTA,
        rock: QUERY_TAG_SCORE_DELTA,
    });
});

test("a tag used twice, or both ways, counts once", () => {
    const query: QueryJSON = {
        where: { or: [applied(1), applied(1), { not: applied(1) }] },
    };

    assert.deepEqual(queryTagScoreDeltas(query, QUERY_TAGS), {
        pop: QUERY_TAG_SCORE_DELTA,
    });
});

test("unknown tag ids and name filters score nothing", () => {
    const query: QueryJSON = {
        where: {
            and: [
                applied(99),
                { filter: { field: "tag_name", op: "is", value: "pop" } },
            ],
        },
    };

    assert.deepEqual(queryTagScoreDeltas(query, QUERY_TAGS), {});
});
