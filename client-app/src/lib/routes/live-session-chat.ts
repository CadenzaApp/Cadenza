import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import useSWRInfinite from "swr/infinite";

import { useAccount } from "../account";
import { fetchAPIData, useAPIMutation } from "../api-actions";
import { useRealtimeTopic } from "../realtime";
import {
    chatSeenId,
    chatTimeline,
    markChatSeen,
    subscribeChatSeen,
    unreadChatCount,
    withChatMessage,
    type SessionChatMessage,
    type SessionChatPage,
} from "../session-chat";

export type { SessionChatMessage };

/** Path of session `id`'s chat. */
export function sessionChatPath(id: string) {
    return `/live-sessions/${id}/messages`;
}

type ChatPageKey = {
    keyType: "api-data";
    path: string;
    params: Record<string, string>;
    accountId: string;
};

/**
 * Session `id`'s chat, newest first, a page at a time. Every caller shares
 * one cache; `useSessionChatFeed` keeps it current from the socket.
 */
export function useSessionChat(id: string | null) {
    const { account } = useAccount();
    const pages = useSWRInfinite<SessionChatPage>(
        (index, previous: SessionChatPage | null): ChatPageKey | null => {
            if (!account || !id) return null;
            if (index > 0 && previous?.next_before == null) return null;
            return {
                keyType: "api-data",
                path: sessionChatPath(id),
                params:
                    index > 0 && previous?.next_before != null
                        ? { before: String(previous.next_before) }
                        : {},
                accountId: account.id,
            };
        },
        (key: ChatPageKey) =>
            fetchAPIData<SessionChatPage>(key.path, key.params),
        { revalidateFirstPage: false, revalidateAll: false },
    );
    const { data, error, isLoading, isValidating, size, setSize, mutate } =
        pages;
    const messages = useMemo(() => chatTimeline(data), [data]);
    const hasOlder = data?.at(-1)?.next_before != null;
    const loadingOlder =
        isValidating && Boolean(data?.length) && size > (data?.length ?? 0);
    const loadOlder = useCallback(() => {
        if (!hasOlder || loadingOlder) return;
        void setSize((current) => current + 1);
    }, [hasOlder, loadingOlder, setSize]);
    /** Puts a message in the cached pages without a fetch. */
    const addMessage = useCallback(
        (message: SessionChatMessage) =>
            mutate((current) => withChatMessage(current, message), {
                revalidate: false,
            }),
        [mutate],
    );
    return {
        messages,
        chatLoading: !data && isLoading,
        chatError: error,
        hasOlder,
        loadingOlder,
        loadOlder,
        addMessage,
        reloadChat: mutate,
    };
}

/**
 * Keeps session `id`'s chat cache current: a `chat` event carries the new
 * message, which goes straight into the cache, the same way a `playback`
 * event carries the playback. A resync refetches what is loaded. Also sets
 * where unread starts the first time the chat loads. Mounted once, by the
 * live session runner.
 */
export function useSessionChatFeed(id: string | null) {
    const { messages, chatLoading, addMessage, reloadChat } =
        useSessionChat(id);
    useRealtimeTopic(id ? { kind: "live_session", id } : null, (event) => {
        if (event.kind === "chat" && event.data) {
            void addMessage(event.data as SessionChatMessage);
        } else if (event.kind === "resync") {
            void reloadChat();
        }
    });
    const newest = messages[0]?.message_id ?? 0;
    useEffect(() => {
        if (!id || chatLoading) return;
        if (chatSeenId(id) === undefined) markChatSeen(id, newest);
    }, [id, chatLoading, newest]);
}

/** Others' messages in session `id` since the caller last had the chat open. */
export function useSessionChatUnread(id: string | null) {
    const { account } = useAccount();
    const { messages } = useSessionChat(id);
    const seenId = useSyncExternalStore(subscribeChatSeen, () =>
        id ? chatSeenId(id) : undefined,
    );
    return unreadChatCount(messages, seenId, account?.id);
}

/** Marks session `id`'s chat seen through its newest message while `open`. */
export function useMarkChatSeen(
    id: string,
    messages: readonly SessionChatMessage[],
    open: boolean,
) {
    const newest = messages[0]?.message_id;
    useEffect(() => {
        if (open && newest !== undefined) markChatSeen(id, newest);
    }, [id, newest, open]);
}

/** A message on its way, or one that failed and can be sent again. */
export type OutgoingChatMessage = {
    key: string;
    body: string;
    failed: boolean;
};

/**
 * Sends to session `id`'s chat. A message shows as outgoing at once and
 * moves into the chat when the server answers. A failed one stays, marked,
 * until it is sent again or discarded, so nothing typed is lost.
 */
export function useSendSessionChat(id: string) {
    const { addMessage } = useSessionChat(id);
    const post = useAPIMutation<{ body: string }, SessionChatMessage>(
        "POST",
        sessionChatPath(id),
        [],
        { invalidation: "none" },
    );
    const [outgoing, setOutgoing] = useState<OutgoingChatMessage[]>([]);
    const nextKey = useRef(0);

    const deliver = useCallback(
        async (item: OutgoingChatMessage) => {
            try {
                const message = await post.trigger({ body: item.body });
                void addMessage(message);
                setOutgoing((current) =>
                    current.filter((row) => row.key !== item.key),
                );
            } catch {
                setOutgoing((current) =>
                    current.map((row) =>
                        row.key === item.key ? { ...row, failed: true } : row,
                    ),
                );
            }
        },
        [addMessage, post],
    );

    const send = useCallback(
        (text: string) => {
            const body = text.trim();
            if (!body) return;
            const item = {
                key: `out-${++nextKey.current}`,
                body,
                failed: false,
            };
            setOutgoing((current) => [...current, item]);
            void deliver(item);
        },
        [deliver],
    );

    const retry = useCallback(
        (key: string) => {
            const item = outgoing.find((row) => row.key === key);
            if (!item) return;
            const again = { ...item, failed: false };
            setOutgoing((current) =>
                current.map((row) => (row.key === key ? again : row)),
            );
            void deliver(again);
        },
        [deliver, outgoing],
    );

    const discard = useCallback((key: string) => {
        setOutgoing((current) => current.filter((row) => row.key !== key));
    }, []);

    return { outgoing, send, retry, discard };
}
