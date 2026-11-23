import { moveConditionToIndex } from "../query-builder/QueryUtils.ts";
import { withOuterConnector } from "../query-builder/QueryConversion.ts";
import assert from "node:assert/strict";
import test from "node:test";
import {
    initialWorkspaceHistory,
    openQueryMode,
    workspaceReducer,
    switchQueryMode,
    type QueryWorkspace,
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
const suggestedIndie = {
    kind: "tag" as const,
    id: "t",
    tag: {
        id: 1,
        name: "indie",
        color: "#123456",
        type: "basic" as const,
    },
    negated: false,
    suggested: true,
    connector: "and" as const,
};
test("undo restores query contents and keeps suggestions on for a restored suggested tag", () => {
    const tagged = workspaceReducer(
        workspaceReducer(initial, {
            type: "set-include-suggested",
            includeSuggested: true,
        }),
        {
            type: "edit",
            update: (current) => ({
                ...current,
                conditions: [suggestedIndie],
            }),
        },
    );
    const cleared = workspaceReducer(
        workspaceReducer(tagged, {
            type: "edit",
            update: (current) => ({ ...current, conditions: [] }),
        }),
        { type: "set-include-suggested", includeSuggested: false },
    );
    assert.deepEqual(
        workspaceReducer(cleared, { type: "undo" }).present,
        tagged.present,
    );
});
test("Include suggested tags is a setting, never an undo step", () => {
    const on = workspaceReducer(initial, {
        type: "set-include-suggested",
        includeSuggested: true,
    });
    assert.equal(on.past.length, 0);
    assert.equal(on.present.includeSuggested, true);
    const edited = workspaceReducer(on, {
        type: "edit",
        update: (current) => ({ ...current, connector: "or" }),
    });
    const off = workspaceReducer(edited, {
        type: "set-include-suggested",
        includeSuggested: false,
    });
    assert.equal(off.past.length, 1);
    const undone = workspaceReducer(off, { type: "undo" });
    assert.equal(undone.present.connector, "and");
    assert.equal(undone.present.includeSuggested, false);
    const redone = workspaceReducer(undone, { type: "redo" });
    assert.equal(redone.present.connector, "or");
    assert.equal(redone.present.includeSuggested, false);
});
test("an edit that only changes the setting adds no undo step", () => {
    const edited = workspaceReducer(initial, {
        type: "edit",
        update: (current) => ({ ...current, connector: "or" }),
    });
    const undone = workspaceReducer(edited, { type: "undo" });
    const toggled = workspaceReducer(undone, {
        type: "edit",
        update: (current) => ({ ...current, includeSuggested: true }),
    });
    assert.equal(toggled.present.includeSuggested, true);
    assert.equal(toggled.past.length, 0);
    assert.equal(toggled.future.length, 1);
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
        update: (current) => ({ ...current, connector: "or" }),
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
                connector: current.connector === "and" ? "or" : "and",
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
        past: [{ ...initial.present, kind: "draft", mode: "advanced" }],
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

const loadedRoot = {
    kind: "group" as const,
    id: "loaded",
    conjunction: "or" as const,
    children: [],
};
const loadAdvanced = (current: QueryWorkspace): QueryWorkspace => ({
    ...current,
    mode: "advanced",
    advancedInitialized: true,
    advancedRoot: loadedRoot,
});

test("loading a query in the same editor is one undo step", () => {
    const edited = workspaceReducer(initial, {
        type: "edit",
        update: (current) => ({ ...current, connector: "or" }),
    });
    const loaded = workspaceReducer(edited, {
        type: "load",
        update: (current) => ({
            ...current,
            conditions: [{ ...suggestedIndie, suggested: false }],
            connector: "and",
        }),
    });
    assert.equal(loaded.past.length, 2);
    const undone = workspaceReducer(loaded, { type: "undo" });
    assert.deepEqual(undone.present, edited.present);
    const redone = workspaceReducer(undone, { type: "redo" });
    assert.deepEqual(redone.present, loaded.present);
    // the edit before the load is still there to undo
    const before = workspaceReducer(undone, { type: "undo" });
    assert.equal(before.present.connector, "and");
    assert.equal(before.present.conditions.length, 0);
});

test("undoing a load that switched editors brings back both drafts and the editor", () => {
    const simpleEdit = workspaceReducer(initial, {
        type: "edit",
        update: (current) => ({ ...current, conditions: [suggestedIndie] }),
    });
    const loaded = workspaceReducer(simpleEdit, {
        type: "load",
        update: loadAdvanced,
    });
    assert.equal(loaded.present.mode, "advanced");
    assert.equal(loaded.present.advancedRoot, loadedRoot);
    assert.equal(loaded.past.length, 1);
    // the simple editor's own history waits for it
    assert.equal(loaded.suspended.simple.past.length, 1);

    const undone = workspaceReducer(loaded, { type: "undo" });
    assert.equal(undone.present.mode, "simple");
    assert.deepEqual(undone.present.conditions, simpleEdit.present.conditions);
    assert.equal(undone.present.advancedRoot, simpleEdit.present.advancedRoot);
    assert.equal(undone.present.advancedInitialized, false);
    assert.equal(undone.past.length, 1);
    assert.equal(undone.future.length, 1);

    const redone = workspaceReducer(undone, { type: "redo" });
    assert.equal(redone.present.mode, "advanced");
    assert.equal(redone.present.advancedRoot, loadedRoot);
    assert.equal(redone.past.length, 1);

    // undoing once more after the redo is the load again, then the simple edit
    const again = workspaceReducer(redone, { type: "undo" });
    assert.equal(again.present.mode, "simple");
    const first = workspaceReducer(again, { type: "undo" });
    assert.equal(first.present.mode, "simple");
    assert.equal(first.present.conditions.length, 0);
});

test("loading leaves the setting alone unless the query needs suggestions", () => {
    const plain = workspaceReducer(initial, {
        type: "load",
        update: loadAdvanced,
    });
    assert.equal(plain.present.includeSuggested, false);
    const needs = workspaceReducer(initial, {
        type: "load",
        update: (current) => ({ ...current, conditions: [suggestedIndie] }),
    });
    assert.equal(needs.present.includeSuggested, true);
    const on = workspaceReducer(
        workspaceReducer(initial, {
            type: "set-include-suggested",
            includeSuggested: true,
        }),
        { type: "load", update: loadAdvanced },
    );
    assert.equal(on.present.includeSuggested, true);
});

test("a new edit after undoing a load clears its redo", () => {
    const loaded = workspaceReducer(initial, {
        type: "load",
        update: loadAdvanced,
    });
    const undone = workspaceReducer(loaded, { type: "undo" });
    const edited = workspaceReducer(undone, {
        type: "edit",
        update: (current) => ({ ...current, connector: "or" }),
    });
    assert.equal(edited.future.length, 0);
    assert.equal(workspaceReducer(edited, { type: "redo" }), edited);
});

test("opening an editor by name only switches when it is not open", () => {
    const simple = initial.present;
    assert.equal(openQueryMode("simple")(simple), simple);
    assert.equal(openQueryMode("advanced")(simple).mode, "advanced");
});

test("blank history keeps the setting it is given", () => {
    assert.equal(initialWorkspaceHistory(true).present.includeSuggested, true);
    assert.equal(initialWorkspaceHistory().past.length, 0);
});
