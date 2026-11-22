/**
 * The pure parts of live session chat: the message shape, folding a pushed
 * message into the cached pages, and the last message each session's chat
 * was seen at, for the Chat button's badge. The hooks are
 * `routes/live-session-chat.ts`.
 *
 * Import-free, so `session-chat.test.ts` runs it under `node --test`.
 */

/** One message. Mirrors the backend's `LiveSessionChatMessage`. */
export type SessionChatMessage = {
    message_id: number;
    /** Null once the sender's account is gone. */
    user_id: string | null;
    username: string;
    body: string;
    sent_at: string;
};

/** One `GET /live-sessions/:id/messages` page, newest first. */
export type SessionChatPage = {
    messages: SessionChatMessage[];
    /** The `before` for the next older page, or null at the start. */
    next_before: number | null;
};

/**
 * `pages` with `message` in the first page, newest first. The same `pages`
 * when it is already there, as when the sender's own answer and the `chat`
 * event both bring it.
 */
export function withChatMessage(
    pages: SessionChatPage[] | undefined,
    message: SessionChatMessage,
): SessionChatPage[] {
    if (!pages || pages.length === 0) {
        return [{ messages: [message], next_before: null }];
    }
    const has = pages.some((page) =>
        page.messages.some((row) => row.message_id === message.message_id),
    );
    if (has) return pages;
    const [first, ...rest] = pages;
    const messages = [...first.messages, message].sort(
        (a, b) => b.message_id - a.message_id,
    );
    return [{ ...first, messages }, ...rest];
}

/** Every loaded message once, newest first. */
export function chatTimeline(
    pages: readonly SessionChatPage[] | undefined,
): SessionChatMessage[] {
    if (!pages) return [];
    const seen = new Set<number>();
    const out: SessionChatMessage[] = [];
    for (const page of pages) {
        for (const message of page.messages) {
            if (seen.has(message.message_id)) continue;
            seen.add(message.message_id);
            out.push(message);
        }
    }
    return out.sort((a, b) => b.message_id - a.message_id);
}

/**
 * Messages from someone else after `seenId`, in a newest first timeline.
 * None before a baseline is set, so joining does not badge the history.
 */
export function unreadChatCount(
    timeline: readonly SessionChatMessage[],
    seenId: number | undefined,
    myId: string | undefined,
): number {
    if (seenId === undefined) return 0;
    let count = 0;
    for (const message of timeline) {
        if (message.message_id <= seenId) break;
        if (message.user_id !== myId) count += 1;
    }
    return count;
}

/** By session: the newest message id the caller has seen. */
const seen = new Map<string, number>();
const listeners = new Set<() => void>();

/** The newest message seen in session `id`'s chat, or undefined before any. */
export function chatSeenId(id: string): number | undefined {
    return seen.get(id);
}

/** Marks session `id`'s chat seen up to `messageId`. Never moves back. */
export function markChatSeen(id: string, messageId: number) {
    const current = seen.get(id);
    if (current !== undefined && current >= messageId) return;
    seen.set(id, messageId);
    for (const listener of listeners) listener();
}

export function subscribeChatSeen(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
/** The chat currently shown, used to suppress duplicate foreground pushes. */
export const visibleSessionChat = { sessionId: null as string | null };
