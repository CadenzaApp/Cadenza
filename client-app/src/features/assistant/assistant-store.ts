import { useSyncExternalStore } from "react";

import { refreshAfterStoppedAnswer } from "@/lib/routes/assistant-actions";

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

/**
 * Clears the conversation of `accountId`. An answer still coming is stopped
 * first, and a waiting confirmation counts as cancelled.
 */
export function resetConversation(accountId: string | null) {
    const run = endRun();
    answerConfirmation(false);
    state = { ...EMPTY, accountId };
    listeners.forEach((listener) => listener());
    if (run?.confirmedChange) refreshAfterStoppedAnswer();
}

/**
 * The answer being worked on: its request can be called off, and the loop
 * that runs it checks `active` after every wait so a stopped answer does
 * nothing more. One at a time, since the chat sends one message at a time.
 */
export type AnswerRun = {
    readonly signal: AbortSignal;
    /** False once the answer is stopped, cleared, or done. */
    readonly active: boolean;
    /** Set once the user said yes to a change in this answer. */
    confirmedChange: boolean;
};

type Run = {
    accountId: string | null;
    controller: AbortController;
    run: AnswerRun;
};

let current: Run | null = null;

/** Starts `accountId`'s next answer, stopping one still running. */
export function beginAnswer(accountId: string | null): AnswerRun {
    endRun();
    const controller = new AbortController();
    const run: AnswerRun = {
        signal: controller.signal,
        get active() {
            return current?.run === run;
        },
        confirmedChange: false,
    };
    current = { accountId, controller, run };
    return run;
}

/** Marks `run` done, when it still is the current one. */
export function finishAnswer(run: AnswerRun) {
    if (current?.run === run) current = null;
}

/** Calls off the current answer's request, and returns it. */
function endRun(): AnswerRun | null {
    const ending = current;
    current = null;
    ending?.controller.abort();
    return ending?.run ?? null;
}

/**
 * Stops the answer `accountId`'s chat is waiting for: calls off its request,
 * cancels a confirm card on screen, and marks the message stopped, so the
 * composer is free. A change the user already confirmed may still go through
 * on the server, so the message says so and the reads it can move refresh.
 */
export function stopAnswer(accountId: string | null) {
    if (current?.accountId !== accountId) return;
    const run = endRun();
    answerConfirmation(false);
    const stopped = run?.confirmedChange ? "stopped_after_change" : "stopped";
    updateConversationIfCurrent(accountId, (conversation) => {
        const entries = [...conversation.entries];
        const last = entries.at(-1);
        if (last?.role === "user") {
            entries[entries.length - 1] = { ...last, stopped };
        }
        return { entries, sending: false, error: null };
    });
    if (run?.confirmedChange) refreshAfterStoppedAnswer();
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
