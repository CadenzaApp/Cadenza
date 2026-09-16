import assert from "node:assert/strict";
import test from "node:test";

import { tagFadeStart } from "./tag-fade-utils.ts";

test("tag fade start is bounded and preserves its pixel width", () => {
    assert.equal(tagFadeStart(100, 20), 0.8);
    assert.equal(tagFadeStart(10, 20), 0);
    assert.equal(tagFadeStart(0, 20), 0.9);
});
