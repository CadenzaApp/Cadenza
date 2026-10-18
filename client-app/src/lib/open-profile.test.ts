import assert from "node:assert/strict";
import test from "node:test";

import { socialProfileNavigateAction } from "./open-profile.ts";

test("opening a profile closes covering screens and keeps the feed underneath", () => {
    assert.deepEqual(socialProfileNavigateAction("user-7"), {
        type: "NAVIGATE",
        payload: {
            name: "(tabs)",
            pop: true,
            merge: true,
            params: {
                screen: "social",
                initial: false,
                params: {
                    screen: "user/[userId]",
                    initial: false,
                    params: { userId: "user-7" },
                },
            },
        },
    });
});
