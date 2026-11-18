import assert from "node:assert/strict";
import test from "node:test";

import { initialWorkspaceHistory } from "../cadenza/query-workspace.ts";
import { queryToJSON } from "../query-builder/QueryUtils.ts";
import { buildAdvancedQuery } from "../advanced-query-builder/AdvancedQueryUtils.ts";
import type { Tag } from "../../lib/types.ts";
import {
    cadenzaResultsNavigateAction,
    prepareHandoff,
    type HandoffTags,
} from "./query-handoff.ts";
import type { AssistantCardQuery } from "./types.ts";

const tag = (id: number, name: string, type: Tag["type"]): Tag => ({
    id,
    name,
    color: "#123456",
    type,
});
const tags: HandoffTags = {
    own: [tag(1, "chill", "basic"), tag(2, "gym", "basic")],
    activity: [tag(40, "My Plays", "number")],
};
const tagTypes = new Map(
    [...tags.own, ...tags.activity].map((item) => [item.id, item.type]),
);
const chillOrGym = {
    where: {
        or: [
            { filter: { field: "tag", tag_id: 1, op: "is_applied" } },
            { filter: { field: "tag", tag_id: 2, op: "is_applied" } },
        ],
    },
};
const card = (extra: Partial<AssistantCardQuery> = {}): AssistantCardQuery => ({
    query: chillOrGym,
    builder: "simple",
    library_or_tagged: false,
    include_suggested: false,
    ...extra,
});
const blank = initialWorkspaceHistory().present;

test("a simple card loads into the simple builder as the same query", () => {
    const handoff = prepareHandoff(card(), tags);
    assert.ok(handoff);
    assert.equal(handoff.mode, "simple");
    const loaded = handoff.load(blank);
    assert.equal(loaded.mode, "simple");
    assert.equal(loaded.connector, "or");
    assert.deepEqual(queryToJSON(loaded.conditions), chillOrGym);
    // the other draft is left alone
    assert.equal(loaded.advancedRoot, blank.advancedRoot);
});

test("an advanced card loads into the advanced builder", () => {
    const handoff = prepareHandoff(card({ builder: "advanced" }), tags);
    assert.ok(handoff);
    assert.equal(handoff.mode, "advanced");
    const loaded = handoff.load(blank);
    assert.equal(loaded.mode, "advanced");
    assert.equal(loaded.advancedInitialized, true);
    assert.deepEqual(buildAdvancedQuery(loaded.advancedRoot, tagTypes), {
        ok: true,
        query: chillOrGym,
    });
    assert.equal(loaded.conditions, blank.conditions);
});

test("a query Simple cannot hold goes to Advanced whatever the card says", () => {
    const nested = {
        where: {
            and: [
                {
                    or: [
                        {
                            filter: {
                                field: "tag",
                                tag_id: 1,
                                op: "is_applied",
                            },
                        },
                        {
                            and: [
                                {
                                    filter: {
                                        field: "tag",
                                        tag_id: 2,
                                        op: "is_applied",
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    };
    assert.equal(
        prepareHandoff(card({ query: nested }), tags)?.mode,
        "advanced",
    );
});

test("a query naming a tag the user cannot see is not handed over", () => {
    const missing = {
        where: {
            and: [{ filter: { field: "tag", tag_id: 99, op: "is_applied" } }],
        },
    };
    assert.equal(prepareHandoff(card({ query: missing }), tags), null);
    assert.equal(prepareHandoff(card({ query: "nope" }), tags), null);
    assert.equal(prepareHandoff(card({ query: { where: null } }), tags), null);
});

test("the results open sorted, grouped and limited as the card ran", () => {
    const handoff = prepareHandoff(
        card({
            sort: { field: "tag", tag_id: 40, direction: "descending" },
            group: { field: "metadata", key: "artist", direction: "ascending" },
            limit: 20,
        }),
        tags,
    );
    assert.ok(handoff);
    assert.deepEqual(handoff.arrangement, {
        sort: {
            field: {
                kind: "tag",
                tagId: 40,
                name: "My Plays",
                color: "#123456",
                type: "number",
                source: "activity",
            },
            direction: "descending",
        },
        group: {
            field: { kind: "metadata", key: "artist" },
            direction: "ascending",
        },
        limit: 20,
    });
});

test("a sort by a tag the user cannot see is left out", () => {
    const handoff = prepareHandoff(
        card({ sort: { field: "tag", tag_id: 77, direction: "ascending" } }),
        tags,
    );
    assert.ok(handoff);
    assert.deepEqual(handoff.arrangement, {
        sort: null,
        group: null,
        limit: null,
    });
});

test("the results open on the Cadenza tab's stack, over the builder", () => {
    const action = cadenzaResultsNavigateAction({ query: "{}" });
    assert.equal(action.payload.name, "(tabs)");
    assert.equal(action.payload.pop, true);
    assert.equal(action.payload.params.screen, "(cadenza)");
    assert.equal(action.payload.params.params.screen, "query-results");
    assert.equal(action.payload.params.params.initial, false);
    assert.deepEqual(action.payload.params.params.params, { query: "{}" });
});
