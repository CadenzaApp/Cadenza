import assert from "node:assert/strict";
import test from "node:test";

import { tabFromPathname } from "./player-tab-model.ts";

test("player entry routes select their corresponding page", () => {
    assert.equal(tabFromPathname("/player"), "player");
    assert.equal(tabFromPathname("/player/comments"), "comments");
    assert.equal(tabFromPathname("/player/tags"), "tags");
});
