import { useSyncExternalStore } from "react";

import {
    initialWorkspaceHistory,
    workspaceReducer,
    type WorkspaceAction,
    type WorkspaceHistory,
} from "./query-workspace";

/**
 * The Cadenza query drafts and their undo history, in memory. They live
 * outside `CadenzaScreen` so something else, like the assistant handing over
 * a query, can change them while the tab is not on screen. They belong to one
 * account: a different signed-in account starts with empty drafts. Nothing is
 * saved to disk, so a restart starts empty too. Include suggested tags is a
 * device setting, so it carries over to another account's drafts.
 */
type StoreState = { accountId: string | null; history: WorkspaceHistory };

let state: StoreState = {
    accountId: null,
    history: initialWorkspaceHistory(),
};
const listeners = new Set<() => void>();

export function subscribeWorkspace(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getState() {
    return state;
}

function emit() {
    listeners.forEach((listener) => listener());
}

/** Blank drafts for an account the store does not hold, kept stable for React. */
let blank: WorkspaceHistory | null = null;
function blankHistory(includeSuggested: boolean): WorkspaceHistory {
    if (!blank || blank.present.includeSuggested !== includeSuggested) {
        blank = initialWorkspaceHistory(includeSuggested);
    }
    return blank;
}

/** `accountId`'s drafts and history, blank when the store holds another account's. */
export function getWorkspaceHistory(
    accountId: string | null,
): WorkspaceHistory {
    return state.accountId === accountId
        ? state.history
        : blankHistory(state.history.present.includeSuggested);
}

/** Applies `action` to `accountId`'s drafts, starting blank ones if needed. */
export function dispatchWorkspace(
    accountId: string | null,
    action: WorkspaceAction,
) {
    const current = getWorkspaceHistory(accountId);
    const history = workspaceReducer(current, action);
    if (state.accountId === accountId && history === state.history) return;
    state = { accountId, history };
    emit();
}

/** The Include suggested tags setting, whichever account's drafts are held. */
export function storedIncludeSuggested(): boolean {
    return state.history.present.includeSuggested;
}

/** Sets Include suggested tags, which is never an undo step. */
export function setStoredIncludeSuggested(includeSuggested: boolean) {
    if (state.history.present.includeSuggested === includeSuggested) return;
    state = {
        ...state,
        history: workspaceReducer(state.history, {
            type: "set-include-suggested",
            includeSuggested,
        }),
    };
    emit();
}

/** `accountId`'s drafts and history, kept current. */
export function useWorkspaceHistory(
    accountId: string | null,
): WorkspaceHistory {
    const current = useSyncExternalStore(
        subscribeWorkspace,
        getState,
        getState,
    );
    return current.accountId === accountId
        ? current.history
        : blankHistory(current.history.present.includeSuggested);
}
