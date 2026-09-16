import assert from "node:assert/strict";
import test from "node:test";

import type { Tag } from "../../lib/types.ts";
import {
    addTagToCondition,
    appendTag,
    conditionConnectorLabel,
    getConditionReorderPosition,
    moveConditionToIndex,
    moveQueryTagToCondition,
    moveQueryTagToIndex,
    queryHeading,
    queryToJSON,
    removeCondition,
    removeQueryTag,
    setGroupMode,
    toggleConditionConnector,
    toggleTagNegation,
    usedTagIds,
} from "./QueryUtils.ts";
import type { QueryCondition, QueryConnector, QueryTag } from "./types.ts";

const rainy: Tag = { id: 1, name: "rainy", color: "#2563eb", type: "basic" };
const chill: Tag = { id: 2, name: "chill", color: "#7c3aed", type: "basic" };
const jazz: Tag = { id: 3, name: "jazz", color: "#db2777", type: "basic" };

function queryTag(
    id: string,
    tag: Tag,
    negated = false,
    connector: QueryConnector = "and",
): QueryTag {
    return { kind: "tag", id, tag, negated, connector };
}

test("serializes top-level AND, group mode, and per-tag NOT", () => {
    const conditions: QueryCondition[] = [
        {
            kind: "group",
            id: "group-1",
            mode: "any",
            connector: "and",
            members: [queryTag("rainy", rainy), queryTag("chill", chill, true)],
        },
        queryTag("jazz", jazz),
    ];

    assert.deepEqual(queryToJSON(conditions), {
        and: [{ or: [1, { not: 2 }] }, 3],
    });
    assert.equal(queryToJSON([]), null);
});

test("combining a palette tag with a single creates an any group", () => {
    const rainyCondition = {
        ...queryTag("rainy", rainy),
        layoutId: "layout-rainy",
    };
    const combined = addTagToCondition([rainyCondition], chill, "rainy");

    assert.equal(combined[0].kind, "group");
    if (combined[0].kind !== "group") return;
    assert.equal(combined[0].layoutId, "layout-rainy");
    assert.equal(combined[0].mode, "any");
    assert.deepEqual(
        combined[0].members.map((member) => member.tag.name),
        ["rainy", "chill"],
    );
});

test("removing a group member collapses the group and preserves NOT", () => {
    const conditions: QueryCondition[] = [
        {
            kind: "group",
            id: "group-1",
            mode: "all",
            connector: "and",
            members: [queryTag("rainy", rainy), queryTag("chill", chill, true)],
        },
    ];

    assert.deepEqual(removeQueryTag(conditions, "rainy"), [
        { ...queryTag("chill", chill, true), layoutId: "group-1" },
    ]);
});

test("collapsing a group preserves its card layout identity", () => {
    const group: QueryCondition = {
        kind: "group",
        id: "group-1",
        layoutId: "condition-layout-1",
        mode: "any",
        connector: "and",
        members: [queryTag("rainy", rainy), queryTag("chill", chill)],
    };

    const withoutFirst = removeQueryTag([group], "rainy");
    assert.equal(withoutFirst[0].id, "chill");
    assert.equal(withoutFirst[0].layoutId, "condition-layout-1");

    const withoutSecond = removeQueryTag([group], "chill");
    assert.equal(withoutSecond[0].id, "rainy");
    assert.equal(withoutSecond[0].layoutId, "condition-layout-1");
});

test("moving a member extracts it and collapses its old group", () => {
    const conditions: QueryCondition[] = [
        {
            kind: "group",
            id: "group-1",
            mode: "any",
            connector: "and",
            members: [queryTag("rainy", rainy), queryTag("chill", chill)],
        },
        queryTag("jazz", jazz),
    ];

    const moved = moveQueryTagToIndex(conditions, "rainy", 2);
    assert.deepEqual(
        moved.map((condition) => condition.id),
        ["chill", "jazz", "rainy"],
    );
});

test("moving a single into another group removes its old condition", () => {
    const conditions: QueryCondition[] = [
        queryTag("rainy", rainy, true),
        {
            kind: "group",
            id: "group-1",
            mode: "any",
            connector: "and",
            members: [queryTag("chill", chill), queryTag("jazz", jazz)],
        },
    ];

    const moved = moveQueryTagToCondition(conditions, "rainy", "group-1");
    assert.equal(moved.length, 1);
    assert.equal(moved[0].kind, "group");
    if (moved[0].kind !== "group") return;
    assert.equal(moved[0].members[2].negated, true);
});

test("toggles mode and negation without changing tag identity", () => {
    const conditions: QueryCondition[] = [
        {
            kind: "group",
            id: "group-1",
            mode: "any",
            connector: "and",
            members: [queryTag("rainy", rainy), queryTag("chill", chill)],
        },
    ];
    const all = setGroupMode(conditions, "group-1", "all");
    const negated = toggleTagNegation(all, "rainy");

    assert.deepEqual(queryToJSON(negated), {
        and: [{ and: [{ not: 1 }, 2] }],
    });
});

test("derives heading and used palette markers", () => {
    const single = queryTag("rainy", rainy);
    const group: QueryCondition = {
        kind: "group",
        id: "group-1",
        mode: "any",
        connector: "and",
        members: [single, queryTag("chill", chill)],
    };

    assert.equal(queryHeading([]), "Find me all songs that have:");
    assert.equal(queryHeading([single]), "Find me all songs that have:");
    assert.equal(queryHeading([group]), "Find me all songs that:");
    assert.deepEqual([...usedTagIds([group])], [1, 2]);
});

test("toggles top-level connectors and labels the condition below", () => {
    const single = queryTag("chill", chill);
    const group: QueryCondition = {
        kind: "group",
        id: "group-1",
        mode: "any",
        connector: "and",
        members: [queryTag("chill-2", chill), queryTag("jazz", jazz)],
    };

    assert.equal(conditionConnectorLabel(single), "AND HAVE");
    assert.equal(conditionConnectorLabel(group), "AND");
    const toggled = toggleConditionConnector(
        [queryTag("rainy", rainy), single],
        single.id,
    );
    assert.equal(toggled[1].connector, "or");
    assert.equal(conditionConnectorLabel(toggled[1]), "OR HAVE");
});

test("serializes mixed top-level connectors from left to right", () => {
    const conditions = [
        queryTag("rainy", rainy),
        queryTag("chill", chill),
        queryTag("jazz", jazz, false, "or"),
    ];

    assert.deepEqual(queryToJSON(conditions), {
        or: [{ and: [1, 2] }, 3],
    });
});

test("does not add a duplicate tag within a group", () => {
    const group: QueryCondition = {
        kind: "group",
        id: "group-1",
        mode: "any",
        connector: "and",
        members: [queryTag("rainy", rainy), queryTag("chill", chill)],
    };

    assert.deepEqual(addTagToCondition([group], rainy, group.id), [group]);
});

test("does not move a duplicate into a group or remove its origin", () => {
    const duplicate = queryTag("rainy-duplicate", rainy);
    const group: QueryCondition = {
        kind: "group",
        id: "group-1",
        mode: "any",
        connector: "and",
        members: [queryTag("rainy", rainy), queryTag("chill", chill)],
    };

    assert.deepEqual(
        moveQueryTagToCondition([duplicate, group], duplicate.id, group.id),
        [duplicate, group],
    );
});

test("moves a whole group between top-level conditions", () => {
    const group: QueryCondition = {
        kind: "group",
        id: "group-1",
        mode: "all",
        connector: "or",
        members: [queryTag("rainy", rainy), queryTag("chill", chill)],
    };
    const conditions = [queryTag("jazz", jazz), group];

    const moved = moveConditionToIndex(conditions, group.id, 0);
    assert.deepEqual(
        moved.map((condition) => condition.id),
        [group.id, "jazz"],
    );
    assert.equal(moved[0].connector, "and");
});

test("moves a single-tag condition as a top-level group", () => {
    const conditions = [
        queryTag("rainy", rainy),
        queryTag("chill", chill),
        queryTag("jazz", jazz),
    ];

    assert.deepEqual(
        moveConditionToIndex(conditions, "jazz", 0).map(
            (condition) => condition.id,
        ),
        ["jazz", "rainy", "chill"],
    );
});

test("derives live condition reorder positions in both directions", () => {
    const conditions = [
        queryTag("a", rainy),
        queryTag("b", chill),
        queryTag("c", jazz),
        queryTag("d", rainy),
    ];
    const centers = new Map([
        ["a", 100],
        ["b", 200],
        ["c", 300],
        ["d", 400],
    ]);

    const downward = getConditionReorderPosition(conditions, "a", 350, centers);
    assert.deepEqual(downward, { finalIndex: 2, insertionIndex: 3 });
    assert.deepEqual(
        moveConditionToIndex(conditions, "a", downward!.insertionIndex).map(
            (condition) => condition.id,
        ),
        ["b", "c", "a", "d"],
    );

    const upward = getConditionReorderPosition(conditions, "d", 150, centers);
    assert.deepEqual(upward, { finalIndex: 1, insertionIndex: 1 });
    assert.deepEqual(
        moveConditionToIndex(conditions, "d", upward!.insertionIndex).map(
            (condition) => condition.id,
        ),
        ["a", "d", "b", "c"],
    );
    assert.deepEqual(
        getConditionReorderPosition(conditions, "b", 250, centers),
        { finalIndex: 1, insertionIndex: 1 },
    );
});

test("derives first and last condition reorder positions", () => {
    const conditions = [
        queryTag("a", rainy),
        queryTag("b", chill),
        queryTag("c", jazz),
    ];
    const centers = new Map([
        ["a", 100],
        ["b", 200],
        ["c", 300],
    ]);

    assert.deepEqual(
        getConditionReorderPosition(conditions, "c", 50, centers),
        { finalIndex: 0, insertionIndex: 0 },
    );
    assert.deepEqual(
        getConditionReorderPosition(conditions, "a", 350, centers),
        { finalIndex: 2, insertionIndex: 3 },
    );
    assert.equal(
        getConditionReorderPosition(conditions, "missing", 150, centers),
        null,
    );
    assert.deepEqual(
        getConditionReorderPosition(
            conditions,
            "b",
            350,
            new Map([["a", 100]]),
        ),
        { finalIndex: 1, insertionIndex: 1 },
    );
});

test("deletes a whole group and normalizes the first connector", () => {
    const group: QueryCondition = {
        kind: "group",
        id: "group-1",
        mode: "any",
        connector: "and",
        members: [queryTag("rainy", rainy), queryTag("chill", chill)],
    };
    const remaining = queryTag("jazz", jazz, false, "or");

    assert.deepEqual(removeCondition([group, remaining], group.id), [
        queryTag("jazz", jazz),
    ]);
});

test("remembers a deleted trailing connector when a replacement is appended", () => {
    const first = queryTag("rainy", rainy);
    const second = queryTag("chill", chill, false, "or");

    const remaining = removeCondition([first, second], second.id);
    const replaced = appendTag(remaining, jazz);

    assert.equal(replaced[1].connector, "or");
    assert.deepEqual(queryToJSON(replaced), { or: [1, 3] });
});

test("remembers a connector when deleting the only tag in a condition", () => {
    const first = queryTag("rainy", rainy);
    const second = queryTag("chill", chill, false, "or");

    const remaining = removeQueryTag([first, second], second.id);
    const replaced = appendTag(remaining, jazz);

    assert.equal(replaced[1].connector, "or");
});

test("keeps connector operators in their visual slots while reordering", () => {
    const conditions = [
        queryTag("rainy", rainy),
        queryTag("chill", chill, false, "or"),
        queryTag("jazz", jazz, false, "and"),
    ];

    const moved = moveConditionToIndex(conditions, "jazz", 0);

    assert.deepEqual(
        moved.map((condition) => condition.id),
        ["jazz", "rainy", "chill"],
    );
    assert.deepEqual(
        moved.map((condition) => condition.connector),
        ["and", "or", "and"],
    );
});
