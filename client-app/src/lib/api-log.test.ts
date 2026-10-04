import assert from "node:assert/strict";
import test from "node:test";

import { describeAPIFailure, endpointOf } from "./api-log.ts";

const URL = "http://192.168.86.247:3000/analytics/summary?tz=UTC";

test("an endpoint drops the host and the query", () => {
    assert.equal(endpointOf(URL), "/analytics/summary");
    assert.equal(endpointOf("http://host:3000"), "/");
});

test("a backend error names its status, type, and message", () => {
    assert.equal(
        describeAPIFailure(
            "GET",
            URL,
            {
                status: 401,
                error_type: "Unauthorized",
                message: "Expired signature",
            },
            84.4,
        ),
        "[api] GET /analytics/summary -> 401 Unauthorized: Expired signature (84ms)",
    );
});

test("a backend error without a status still reads", () => {
    assert.equal(
        describeAPIFailure("POST", URL, { error_type: "DatabaseError" }, 10),
        "[api] POST /analytics/summary -> DatabaseError (10ms)",
    );
});

test("a network error names where it was headed", () => {
    assert.equal(
        describeAPIFailure(
            "GET",
            URL,
            new TypeError("Network request failed"),
            3,
        ),
        "[api] GET /analytics/summary -> network error: Network request failed (http://192.168.86.247:3000)",
    );
});
