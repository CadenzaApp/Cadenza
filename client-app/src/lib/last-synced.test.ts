import assert from "node:assert/strict";
import test from "node:test";

import { formatSyncedAgo } from "./last-synced.ts";

const MINUTE = 60_000;
const NOW = 1_000_000_000_000;

test("under a minute, or a clock that ran backwards, is just now", () => {
    assert.equal(formatSyncedAgo(NOW - 59_000, NOW), "just now");
    assert.equal(formatSyncedAgo(NOW + MINUTE, NOW), "just now");
});

test("counts minutes, then hours, then days", () => {
    assert.equal(formatSyncedAgo(NOW - 2 * MINUTE, NOW), "2 min ago");
    assert.equal(formatSyncedAgo(NOW - 60 * MINUTE, NOW), "1 hour ago");
    assert.equal(formatSyncedAgo(NOW - 5 * 60 * MINUTE, NOW), "5 hours ago");
    assert.equal(formatSyncedAgo(NOW - 24 * 60 * MINUTE, NOW), "yesterday");
    assert.equal(formatSyncedAgo(NOW - 72 * 60 * MINUTE, NOW), "3 days ago");
});
