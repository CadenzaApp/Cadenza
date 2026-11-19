import assert from "node:assert/strict";
import test from "node:test";

import type { NotificationType, SocialNotification } from "../../lib/types.ts";
import { describeGroup, groupNotifications } from "./notification-groups.ts";

let nextId = 1;
const notice = (type: NotificationType, title = "ada"): SocialNotification => ({
    notif_id: nextId++,
    title,
    content: "",
    type,
    created_at: "2026-11-12T00:00:00Z",
    unread: true,
    metadata: {},
});

test("a different type in between splits a run", () => {
    const join = "session_join_request";
    const groups = groupNotifications([
        notice(join),
        notice(join),
        notice(join),
        notice("friend_req_received"),
        notice(join),
        notice(join),
    ]);
    assert.deepEqual(
        groups.map((group) => [group.type, group.items.length]),
        [
            [join, 3],
            ["friend_req_received", 1],
            [join, 2],
        ],
    );
});

test("a group names two people, then counts the rest once each", () => {
    const join = "session_join_request";
    const group = groupNotifications([
        notice(join, "ada"),
        notice(join, "bo"),
        notice(join, "cy"),
        notice(join, "cy"),
        notice(join, "di"),
    ])[0]!;
    assert.equal(describeGroup(group).names, "ada, bo, and 2 others");
    const pair = groupNotifications([
        notice(join, "ada"),
        notice(join, "bo"),
    ])[0]!;
    assert.equal(describeGroup(pair).names, "ada and bo");
});
