import { useSyncExternalStore } from "react";

import type { ChatEntry, PendingConfirmation } from "./types";

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
    /** A phone tool waiting for the user to confirm it, or null. */
    confirmation: PendingConfirmation | null;
};

const EMPTY: ConversationState = {
    accountId: null,
    entries: [],
    sending: false,
    error: null,
    confirmation: null,
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

/**
 * Applies `change` only while the store still holds `accountId`'s
 * conversation. For a reply that lands after an await: by then another account
 * may have signed in, and its chat must not be replaced by this one.
 */
export function updateConversationIfCurrent(
    accountId: string | null,
    change: (current: ConversationState) => Partial<ConversationState>,
) {
    if (state.accountId !== accountId) return;
    updateConversation(accountId, change);
}

/** Clears the conversation of `accountId`. A waiting confirmation counts as cancelled. */
export function resetConversation(accountId: string | null) {
    answerConfirmation(false);
    state = { ...EMPTY, accountId };
    listeners.forEach((listener) => listener());
}

let confirmationAnswer: ((confirmed: boolean) => void) | null = null;

/**
 * Shows `confirmation` in `accountId`'s chat and waits for the user to answer
 * it with `answerConfirmation`. Resolves false when the chat is cleared first.
 */
export function askConfirmation(
    accountId: string | null,
    confirmation: PendingConfirmation,
): Promise<boolean> {
    answerConfirmation(false);
    updateConversation(accountId, () => ({ confirmation }));
    return new Promise((resolve) => {
        confirmationAnswer = resolve;
    });
}

/** Answers the confirmation the chat is showing, if any, and hides it. */
export function answerConfirmation(confirmed: boolean) {
    const answer = confirmationAnswer;
    confirmationAnswer = null;
    if (state.confirmation) {
        state = { ...state, confirmation: null };
        listeners.forEach((listener) => listener());
    }
    answer?.(confirmed);
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
