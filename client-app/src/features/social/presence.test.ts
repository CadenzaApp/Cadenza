import assert from "node:assert/strict";
import test from "node:test";

import type { SocialFriend } from "../../lib/types.ts";
import { isFriendOnline, onlineFirst } from "./presence.ts";

const friend = (user_id: string, online = false): SocialFriend => ({
    user_id,
    username: user_id,
    online,
    favorite: false,
});

test("a listening friend counts as online", () => {
    assert.equal(isFriendOnline(friend("a"), new Set(["a"])), true);
    assert.equal(isFriendOnline(friend("a"), new Set()), false);
    assert.equal(isFriendOnline(friend("a", true), new Set()), true);
});

test("online friends go first and keep their order inside each group", () => {
    const sorted = onlineFirst(
        [friend("fav"), friend("b"), friend("c", true)],
        new Set(["b"]),
    );
    assert.deepEqual(
        sorted.map((f) => f.user_id),
        ["b", "c", "fav"],
    );
});
