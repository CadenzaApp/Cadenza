import assert from "node:assert/strict";
import test from "node:test";

import {
    chatSeenId,
    chatTimeline,
    markChatSeen,
    unreadChatCount,
    withChatMessage,
    type SessionChatMessage,
    type SessionChatPage,
} from "./session-chat.ts";

function message(id: number, user = "a"): SessionChatMessage {
    return {
        message_id: id,
        user_id: user,
        username: user,
        body: `m${id}`,
        sent_at: "2026-11-20T18:00:00Z",
    };
}

test("a pushed message lands first in the first page", () => {
    const pages: SessionChatPage[] = [
        { messages: [message(3), message(2)], next_before: 2 },
        { messages: [message(1)], next_before: null },
    ];
    const next = withChatMessage(pages, message(4));
    assert.deepEqual(
        next[0].messages.map((row) => row.message_id),
        [4, 3, 2],
    );
    assert.equal(next[1], pages[1]);
});

test("a message already there leaves the pages alone", () => {
    const pages: SessionChatPage[] = [
        { messages: [message(2)], next_before: null },
    ];
    assert.equal(withChatMessage(pages, message(2)), pages);
});

test("an empty chat starts a page", () => {
    assert.deepEqual(withChatMessage(undefined, message(1)), [
        { messages: [message(1)], next_before: null },
    ]);
});

test("the timeline is deduped and newest first", () => {
    const pages: SessionChatPage[] = [
        { messages: [message(5), message(3)], next_before: 3 },
        { messages: [message(3), message(1)], next_before: null },
    ];
    assert.deepEqual(
        chatTimeline(pages).map((row) => row.message_id),
        [5, 3, 1],
    );
});

test("unread counts others' messages after the one seen", () => {
    const timeline = [message(4, "b"), message(3, "me"), message(2, "b")];
    assert.equal(unreadChatCount(timeline, 1, "me"), 2);
    assert.equal(unreadChatCount(timeline, 3, "me"), 1);
    assert.equal(unreadChatCount(timeline, undefined, "me"), 0);
});

test("seen never moves back", () => {
    markChatSeen("s", 5);
    markChatSeen("s", 3);
    assert.equal(chatSeenId("s"), 5);
});
