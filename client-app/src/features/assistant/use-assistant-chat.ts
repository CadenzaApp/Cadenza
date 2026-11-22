import { useCallback } from "react";

import { readQuerySettings } from "@/features/cadenza/query-settings";
import { useAccount } from "@/lib/account";
import { postToAPI } from "@/lib/api-actions";
import { getErrorDetails } from "@/lib/error-utils";
import { logHandledError } from "@/lib/log";
import { refreshAfterAssistantChanges } from "@/lib/routes/assistant-actions";

import {
    askConfirmation,
    beginAnswer,
    finishAnswer,
    newEntryId,
    resetConversation,
    stopAnswer,
    updateConversation,
    updateConversationIfCurrent,
    useConversation,
} from "./assistant-store";
import { confirmationFor, usePhoneTools } from "./phone-tools";
import type { AssistantRequest, AssistantResponse, ChatEntry } from "./types";

/**
 * The most phone tools one message may run. The backend's step cap ends a
 * loop first; this is only a backstop against a reply that never settles.
 */
const MAX_PHONE_TOOLS = 10;

const UNFINISHED_REPLY =
    "Sorry, I couldn't finish that one. Try asking in a simpler way, or one part at a time.";

/**
 * What the model reads in place of an answer the user stopped, so it does not
 * pick that request back up but still has it as context.
 */
const STOPPED_NOTE =
    "(The user stopped this answer before it finished. Do not continue it unless they ask again.)";

/** The conversation as the backend takes it, a stopped message followed by a note. */
function requestMessages(
    conversation: ChatEntry[],
): AssistantRequest["messages"] {
    return conversation.flatMap((entry): AssistantRequest["messages"] => {
        if (entry.role === "user") {
            const message = { role: "user" as const, content: entry.text };
            return entry.stopped
                ? [message, { role: "assistant", content: STOPPED_NOTE }]
                : [message];
        }
        return [
            {
                role: "assistant",
                content: entry.text,
                song_ids: entry.songs?.song_ids,
                card_query: entry.songs?.query,
            },
        ];
    });
}

/**
 * The assistant chat: the conversation, and `send`, `retry`, `stop`, and
 * `reset`.
 *
 * Sending is a write-like, one-off request rather than an idempotent read, so
 * it goes through `useAPIMutation` and invalidates nothing. The whole
 * conversation goes with every message; the backend keeps none of it.
 *
 * A reply can instead be a `client_tool_call`: a tool only the phone can run,
 * like playback. It runs here (after the user confirms, for the ones that
 * change their Apple Music library), and its output goes back with the same
 * conversation and the call's `continuation`, until the backend answers.
 *
 * A `pending_action` is a change the assistant wants to make (tagging, saved
 * queries, playlists). It shows as the same confirm card, and the answer goes
 * back as `{confirmed}`; only a yes makes the backend change anything. A
 * reply's `actions` are the changes made, each a done card with Undo, and the
 * reads they can move are refreshed.
 *
 * `stop` ends an answer still coming: its request is called off, the loop does
 * nothing more after its current wait, and the message is marked stopped. The
 * next message carries a note that it was, so the model does not resume it.
 * `reset` stops it the same way, then clears the chat.
 */
export function useAssistantChat() {
    const { account } = useAccount();
    const accountId = account?.id ?? null;
    const { entries, sending, error, confirmation } =
        useConversation(accountId);
    const runPhoneTool = usePhoneTools();

    const ask = useCallback(
        async (conversation: ChatEntry[]) => {
            const run = beginAnswer(accountId);
            const trigger = (body: AssistantRequest) =>
                postToAPI<AssistantResponse>(
                    "/assistant/messages",
                    body,
                    run.signal,
                );
            updateConversation(accountId, () => ({
                sending: true,
                error: null,
            }));
            try {
                const request: AssistantRequest = {
                    messages: requestMessages(conversation),
                    time_zone: deviceTimeZone(),
                    now: localNow(),
                    query_settings: await builderSettings(),
                };
                if (!run.active) return;
                let response = await trigger(request);
                for (
                    let ran = 0;
                    response.type !== "reply" && ran < MAX_PHONE_TOOLS;
                    ran += 1
                ) {
                    if (response.type === "pending_action") {
                        // a change waits for the user's yes; the backend
                        // makes it only when this comes back confirmed
                        const { preview, continuation } = response;
                        const confirmed = await askConfirmation(accountId, {
                            title: preview.title,
                            detail: preview.detail,
                            confirmLabel: preview.confirm_label,
                        });
                        if (!run.active) return;
                        if (confirmed) run.confirmedChange = true;
                        response = await trigger({
                            ...request,
                            resume: { continuation, output: { confirmed } },
                        });
                        if (!run.active) return;
                        continue;
                    }
                    const { name, arguments: args, continuation } = response;
                    const asked = confirmationFor(name, args);
                    const confirmed = asked
                        ? await askConfirmation(accountId, asked)
                        : true;
                    if (!run.active) return;
                    if (asked && confirmed) run.confirmedChange = true;
                    const output = confirmed
                        ? await runPhoneTool(name, args)
                        : { cancelled: true, note: "The user cancelled it." };
                    // a phone step already started is not undone by stopping
                    if (!run.active) return;
                    response = await trigger({
                        ...request,
                        resume: { continuation, output },
                    });
                    if (!run.active) return;
                }
                if (!run.active) return;
                if (response.type === "reply") {
                    refreshAfterAssistantChanges(response.actions ?? []);
                }
                const reply: ChatEntry =
                    response.type === "reply"
                        ? {
                              id: newEntryId(),
                              role: "assistant",
                              text: response.text,
                              steps: response.steps,
                              songs: response.songs,
                              actions: response.actions,
                          }
                        : {
                              id: newEntryId(),
                              role: "assistant",
                              text: UNFINISHED_REPLY,
                              steps: [],
                          };
                updateConversationIfCurrent(accountId, (current) => ({
                    entries: [...current.entries, reply],
                    sending: false,
                }));
            } catch (caught) {
                // a stopped answer's request rejects; that is not a failure
                if (!run.active) return;
                logHandledError("Assistant message failed", caught);
                updateConversationIfCurrent(accountId, () => ({
                    sending: false,
                    error: describeError(caught),
                }));
            } finally {
                finishAnswer(run);
            }
        },
        [accountId, runPhoneTool],
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

    /** Stops the answer still coming, so the user can send something else. */
    const stop = useCallback(() => stopAnswer(accountId), [accountId]);

    /** Starts over, stopping an answer still coming first. */
    const reset = useCallback(() => resetConversation(accountId), [accountId]);

    return { entries, sending, error, confirmation, send, retry, stop, reset };
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

/**
 * The query builder's settings that decide which songs a query matches, as
 * they are now, so a card's songs match what the builder would show. A card
 * from before the user changed them can be out of date; that is fine.
 */
async function builderSettings(): Promise<
    NonNullable<AssistantRequest["query_settings"]>
> {
    const settings = await readQuerySettings();
    return {
        library_or_tagged: settings.libraryOrTagged,
        include_suggested: settings.includeSuggested,
    };
}
