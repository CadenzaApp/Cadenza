import { moveConditionToIndex } from "../query-builder/QueryUtils.ts";
import { withOuterConnector } from "../query-builder/QueryConversion.ts";
import assert from "node:assert/strict";
import test from "node:test";
import {
    workspaceReducer,
    switchQueryMode,
    type WorkspaceHistory,
} from "./query-workspace.ts";

const initial: WorkspaceHistory = {
    past: [],
    future: [],
    suspended: {
        simple: { past: [], future: [] },
        advanced: { past: [], future: [] },
    },
    present: {
        mode: "simple",
        conditions: [],
        connector: "and",
        advancedRoot: {
            kind: "group",
            id: "root",
            conjunction: "and",
            children: [],
        },
        advancedInitialized: false,
        includeSuggested: false,
        suggestedTags: [],
    },
};
test("undo restores query contents and suggested matching scope together", () => {
    const tagged = workspaceReducer(initial, {
        type: "edit",
        update: (current) => ({
            ...current,
            includeSuggested: true,
            conditions: [
                {
                    kind: "tag",
                    id: "t",
                    tag: {
                        id: 1,
                        name: "indie",
                        color: "#123456",
                        type: "basic",
                    },
                    negated: false,
                    suggested: true,
                    connector: "and",
                },
            ],
        }),
    });
    const cleared = workspaceReducer(tagged, {
        type: "edit",
        update: (current) => ({
            ...current,
            conditions: [],
            includeSuggested: false,
        }),
    });
    assert.deepEqual(
        workspaceReducer(cleared, { type: "undo" }).present,
        tagged.present,
    );
});
test("switching editors is not an undo step", () => {
    const switched = workspaceReducer(initial, {
        type: "navigate",
        update: (current) => ({
            ...current,
            mode: "advanced",
            advancedInitialized: true,
            advancedRoot: { ...current.advancedRoot, conjunction: "none" },
        }),
    });
    assert.equal(switched.past.length, 0);
    assert.equal(workspaceReducer(switched, { type: "undo" }), switched);
});
test("each editor keeps its own edits without undoing navigation", () => {
    const simpleEdit = workspaceReducer(initial, {
        type: "edit",
        update: (current) => ({ ...current, connector: "or" }),
    });
    const advanced = workspaceReducer(simpleEdit, {
        type: "navigate",
        update: (current) => ({ ...current, mode: "advanced" }),
    });
    assert.equal(advanced.past.length, 0);
    const advancedEdit = workspaceReducer(advanced, {
        type: "edit",
        update: (current) => ({
            ...current,
            advancedRoot: { ...current.advancedRoot, conjunction: "or" },
        }),
    });
    const simple = workspaceReducer(advancedEdit, {
        type: "navigate",
        update: (current) => ({ ...current, mode: "simple" }),
    });
    assert.equal(simple.past.length, 1);
    const undone = workspaceReducer(simple, { type: "undo" });
    assert.equal(undone.present.mode, "simple");
    assert.equal(undone.present.connector, "and");
    assert.equal(undone.present.advancedRoot.conjunction, "or");
});
test("redo restores an undone edit and a new edit clears redo", () => {
    const edited = workspaceReducer(initial, {
        type: "edit",
        update: (current) => ({ ...current, connector: "or" }),
    });
    const undone = workspaceReducer(edited, { type: "undo" });
    assert.equal(undone.future.length, 1);
    assert.deepEqual(workspaceReducer(undone, { type: "redo" }), edited);
    const replaced = workspaceReducer(undone, {
        type: "edit",
        update: (current) => ({ ...current, includeSuggested: true }),
    });
    assert.equal(replaced.future.length, 0);
});
test("no-op edits do not bury the last change and history is bounded", () => {
    assert.equal(
        workspaceReducer(initial, {
            type: "edit",
            update: (current) => ({ ...current }),
        }),
        initial,
    );
    let state = initial;
    for (let index = 0; index < 100; index++)
        state = workspaceReducer(state, {
            type: "edit",
            update: (current) => ({
                ...current,
                includeSuggested: !current.includeSuggested,
            }),
        });
    assert.equal(state.past.length, 20);
});

test("typing a long value uses one undo step and redo restores the complete value", () => {
    let state: WorkspaceHistory = {
        ...initial,
        present: { ...initial.present, mode: "advanced" },
    };
    for (let i = 1; i <= 30; i++) {
        state = workspaceReducer(state, {
            type: "edit",
            coalesceKey: "value:one",
            at: i * 100,
            update: (current) => ({
                ...current,
                advancedRoot: { ...current.advancedRoot, id: "x".repeat(i) },
            }),
        });
    }
    assert.equal(state.past.length, 1);
    const undone = workspaceReducer(state, { type: "undo" });
    assert.equal(undone.present.advancedRoot.id, "root");
    const redone = workspaceReducer(undone, { type: "redo" });
    assert.equal(redone.present.advancedRoot.id, "x".repeat(30));
});
test("pauses, other fields, and structural edits break typing coalescence", () => {
    let state = initial;
    const edit = (key: string | undefined, at: number) => {
        state = workspaceReducer(state, {
            type: "edit",
            coalesceKey: key,
            at,
            update: (current) => ({
                ...current,
                connector: current.connector === "and" ? "or" : "and",
            }),
        });
    };
    edit("one", 0);
    edit("one", 100);
    assert.equal(state.past.length, 1);
    edit("one", 2000);
    assert.equal(state.past.length, 2);
    edit("two", 2100);
    assert.equal(state.past.length, 3);
    edit(undefined, 2200);
    edit("two", 2300);
    assert.equal(state.past.length, 5);
    state = workspaceReducer(state, { type: "undo" });
    edit("two", 2400);
    assert.equal(state.past.length, 5);
    assert.equal(state.future.length, 0);
});

test("Advanced is seeded once and never overwrites the Simple draft", () => {
    const simple: WorkspaceHistory = {
        ...initial,
        present: {
            ...initial.present,
            conditions: [
                {
                    kind: "tag",
                    id: "simple",
                    connector: "and",
                    negated: false,
                    suggested: false,
                    tag: {
                        id: 1,
                        name: "indie",
                        type: "basic",
                        color: "#123456",
                    },
                },
            ],
        },
    };
    const advanced = workspaceReducer(simple, {
        type: "navigate",
        update: switchQueryMode,
    });
    assert.equal(advanced.present.mode, "advanced");
    assert.equal(advanced.present.advancedInitialized, true);
    assert.equal(advanced.present.advancedRoot.children.length, 1);
    assert.equal(advanced.past.length, 0);
    const edited = workspaceReducer(advanced, {
        type: "edit",
        update: (current) => ({
            ...current,
            advancedRoot: { ...current.advancedRoot, conjunction: "none" },
        }),
    });
    const back = workspaceReducer(edited, {
        type: "navigate",
        update: switchQueryMode,
    });
    assert.deepEqual(back.present.conditions, simple.present.conditions);
    const changedSimple = workspaceReducer(back, {
        type: "edit",
        update: (current) => ({ ...current, conditions: [] }),
    });
    const resumed = workspaceReducer(changedSimple, {
        type: "navigate",
        update: switchQueryMode,
    });
    assert.deepEqual(resumed.present.advancedRoot, edited.present.advancedRoot);
    assert.equal(resumed.past.length, 1);
    const undone = workspaceReducer(resumed, { type: "undo" });
    assert.deepEqual(
        undone.present.advancedRoot,
        advanced.present.advancedRoot,
    );
    assert.deepEqual(undone.present.conditions, []);
});

test("an intentionally cleared Advanced draft stays empty on later visits", () => {
    const seeded = switchQueryMode(initial.present);
    const cleared = {
        ...seeded,
        advancedRoot: { ...seeded.advancedRoot, children: [] },
    };
    const simple = switchQueryMode(cleared);
    assert.deepEqual(
        switchQueryMode(simple).advancedRoot,
        cleared.advancedRoot,
    );
});

test("an existing Advanced draft is preserved even before initialization is marked", () => {
    const root = {
        ...initial.present.advancedRoot,
        children: [
            {
                kind: "filter" as const,
                id: "existing",
                field: null,
                op: null,
                value: "",
            },
        ],
    };
    const next = switchQueryMode({ ...initial.present, advancedRoot: root });
    assert.equal(next.advancedRoot, root);
});

test("undo cannot disable suggestions required by the inactive simple draft", () => {
    const current: WorkspaceHistory = {
        ...initial,
        past: [{ ...initial.present, mode: "advanced" }],
        present: {
            ...initial.present,
            mode: "advanced",
            includeSuggested: true,
            conditions: [
                {
                    kind: "tag",
                    id: "suggested",
                    connector: "and",
                    negated: false,
                    suggested: true,
                    tag: {
                        id: 1,
                        name: "indie",
                        color: "#123456",
                        type: "basic",
                    },
                },
            ],
        },
    };
    assert.equal(
        workspaceReducer(current, { type: "undo" }).present.includeSuggested,
        true,
    );
});

test("history snapshots contain only the editor that changed", () => {
    const simple = workspaceReducer(initial, {
        type: "edit",
        update: (current) => ({ ...current, connector: "or" }),
    });
    assert.equal("advancedRoot" in simple.past[0], false);
    const advanced = workspaceReducer(simple, {
        type: "navigate",
        update: switchQueryMode,
    });
    const edited = workspaceReducer(advanced, {
        type: "edit",
        update: (current) => ({
            ...current,
            advancedRoot: { ...current.advancedRoot, conjunction: "none" },
        }),
    });
    assert.equal("conditions" in edited.past[0], false);
});
test("editing does not serialize or walk an inactive editor tree", () => {
    const root = {
        ...initial.present.advancedRoot,
        toJSON() {
            throw new Error("inactive tree serialized");
        },
    };
    const state = {
        ...initial,
        present: { ...initial.present, advancedRoot: root },
    };
    const next = workspaceReducer(state, {
        type: "edit",
        update: (current) => ({ ...current, connector: "or" }),
    });
    assert.equal(next.present.connector, "or");
    assert.equal(next.present.advancedRoot, root);
});

test("reordering two groups remains reversible through repeated undo and redo", () => {
    const conditions = withOuterConnector(
        ["a", "b"].map((id, index) => ({
            kind: "tag" as const,
            id,
            connector: "and" as const,
            negated: false,
            suggested: false,
            tag: {
                id: index,
                name: id,
                color: "#123456",
                type: "basic" as const,
            },
        })),
        "and",
    );
    const before = { ...initial, present: { ...initial.present, conditions } };
    let state = workspaceReducer(before, {
        type: "edit",
        update: (current) => ({
            ...current,
            conditions: withOuterConnector(
                moveConditionToIndex(current.conditions, "a", 2),
                current.connector,
            ),
        }),
    });
    for (let index = 0; index < 5; index++) {
        assert.deepEqual(
            state.present.conditions.map((item) => item.id),
            ["b", "a"],
        );
        state = workspaceReducer(state, { type: "undo" });
        assert.deepEqual(
            state.present.conditions.map((item) => item.id),
            ["a", "b"],
        );
        state = workspaceReducer(state, { type: "redo" });
    }
    assert.equal(state.past.length, 1);
});
