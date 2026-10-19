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
    includeSuggested: boolean;
    suggestedTags: Tag[];
};
type Mode = QueryWorkspace["mode"];
type SharedSnapshot = Pick<
    QueryWorkspace,
    "includeSuggested" | "suggestedTags"
>;
type QuerySnapshot = SharedSnapshot &
    (
        | (Pick<QueryWorkspace, "conditions" | "connector"> & {
              mode: "simple";
          })
        | (Pick<QueryWorkspace, "advancedRoot"> & { mode: "advanced" })
    );
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
    | { type: "restore-settings"; includeSuggested: boolean }
    | { type: "undo" }
    | { type: "redo" };

const MAX_HISTORY = 20;

function restoreSnapshot(
    current: QueryWorkspace,
    snapshot: QuerySnapshot,
): QueryWorkspace {
    if (current.mode !== snapshot.mode) return current;
    const suggestedTags = [
        ...new Map(
            [...current.suggestedTags, ...snapshot.suggestedTags].map((tag) => [
                tag.id,
                tag,
            ]),
        ).values(),
    ];
    const inactiveNeedsSuggestions =
        current.mode === "simple"
            ? advancedUsesTags(
                  current.advancedRoot,
                  new Set(suggestedTags.map((tag) => tag.id)),
              )
            : hasSuggestedTag(current.conditions);
    const includeSuggested =
        snapshot.includeSuggested || inactiveNeedsSuggestions;
    return snapshot.mode === "simple"
        ? {
              ...current,
              conditions: snapshot.conditions,
              connector: snapshot.connector,
              includeSuggested,
              suggestedTags,
          }
        : {
              ...current,
              advancedRoot: snapshot.advancedRoot,
              includeSuggested,
              suggestedTags,
          };
}

function snapshotOf(current: QueryWorkspace): QuerySnapshot {
    const shared = {
        includeSuggested: current.includeSuggested,
        suggestedTags: current.suggestedTags,
    };
    return current.mode === "simple"
        ? {
              ...shared,
              mode: "simple",
              conditions: current.conditions,
              connector: current.connector,
          }
        : { ...shared, mode: "advanced", advancedRoot: current.advancedRoot };
}
function sameReferences<T>(a: readonly T[], b: readonly T[]) {
    return (
        a === b ||
        (a.length === b.length && a.every((item, index) => item === b[index]))
    );
}

/** Keep a bounded undo stack per editor so mode navigation is not an edit. */
export function workspaceReducer(
    state: WorkspaceHistory,
    action: WorkspaceAction,
): WorkspaceHistory {
    if (action.type === "restore-settings") {
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
        const suspended = {
            ...state.suspended,
            [state.present.mode]: {
                past: state.past,
                future: state.future,
            },
        };
        const destination = suspended[next.mode];
        return {
            present: next,
            past: destination.past,
            future: destination.future,
            suspended: { ...suspended, [next.mode]: destination },
        };
    }
    if (action.type === "undo") {
        const previous = state.past[state.past.length - 1];
        return previous
            ? {
                  ...state,
                  coalescing: undefined,
                  present: restoreSnapshot(state.present, previous),
                  past: state.past.slice(0, -1),
                  future: [snapshotOf(state.present), ...state.future].slice(
                      0,
                      MAX_HISTORY,
                  ),
              }
            : state;
    }
    if (action.type === "redo") {
        const next = state.future[0];
        return next
            ? {
                  ...state,
                  coalescing: undefined,
                  present: restoreSnapshot(state.present, next),
                  past: [
                      ...state.past.slice(1 - MAX_HISTORY),
                      snapshotOf(state.present),
                  ],
                  future: state.future.slice(1),
              }
            : state;
    }
    const next = action.update(state.present);
    const current = state.present;
    if (
        next === current ||
        (next.mode === current.mode &&
            next.connector === current.connector &&
            sameReferences(next.conditions, current.conditions) &&
            next.advancedRoot === current.advancedRoot &&
            next.advancedInitialized === current.advancedInitialized &&
            next.includeSuggested === current.includeSuggested &&
            sameReferences(next.suggestedTags, current.suggestedTags))
    )
        return state;
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
