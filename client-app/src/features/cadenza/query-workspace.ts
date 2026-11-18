import { createGroup } from "../advanced-query-builder/AdvancedQueryUtils.ts";
import {
    advancedUsesTags,
    simpleToAdvanced,
} from "../query-builder/QueryConversion.ts";
import { hasSuggestedTag } from "../query-builder/QueryUtils.ts";
import type { Tag } from "@/lib/types";
import type { AdvancedGroupNode } from "../advanced-query-builder/types";
import type { QueryCondition, QueryConnector } from "../query-builder/types";

export type QueryWorkspace = {
    mode: "simple" | "advanced";
    conditions: QueryCondition[];
    connector: QueryConnector;
    advancedRoot: AdvancedGroupNode;
    advancedInitialized: boolean;
    /**
     * The Include suggested tags setting. It lives here because both drafts
     * depend on it, but it is a setting: no undo step changes it, except to
     * turn it on for a restored draft that holds a suggested tag.
     */
    includeSuggested: boolean;
    suggestedTags: Tag[];
};
type Mode = QueryWorkspace["mode"];
/** One editor's draft, as it was before an edit in that editor. */
type DraftSnapshot = { kind: "draft"; suggestedTags: Tag[] } & (
    | (Pick<QueryWorkspace, "conditions" | "connector"> & {
          mode: "simple";
      })
    | (Pick<QueryWorkspace, "advancedRoot"> & { mode: "advanced" })
);
/**
 * Both drafts and the editor that was open, as they were before a whole query
 * was loaded (`load`). Restoring it can switch editors.
 */
type WholeSnapshot = { kind: "whole"; mode: Mode } & Pick<
    QueryWorkspace,
    | "conditions"
    | "connector"
    | "advancedRoot"
    | "advancedInitialized"
    | "suggestedTags"
>;
type QuerySnapshot = DraftSnapshot | WholeSnapshot;
type HistoryStack = { past: QuerySnapshot[]; future: QuerySnapshot[] };
export type WorkspaceHistory = {
    coalescing?: { key: string; at: number };
    present: QueryWorkspace;
    past: QuerySnapshot[];
    future: QuerySnapshot[];
    suspended: Record<Mode, HistoryStack>;
};
export type WorkspaceAction =
    | {
          type: "edit";
          update: (value: QueryWorkspace) => QueryWorkspace;
          coalesceKey?: string;
          at?: number;
      }
    | {
          type: "navigate";
          update: (value: QueryWorkspace) => QueryWorkspace;
      }
    | {
          /**
           * Replaces the whole query, maybe in the other editor, as one undo
           * step that brings back both drafts and the editor that was open.
           */
          type: "load";
          update: (value: QueryWorkspace) => QueryWorkspace;
      }
    | { type: "set-include-suggested"; includeSuggested: boolean }
    | { type: "undo" }
    | { type: "redo" };

const MAX_HISTORY = 20;

export const INITIAL_WORKSPACE: QueryWorkspace = {
    mode: "simple",
    conditions: [],
    connector: "and",
    advancedRoot: {
        kind: "group",
        id: "initial-root",
        conjunction: "and",
        children: [],
    },
    advancedInitialized: false,
    includeSuggested: false,
    suggestedTags: [],
};

/** Empty drafts in Simple with no history, keeping `includeSuggested`. */
export function initialWorkspaceHistory(
    includeSuggested = INITIAL_WORKSPACE.includeSuggested,
): WorkspaceHistory {
    return {
        present: { ...INITIAL_WORKSPACE, includeSuggested },
        past: [],
        future: [],
        suspended: {
            simple: { past: [], future: [] },
            advanced: { past: [], future: [] },
        },
    };
}

function mergeTags(current: readonly Tag[], restored: readonly Tag[]): Tag[] {
    return [
        ...new Map(
            [...current, ...restored].map((tag) => [tag.id, tag]),
        ).values(),
    ];
}

/** Either draft holds a suggested tag, so suggested tags must stay included. */
function needsSuggestions(workspace: QueryWorkspace): boolean {
    return (
        hasSuggestedTag(workspace.conditions) ||
        advancedUsesTags(
            workspace.advancedRoot,
            new Set(workspace.suggestedTags.map((tag) => tag.id)),
        )
    );
}

/**
 * `next` with Include suggested tags left as the user set it, unless a draft
 * now holds a suggested tag, which only matches with it on.
 */
function keepSetting(
    current: QueryWorkspace,
    next: QueryWorkspace,
): QueryWorkspace {
    const includeSuggested = current.includeSuggested || needsSuggestions(next);
    return next.includeSuggested === includeSuggested
        ? next
        : { ...next, includeSuggested };
}

function restoreSnapshot(
    current: QueryWorkspace,
    snapshot: QuerySnapshot,
): QueryWorkspace {
    const suggestedTags = mergeTags(
        current.suggestedTags,
        snapshot.suggestedTags,
    );
    if (snapshot.kind === "whole") {
        return keepSetting(current, {
            ...current,
            mode: snapshot.mode,
            conditions: snapshot.conditions,
            connector: snapshot.connector,
            advancedRoot: snapshot.advancedRoot,
            advancedInitialized: snapshot.advancedInitialized,
            suggestedTags,
        });
    }
    if (current.mode !== snapshot.mode) return current;
    return keepSetting(
        current,
        snapshot.mode === "simple"
            ? {
                  ...current,
                  conditions: snapshot.conditions,
                  connector: snapshot.connector,
                  suggestedTags,
              }
            : {
                  ...current,
                  advancedRoot: snapshot.advancedRoot,
                  suggestedTags,
              },
    );
}

function snapshotOf(current: QueryWorkspace): DraftSnapshot {
    return current.mode === "simple"
        ? {
              kind: "draft",
              suggestedTags: current.suggestedTags,
              mode: "simple",
              conditions: current.conditions,
              connector: current.connector,
          }
        : {
              kind: "draft",
              suggestedTags: current.suggestedTags,
              mode: "advanced",
              advancedRoot: current.advancedRoot,
          };
}

function wholeSnapshotOf(current: QueryWorkspace): WholeSnapshot {
    return {
        kind: "whole",
        mode: current.mode,
        conditions: current.conditions,
        connector: current.connector,
        advancedRoot: current.advancedRoot,
        advancedInitialized: current.advancedInitialized,
        suggestedTags: current.suggestedTags,
    };
}

function sameReferences<T>(a: readonly T[], b: readonly T[]) {
    return (
        a === b ||
        (a.length === b.length && a.every((item, index) => item === b[index]))
    );
}

/**
 * Moves to `mode`'s history, keeping the open editor's history as
 * `leaving`. Each editor's undo stack belongs to it, so switching editors
 * swaps stacks rather than mixing them.
 */
function switchStacks(
    state: WorkspaceHistory,
    present: QueryWorkspace,
    leaving: HistoryStack,
): WorkspaceHistory {
    const suspended = { ...state.suspended, [state.present.mode]: leaving };
    const destination = suspended[present.mode];
    return {
        present,
        past: destination.past,
        future: destination.future,
        suspended: { ...suspended, [present.mode]: destination },
    };
}

/**
 * Keep a bounded undo stack per editor so mode navigation is not an edit.
 *
 * Include suggested tags is a setting, not part of a query: setting it is
 * never an undo step, and undo and redo leave it as it is, unless the draft
 * they bring back holds a suggested tag.
 */
export function workspaceReducer(
    state: WorkspaceHistory,
    action: WorkspaceAction,
): WorkspaceHistory {
    if (action.type === "set-include-suggested") {
        return {
            ...state,
            coalescing: undefined,
            present: {
                ...state.present,
                includeSuggested: action.includeSuggested,
            },
        };
    }
    if (action.type === "navigate") {
        const next = action.update(state.present);
        if (next.mode === state.present.mode) {
            return { ...state, coalescing: undefined, present: next };
        }
        return switchStacks(state, next, {
            past: state.past,
            future: state.future,
        });
    }
    if (action.type === "load") {
        const next = keepSetting(state.present, action.update(state.present));
        if (next === state.present) return state;
        const entry = wholeSnapshotOf(state.present);
        if (next.mode === state.present.mode) {
            return {
                ...state,
                coalescing: undefined,
                present: next,
                past: [...state.past.slice(1 - MAX_HISTORY), entry],
                future: [],
            };
        }
        const moved = switchStacks(state, next, {
            past: state.past,
            future: state.future,
        });
        return {
            ...moved,
            past: [...moved.past.slice(1 - MAX_HISTORY), entry],
            future: [],
        };
    }
    if (action.type === "undo") {
        const previous = state.past[state.past.length - 1];
        if (!previous) return state;
        const present = restoreSnapshot(state.present, previous);
        const past = state.past.slice(0, -1);
        if (present.mode !== state.present.mode) {
            // a load that switched editors: back to the editor it left, whose
            // own history holds the way to redo it
            const moved = switchStacks(state, present, {
                past,
                future: state.future,
            });
            return {
                ...moved,
                future: [wholeSnapshotOf(state.present), ...moved.future].slice(
                    0,
                    MAX_HISTORY,
                ),
            };
        }
        const redo =
            previous.kind === "whole"
                ? wholeSnapshotOf(state.present)
                : snapshotOf(state.present);
        return {
            ...state,
            coalescing: undefined,
            present,
            past,
            future: [redo, ...state.future].slice(0, MAX_HISTORY),
        };
    }
    if (action.type === "redo") {
        const next = state.future[0];
        if (!next) return state;
        const present = restoreSnapshot(state.present, next);
        const future = state.future.slice(1);
        if (present.mode !== state.present.mode) {
            const moved = switchStacks(state, present, {
                past: state.past,
                future,
            });
            return {
                ...moved,
                past: [
                    ...moved.past.slice(1 - MAX_HISTORY),
                    wholeSnapshotOf(state.present),
                ],
            };
        }
        const undo =
            next.kind === "whole"
                ? wholeSnapshotOf(state.present)
                : snapshotOf(state.present);
        return {
            ...state,
            coalescing: undefined,
            present,
            past: [...state.past.slice(1 - MAX_HISTORY), undo],
            future,
        };
    }
    const current = state.present;
    const next = action.update(current);
    if (
        next === current ||
        (next.mode === current.mode &&
            next.connector === current.connector &&
            sameReferences(next.conditions, current.conditions) &&
            next.advancedRoot === current.advancedRoot &&
            next.advancedInitialized === current.advancedInitialized &&
            sameReferences(next.suggestedTags, current.suggestedTags))
    ) {
        // the setting alone is no undo step
        return next.includeSuggested === current.includeSuggested
            ? state
            : { ...state, coalescing: undefined, present: next };
    }
    const coalescing =
        action.coalesceKey && action.at !== undefined
            ? { key: action.coalesceKey, at: action.at }
            : undefined;
    const merge =
        coalescing &&
        state.coalescing?.key === coalescing.key &&
        coalescing.at >= state.coalescing.at &&
        coalescing.at - state.coalescing.at < 1500 &&
        !state.future.length;
    return {
        ...state,
        coalescing,
        present: next,
        past: merge
            ? state.past
            : [...state.past.slice(1 - MAX_HISTORY), snapshotOf(state.present)],
        future: [],
    };
}

/** Seed Advanced once. After that each editor owns its draft, even when empty. */
export function switchQueryMode(current: QueryWorkspace): QueryWorkspace {
    if (current.mode === "advanced") return { ...current, mode: "simple" };
    if (
        current.advancedInitialized ||
        current.advancedRoot.children.length > 0
    ) {
        return { ...current, mode: "advanced", advancedInitialized: true };
    }
    const converted = simpleToAdvanced(current.conditions);
    return {
        ...current,
        mode: "advanced",
        advancedInitialized: true,
        advancedRoot: converted.children.length ? converted : createGroup(),
    };
}

/** Opens `mode`'s editor: `switchQueryMode` when it is not open already. */
export function openQueryMode(mode: Mode) {
    return (current: QueryWorkspace): QueryWorkspace =>
        current.mode === mode ? current : switchQueryMode(current);
}
