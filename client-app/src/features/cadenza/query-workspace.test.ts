import assert from "node:assert/strict";
import test from "node:test";
import { workspaceReducer, type WorkspaceHistory } from "./query-workspace.ts";

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
        advancedDetached: false,
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
            advancedDetached: true,
            advancedRoot: { ...current.advancedRoot, conjunction: "none" },
        }),
        resetDestinationHistory: true,
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
    assert.equal(state.past.length, 15);
});
