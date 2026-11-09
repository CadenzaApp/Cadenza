import assert from "node:assert/strict";
import test from "node:test";

import { backoffDelay, withRetry, type RetryPolicy } from "./retry.ts";

const policy: RetryPolicy = { retries: 3, baseDelayMs: 400, maxDelayMs: 1000 };

test("each wait doubles up to the cap", () => {
    const full = () => 1;
    assert.equal(backoffDelay(0, policy, full), 400);
    assert.equal(backoffDelay(1, policy, full), 800);
    assert.equal(backoffDelay(2, policy, full), 1000);
});

test("jitter keeps between half and all of the wait", () => {
    assert.equal(
        backoffDelay(0, policy, () => 0),
        200,
    );
    assert.equal(
        backoffDelay(0, policy, () => 0.999999),
        400,
    );
});

test("a call that recovers returns its answer", async () => {
    let calls = 0;
    const waits: number[] = [];
    const answer = await withRetry(
        async () => {
            calls += 1;
            if (calls < 3) throw new Error("500");
            return "ok";
        },
        {
            policy,
            shouldRetry: () => true,
            sleep: async (ms) => waits.push(ms),
            random: () => 1,
        },
    );
    assert.equal(answer, "ok");
    assert.equal(calls, 3);
    assert.deepEqual(waits, [400, 800]);
});

test("gives up after the last retry with the last error", async () => {
    let calls = 0;
    await assert.rejects(
        withRetry(
            async () => {
                calls += 1;
                throw new Error(`fail ${calls}`);
            },
            { policy, shouldRetry: () => true, sleep: async () => {} },
        ),
        /fail 4/,
    );
    assert.equal(calls, 4);
});

test("an error not worth retrying throws at once", async () => {
    let calls = 0;
    await assert.rejects(
        withRetry(
            async () => {
                calls += 1;
                throw new Error("404");
            },
            { policy, shouldRetry: () => false, sleep: async () => {} },
        ),
    );
    assert.equal(calls, 1);
});
