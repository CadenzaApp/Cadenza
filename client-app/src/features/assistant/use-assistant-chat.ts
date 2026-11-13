import { useCallback } from "react";

import { useAccount } from "@/lib/account";
import { useAPIMutation } from "@/lib/api-actions";
import { getErrorDetails } from "@/lib/error-utils";
import { logHandledError } from "@/lib/log";

import {
    newEntryId,
    resetConversation,
    updateConversation,
    updateConversationIfCurrent,
    useConversation,
} from "./assistant-store";
import type { AssistantRequest, AssistantResponse, ChatEntry } from "./types";

/**
 * The assistant chat: the conversation, and `send`, `retry`, and `reset`.
 *
 * Sending is a write-like, one-off request rather than an idempotent read, so
 * it goes through `useAPIMutation` and invalidates nothing. The whole
 * conversation goes with every message; the backend keeps none of it.
 */
export function useAssistantChat() {
    const { account } = useAccount();
    const accountId = account?.id ?? null;
    const { entries, sending, error } = useConversation(accountId);
    const { trigger } = useAPIMutation<AssistantRequest, AssistantResponse>(
        "POST",
        "/assistant/messages",
        [],
        { invalidation: "none" },
    );

    const ask = useCallback(
        async (conversation: ChatEntry[]) => {
            updateConversation(accountId, () => ({
                sending: true,
                error: null,
            }));
            try {
                const response = await trigger({
                    messages: conversation.map((entry) => ({
                        role: entry.role,
                        content: entry.text,
                        song_ids:
                            entry.role === "assistant"
                                ? entry.songs?.song_ids
                                : undefined,
                    })),
                    time_zone: deviceTimeZone(),
                    now: localNow(),
                });
                const reply: ChatEntry =
                    response.type === "reply"
                        ? {
                              id: newEntryId(),
                              role: "assistant",
                              text: response.text,
                              steps: response.steps,
                              songs: response.songs,
                          }
                        : {
                              // phone-side tools come later; say so rather than hang
                              id: newEntryId(),
                              role: "assistant",
                              text: "I can't do that from here yet.",
                              steps: [],
                          };
                updateConversationIfCurrent(accountId, (current) => ({
                    entries: [...current.entries, reply],
                    sending: false,
                }));
            } catch (caught) {
                logHandledError("Assistant message failed", caught);
                updateConversationIfCurrent(accountId, () => ({
                    sending: false,
                    error: describeError(caught),
                }));
            }
        },
        [accountId, trigger],
    );

    const send = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || sending) return;
            const conversation: ChatEntry[] = [
                ...entries,
                { id: newEntryId(), role: "user", text: trimmed },
            ];
            updateConversation(accountId, () => ({ entries: conversation }));
            void ask(conversation);
        },
        [accountId, ask, entries, sending],
    );

    /** Sends the conversation again after a failure. Its last message is the user's. */
    const retry = useCallback(() => {
        if (sending || entries.at(-1)?.role !== "user") return;
        void ask(entries);
    }, [ask, entries, sending]);

    const reset = useCallback(() => {
        if (sending) return;
        resetConversation(accountId);
    }, [accountId, sending]);

    return { entries, sending, error, send, retry, reset };
}

function describeError(error: unknown) {
    const details = getErrorDetails(error) as {
        error_type?: unknown;
        retry_after_secs?: unknown;
    };
    if (details.error_type === "UserRateLimited") {
        const minutes =
            typeof details.retry_after_secs === "number"
                ? Math.max(1, Math.ceil(details.retry_after_secs / 60))
                : null;
        return minutes
            ? `You've sent a lot of messages. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`
            : "You've sent a lot of messages. Try again later.";
    }
    if (details.error_type === "AssistantRateLimited") {
        return "The assistant is busy right now. Try again in a moment.";
    }
    if (details.error_type === "Unauthorized") {
        return "Your session expired. Sign in again to use the assistant.";
    }
    return "Couldn't reach the assistant.";
}

function deviceTimeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        return undefined;
    }
}

/** The phone's local time as RFC 3339 with its offset, like 2026-11-11T17:53:00-07:00. */
function localNow() {
    const now = new Date();
    const offsetMinutes = -now.getTimezoneOffset();
    const local = new Date(now.getTime() + offsetMinutes * 60_000)
        .toISOString()
        .slice(0, 19);
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(
        2,
        "0",
    );
    const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
    return `${local}${sign}${hours}:${minutes}`;
}
