import type { AdvancedGroupNode } from "../advanced-query-builder/types";
import type { QueryCondition, QueryConnector } from "../query-builder/types";
import type { Tag } from "@/lib/types";

export type QueryWorkspace = {
    mode: "simple" | "advanced";
    conditions: QueryCondition[];
    connector: QueryConnector;
    advancedRoot: AdvancedGroupNode;
    advancedDetached: boolean;
    includeSuggested: boolean;
    suggestedTags: Tag[];
};
type Mode = QueryWorkspace["mode"];
type HistoryStack = { past: QueryWorkspace[]; future: QueryWorkspace[] };
export type WorkspaceHistory = {
    present: QueryWorkspace;
    past: QueryWorkspace[];
    future: QueryWorkspace[];
    suspended: Record<Mode, HistoryStack>;
};
export type WorkspaceAction =
    | { type: "edit"; update: (value: QueryWorkspace) => QueryWorkspace }
    | {
          type: "navigate";
          update: (value: QueryWorkspace) => QueryWorkspace;
          resetDestinationHistory?: boolean;
      }
    | { type: "restore-settings"; includeSuggested: boolean }
    | { type: "undo" }
    | { type: "redo" };

const MAX_HISTORY = 15;

function restoreSnapshot(
    current: QueryWorkspace,
    snapshot: QueryWorkspace,
): QueryWorkspace {
    const suggestedTags = [
        ...new Map(
            [...current.suggestedTags, ...snapshot.suggestedTags].map((tag) => [
                tag.id,
                tag,
            ]),
        ).values(),
    ];
    return current.mode === "simple"
        ? {
              ...current,
              conditions: snapshot.conditions,
              connector: snapshot.connector,
              includeSuggested: snapshot.includeSuggested,
              suggestedTags,
          }
        : {
              ...current,
              advancedRoot: snapshot.advancedRoot,
              includeSuggested: snapshot.includeSuggested,
              suggestedTags,
          };
}

/** Keep a bounded undo stack per editor so mode navigation is not an edit. */
export function workspaceReducer(
    state: WorkspaceHistory,
    action: WorkspaceAction,
): WorkspaceHistory {
    if (action.type === "restore-settings") {
        return {
            ...state,
            present: {
                ...state.present,
                includeSuggested: action.includeSuggested,
            },
        };
    }
    if (action.type === "navigate") {
        const next = action.update(state.present);
        if (next.mode === state.present.mode) {
            return { ...state, present: next };
        }
        const suspended = {
            ...state.suspended,
            [state.present.mode]: {
                past: state.past,
                future: state.future,
            },
        };
        const destination = action.resetDestinationHistory
            ? { past: [], future: [] }
            : suspended[next.mode];
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
                  present: restoreSnapshot(state.present, previous),
                  past: state.past.slice(0, -1),
                  future: [state.present, ...state.future].slice(
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
                  present: restoreSnapshot(state.present, next),
                  past: [...state.past.slice(1 - MAX_HISTORY), state.present],
                  future: state.future.slice(1),
              }
            : state;
    }
    const next = action.update(state.present);
    if (JSON.stringify(next) === JSON.stringify(state.present)) return state;
    return {
        ...state,
        present: next,
        past: [...state.past.slice(1 - MAX_HISTORY), state.present],
        future: [],
    };
}
