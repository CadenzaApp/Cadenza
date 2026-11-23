import assert from "node:assert/strict";
import test from "node:test";

import { requestQueryResults, takeQueryResults } from "./pending-results.ts";

test("a results request opens once, for its own account", () => {
    requestQueryResults("me", { query: "{}" });
    assert.equal(takeQueryResults("someone else"), null);
    assert.deepEqual(takeQueryResults("me"), { query: "{}" });
    assert.equal(takeQueryResults("me"), null);
});

test("a newer request replaces one that never opened", () => {
    requestQueryResults("me", { query: "old" });
    requestQueryResults("me", { query: "new" });
    assert.deepEqual(takeQueryResults("me"), { query: "new" });
});
