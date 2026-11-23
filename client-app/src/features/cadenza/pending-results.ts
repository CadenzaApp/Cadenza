import { useSyncExternalStore } from "react";

/**
 * Query results the Cadenza tab should open as soon as it is on screen, for a
 * query loaded from outside the tab (the assistant's card). The tab opens
 * them itself, the same way its own results button does, so they land on its
 * stack over the builder and Back shows the builder. One request at a time:
 * a newer one replaces an older one that was never opened. It belongs to one
 * account, like the drafts.
 */
type Pending = { accountId: string | null; params: Record<string, string> };

let pending: Pending | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getPending() {
    return pending;
}

function emit() {
    listeners.forEach((listener) => listener());
}

/** Asks the Cadenza tab to open `/query-results` with `params` once it shows. */
export function requestQueryResults(
    accountId: string | null,
    params: Record<string, string>,
) {
    pending = { accountId, params };
    emit();
}

/** Takes `accountId`'s waiting request, if any, so it opens once. */
export function takeQueryResults(
    accountId: string | null,
): Record<string, string> | null {
    if (!pending || pending.accountId !== accountId) return null;
    const { params } = pending;
    pending = null;
    emit();
    return params;
}

/** Whether `accountId` has a request waiting, kept current. */
export function useHasPendingQueryResults(accountId: string | null): boolean {
    const current = useSyncExternalStore(subscribe, getPending, getPending);
    return current !== null && current.accountId === accountId;
}
