import { useSyncExternalStore } from "react";

import type { ChatEntry } from "./types";

/**
 * The assistant conversation, in memory. It lives outside the sheet so closing
 * and reopening the sheet keeps the chat. It belongs to one account: a
 * different signed-in account starts empty. Nothing is saved to disk, so a
 * restart starts a new chat too.
 */
export type ConversationState = {
    accountId: string | null;
    entries: ChatEntry[];
    sending: boolean;
    /** What went wrong with the last send, or null. */
    error: string | null;
};

const EMPTY: ConversationState = {
    accountId: null,
    entries: [],
    sending: false,
    error: null,
};

let state: ConversationState = EMPTY;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getState() {
    return state;
}

/** Applies `change` to the conversation of `accountId`, starting one if needed. */
export function updateConversation(
    accountId: string | null,
    change: (current: ConversationState) => Partial<ConversationState>,
) {
    const current =
        state.accountId === accountId ? state : { ...EMPTY, accountId };
    state = { ...current, ...change(current), accountId };
    listeners.forEach((listener) => listener());
}

/** Clears the conversation of `accountId`. */
export function resetConversation(accountId: string | null) {
    state = { ...EMPTY, accountId };
    listeners.forEach((listener) => listener());
}

/** The conversation of `accountId`, empty when the store holds another account's. */
export function useConversation(accountId: string | null): ConversationState {
    const current = useSyncExternalStore(subscribe, getState, getState);
    return current.accountId === accountId ? current : EMPTY;
}

let nextId = 0;

/** A key for a new chat entry, unique for this app run. */
export function newEntryId() {
    nextId += 1;
    return `entry-${nextId}`;
}
